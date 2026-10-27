// End-to-end checks of the auction rules against the real Supabase project.
// Creates throwaway users + a test tournament, runs every scenario, then deletes everything.
//
//   npm run dev            (in another terminal - needed for the /api tests)
//   npm run test:auction
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP = process.env.APP_URL ?? "http://localhost:3000";
if (!URL || !ANON || !SERVICE) {
  console.error("Missing Supabase keys in .env.local (all 3 are needed)");
  process.exit(1);
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, opts);
const anon = createClient(URL, ANON, opts);
const RUN = Date.now().toString(36);
const PASS = "Test@12345";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✔\x1b[0m ${name}`);
  } catch (e) {
    failed++;
    console.log(`  \x1b[31m✘ ${name}\x1b[0m\n      ${e.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function ok(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`Expected success, got: ${error.message}`);
  return data;
}
async function fails(promise, pattern) {
  const { error } = await promise;
  if (!error) throw new Error(`Expected an error matching ${pattern}, but it succeeded`);
  if (!pattern.test(error.message)) throw new Error(`Expected ${pattern}, got: ${error.message}`);
}

const createdUsers = [];
async function makeUser(label, role) {
  const email = `test-${RUN}-${label}@test.cricauction.app`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASS,
    email_confirm: true,
    app_metadata: role === "owner" ? { role: "owner" } : {},
  });
  if (error) throw error;
  createdUsers.push(data.user.id);
  const client = createClient(URL, ANON, opts);
  await ok(client.auth.signInWithPassword({ email, password: PASS }));
  return { user: data.user, client, email };
}

async function main() {
  console.log(`\nCricAuction scenario tests (run ${RUN})\n`);
  const org = await makeUser("organiser", "organiser");
  const other = await makeUser("other-organiser", "organiser");
  const owners = {};
  for (const k of ["a", "b", "c", "d"]) owners[k] = await makeUser(`owner-${k}`, "owner");

  let t, t2, t3, teams, players;
  const db = org.client;
  const rpc = (client, fn, args) => client.rpc(fn, args);
  const state = async () => ok(admin.from("auction_state").select("*").eq("tournament_id", t.id).single());
  const team = async (id) => ok(admin.from("teams").select("*").eq("id", id).single());
  const player = async (id) => ok(admin.from("players").select("*").eq("id", id).single());

  try {
    console.log("Setup & permissions");
    await test("organiser can create a tournament (auction_state row auto-created)", async () => {
      t = await ok(
        db.from("tournaments").insert({ name: `TEST ${RUN}`, team_budget: 10000, base_price: 500, min_squad: 3, max_squad: 4, bid_timer_seconds: 60 }).select().single(),
      );
      const s = await state();
      assert(s.phase === "idle", "auction_state should start idle");
    });
    await test("team owner accounts cannot create tournaments", () =>
      fails(owners.a.client.from("tournaments").insert({ name: "hack" }), /row-level security/i));
    await test("another organiser cannot edit this tournament", async () => {
      await other.client.from("tournaments").update({ name: "hacked" }).eq("id", t.id);
      const row = await ok(admin.from("tournaments").select("name").eq("id", t.id).single());
      assert(row.name === `TEST ${RUN}`, "name was changed by another organiser");
    });

    teams = await ok(
      db
        .from("teams")
        .insert(["a", "b", "c", "d"].map((k, i) => ({ tournament_id: t.id, name: `Team ${k.toUpperCase()}`, purse: i === 3 ? 2000 : 10000, owner_user_id: owners[k].user.id })))
        .select(),
    );
    const [A, B, C, D] = teams;
    players = await ok(
      db
        .from("players")
        .insert(Array.from({ length: 12 }, (_, i) => ({ tournament_id: t.id, name: `Player ${i + 1}`, base_price: 500, status: i === 11 ? "pending" : "available" })))
        .select(),
    );
    await ok(db.from("player_contacts").insert({ player_id: players[0].id, tournament_id: t.id, phone: "9800000001" }));

    await test("public (not logged in) can see teams and approved players", async () => {
      const rows = await ok(anon.from("players").select("id").eq("tournament_id", t.id));
      assert(rows.length === 11, `expected 11 visible players, got ${rows.length}`);
    });
    await test("public cannot see pending registrations", async () => {
      const rows = await ok(anon.from("players").select("id").eq("id", players[11].id));
      assert(rows.length === 0, "pending player was visible");
    });
    await test("phone numbers are hidden from public and team owners", async () => {
      const a = await ok(anon.from("player_contacts").select("*").eq("tournament_id", t.id));
      const b = await ok(owners.a.client.from("player_contacts").select("*").eq("tournament_id", t.id));
      assert(a.length === 0 && b.length === 0, "contacts leaked");
    });
    await test("team owner cannot change teams or players directly", async () => {
      await owners.a.client.from("teams").update({ spent: 0, purse: 999999 }).eq("id", A.id);
      assert((await team(A.id)).purse === 10000, "owner changed own purse");
    });
    await test("team owner cannot write auction_state directly", async () => {
      await owners.a.client.from("auction_state").update({ leading_team_id: A.id }).eq("tournament_id", t.id);
      assert((await state()).leading_team_id === null, "owner wrote auction_state");
    });

    console.log("\nBidding");
    const p1 = players[0];
    await test("bidding before a player is on stage is rejected", () =>
      fails(rpc(owners.a.client, "place_bid", { p_tournament: t.id, p_amount: 500 }), /not open/i));
    await test("team owner cannot start a player", () =>
      fails(rpc(owners.a.client, "start_player", { p_tournament: t.id, p_player: p1.id }), /organiser/i));
    await test("pending players cannot be auctioned", () =>
      fails(rpc(db, "start_player", { p_tournament: t.id, p_player: players[11].id }), /not available/i));
    await test("organiser starts a player", async () => {
      await ok(rpc(db, "start_player", { p_tournament: t.id, p_player: p1.id }));
      const s = await state();
      assert(s.phase === "bidding" && s.player_id === p1.id && s.ends_at, "player not on stage with a timer");
    });
    await test("starting another player while bidding is rejected", () =>
      fails(rpc(db, "start_player", { p_tournament: t.id, p_player: players[1].id }), /finish the current/i));
    await test("bid below base price is rejected", () =>
      fails(rpc(owners.a.client, "place_bid", { p_tournament: t.id, p_amount: 400 }), /minimum bid is rs 500/i));
    await test("first bid at base price (Rs 500) is accepted", async () => {
      await ok(rpc(owners.a.client, "place_bid", { p_tournament: t.id, p_amount: 500 }));
      const s = await state();
      assert(s.current_bid === 500 && s.leading_team_id === A.id, "state not updated");
    });
    await test("leading team cannot bid against itself", () =>
      fails(rpc(owners.a.client, "place_bid", { p_tournament: t.id, p_amount: 1000 }), /already have the highest/i));
    await test("same amount as current bid is rejected (needs +500 step)", () =>
      fails(rpc(owners.b.client, "place_bid", { p_tournament: t.id, p_amount: 500 }), /minimum bid is rs 1000/i));
    await test("next step bid (Rs 1000) by another team is accepted", () =>
      ok(rpc(owners.b.client, "place_bid", { p_tournament: t.id, p_amount: 1000 })));
    await test("jump bids (more than one step) are allowed", () =>
      ok(rpc(owners.c.client, "place_bid", { p_tournament: t.id, p_amount: 2000 })));
    await test("two owners tapping at the same moment: exactly one wins", async () => {
      const results = await Promise.all([
        rpc(owners.a.client, "place_bid", { p_tournament: t.id, p_amount: 2500 }),
        rpc(owners.b.client, "place_bid", { p_tournament: t.id, p_amount: 2500 }),
      ]);
      const wins = results.filter((r) => !r.error).length;
      assert(wins === 1, `expected 1 winner, got ${wins}`);
      const s = await state();
      assert(s.current_bid === 2500, `current bid should be 2500, got ${s.current_bid}`);
    });
    await test("purse rule: team D (Rs 2000 purse) can't bid over its max", () =>
      fails(rpc(owners.d.client, "place_bid", { p_tournament: t.id, p_amount: 3000 }), /not enough purse/i));
    await test("organiser can bid on behalf of a team", async () => {
      const leader = (await state()).leading_team_id;
      const forTeam = leader === A.id ? B : A;
      await ok(rpc(db, "admin_bid", { p_tournament: t.id, p_team: forTeam.id, p_amount: 3000 }));
      assert((await state()).leading_team_id === forTeam.id, "admin bid not applied");
    });
    await test("team owner cannot use admin_bid", () =>
      fails(rpc(owners.c.client, "admin_bid", { p_tournament: t.id, p_team: C.id, p_amount: 5000 }), /organiser/i));
    await test("bid history is recorded and public", async () => {
      const bids = await ok(anon.from("bids").select("*").eq("player_id", p1.id));
      assert(bids.length === 5, `expected 5 bids, got ${bids.length}`);
    });

    await test("live updates: a watching screen receives the new bid instantly", async () => {
      const watcher = createClient(URL, ANON, opts);
      let received = null;
      let ready;
      const changesReady = new Promise((resolve) => (ready = resolve));
      const ch = watcher
        .channel(`test-${RUN}`)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "auction_state", filter: `tournament_id=eq.${t.id}` }, (p) => {
          received = p.new;
        })
        // the server says separately when database changes start flowing; SUBSCRIBED alone is too early
        .on("system", {}, (msg) => msg?.extension === "postgres_changes" && ready());
      await new Promise((resolve, reject) => {
        ch.subscribe((s) => (s === "SUBSCRIBED" ? resolve() : s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? reject(new Error(s)) : null));
      });
      await Promise.race([changesReady, sleep(8000)]);
      await ok(rpc(owners.c.client, "place_bid", { p_tournament: t.id, p_amount: 3500 }));
      for (let i = 0; i < 50 && !received; i++) await sleep(200);
      await watcher.removeChannel(ch);
      assert(received?.current_bid === 3500, "no realtime event received within 10s");
    });

    await test("closing sells to the highest bidder and charges their purse", async () => {
      assert((await ok(rpc(db, "close_player", { p_tournament: t.id }))) === "sold", "should return sold");
      const p = await player(p1.id);
      const c = await team(C.id);
      assert(p.status === "sold" && p.team_id === C.id && p.sold_price === 3500, "player not sold to C for 3500");
      assert(c.spent === 3500, `team C spent should be 3500, got ${c.spent}`);
      assert((await state()).phase === "sold", "stage should show SOLD");
    });
    await test("bids after closing are rejected", () =>
      fails(rpc(owners.a.client, "place_bid", { p_tournament: t.id, p_amount: 9000 }), /not open/i));

    await test("player with no bids goes UNSOLD", async () => {
      await ok(rpc(db, "start_player", { p_tournament: t.id, p_player: players[1].id }));
      assert((await ok(rpc(db, "close_player", { p_tournament: t.id }))) === "unsold", "should return unsold");
      assert((await player(players[1].id)).status === "unsold", "player not unsold");
    });
    await test("unsold player can be brought back and sold later", async () => {
      await ok(rpc(db, "start_player", { p_tournament: t.id, p_player: players[1].id }));
      await ok(rpc(owners.a.client, "place_bid", { p_tournament: t.id, p_amount: 500 }));
      await ok(rpc(db, "close_player", { p_tournament: t.id }));
      assert((await player(players[1].id)).team_id === A.id, "not sold to A");
    });
    await test("cancel takes the player off stage with no result", async () => {
      await ok(rpc(db, "start_player", { p_tournament: t.id, p_player: players[2].id }));
      await ok(rpc(owners.b.client, "place_bid", { p_tournament: t.id, p_amount: 500 }));
      await ok(rpc(db, "cancel_player", { p_tournament: t.id }));
      const p = await player(players[2].id);
      assert(p.status === "available" && (await state()).phase === "idle", "cancel did not reset");
    });

    console.log("\nTimer");
    await test("bids after the timer runs out are rejected", async () => {
      await ok(db.from("tournaments").update({ bid_timer_seconds: 2 }).eq("id", t.id));
      await ok(rpc(db, "start_player", { p_tournament: t.id, p_player: players[2].id }));
      await sleep(3000);
      await fails(rpc(owners.b.client, "place_bid", { p_tournament: t.id, p_amount: 500 }), /time is up/i);
    });
    await test("reset timer reopens bidding", async () => {
      await ok(rpc(db, "reset_timer", { p_tournament: t.id }));
      await ok(rpc(owners.b.client, "place_bid", { p_tournament: t.id, p_amount: 500 }));
      await ok(rpc(db, "close_player", { p_tournament: t.id }));
      await ok(db.from("tournaments").update({ bid_timer_seconds: 60 }).eq("id", t.id));
    });

    console.log("\nSquad & purse rules");
    await test("min-squad reserve: team must keep money for remaining players", async () => {
      // D: purse 2000, 0 players, min squad 3 -> must keep 2 x 500, so max bid = 1000
      await ok(rpc(db, "start_player", { p_tournament: t.id, p_player: players[3].id }));
      await fails(rpc(owners.d.client, "place_bid", { p_tournament: t.id, p_amount: 1500 }), /max bid allowed is rs 1000/i);
      await ok(rpc(owners.d.client, "place_bid", { p_tournament: t.id, p_amount: 1000 }));
      await ok(rpc(db, "close_player", { p_tournament: t.id }));
    });
    await test("full squad cannot bid (max squad 4)", async () => {
      for (const i of [4, 5, 6]) await ok(rpc(db, "assign_player", { p_player: players[i].id, p_team: A.id, p_price: 0 }));
      await ok(rpc(db, "start_player", { p_tournament: t.id, p_player: players[7].id }));
      await fails(rpc(owners.a.client, "place_bid", { p_tournament: t.id, p_amount: 500 }), /squad is full/i);
      await ok(rpc(db, "cancel_player", { p_tournament: t.id }));
    });
    await test("assign rejects a price above the team's purse", () =>
      fails(rpc(db, "assign_player", { p_player: players[8].id, p_team: D.id, p_price: 5000 }), /enough purse/i));
    await test("release (undo sale) refunds the team", async () => {
      await ok(rpc(db, "release_player", { p_player: p1.id }));
      const p = await player(p1.id);
      assert(p.status === "available" && p.team_id === null, "player not released");
      assert((await team(C.id)).spent === 0, "team C not refunded");
    });
    await test("another organiser cannot release players", () =>
      fails(rpc(other.client, "release_player", { p_player: players[1].id }), /organiser/i));
    await test("reset auction returns everyone to the pool", async () => {
      await ok(rpc(db, "reset_auction", { p_tournament: t.id }));
      const sold = await ok(admin.from("players").select("id").eq("tournament_id", t.id).in("status", ["sold", "unsold"]));
      const spent = await ok(admin.from("teams").select("spent").eq("tournament_id", t.id));
      assert(sold.length === 0 && spent.every((x) => x.spent === 0), "reset incomplete");
    });

    console.log("\nAutomatic timer");
    const tick = () => ok(rpc(anon, "auction_tick", { p_tournament: t.id }));
    await ok(db.from("tournaments").update({ bid_timer_seconds: 2, result_pause_seconds: 2, auto_close: true, auto_next: true }).eq("id", t.id));
    await test("nothing happens before the timer ends", async () => {
      await ok(rpc(db, "start_player", { p_tournament: t.id, p_player: players[0].id }));
      assert((await tick()) === "bidding", "closed early");
    });
    await test("timer ends with no bids -> UNSOLD automatically (any screen can trigger it)", async () => {
      await sleep(2500);
      assert((await tick()) === "unsold", "not unsold");
      assert((await player(players[0].id)).status === "unsold", "player status not unsold");
    });
    await test("after the result pause, the next random player comes up by itself", async () => {
      assert((await tick()) === "unsold", "moved on before the pause ended");
      await sleep(2500);
      assert((await tick()) === "bidding", "next player not started");
      const s = await state();
      assert(s.player_id && s.player_id !== players[0].id && s.ends_at, "wrong next player");
    });
    await test("timer ends with a bid -> SOLD automatically to the highest bidder", async () => {
      const s = await state();
      await ok(rpc(owners.b.client, "place_bid", { p_tournament: t.id, p_amount: 500 }));
      await sleep(2500);
      assert((await tick()) === "sold", "not sold");
      const p = await player(s.player_id);
      assert(p.team_id === B.id && p.sold_price === 500, "sold to the wrong team / price");
      assert((await team(B.id)).spent === 500, "purse not charged");
    });
    await test("with auto-sell switched off, the timer never closes a player by itself", async () => {
      await ok(db.from("tournaments").update({ auto_close: false }).eq("id", t.id));
      await sleep(2500);
      assert((await tick()) === "bidding", "next player did not start");
      await sleep(2500);
      assert((await tick()) === "bidding", "closed although auto-close is off");
    });

    console.log("\nWebsite API (needs npm run dev)");
    const up = await fetch(APP).then(() => true, () => false);
    if (!up) {
      console.log(`  \x1b[33m- skipped: ${APP} is not running\x1b[0m`);
    } else {
      const token = (await db.auth.getSession()).data.session.access_token;
      const loginId = `t${RUN}`;
      const ownerTeam = await ok(db.from("teams").insert({ tournament_id: t.id, name: "API Team", purse: 5000 }).select().single());
      await test("organiser creates an owner login, and the owner can sign in with it", async () => {
        const res = await fetch(`${APP}/api/owner`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ teamId: ownerTeam.id, login: loginId, password: "123456" }),
        });
        const body = await res.json();
        assert(res.ok, body.error);
        const row = await team(ownerTeam.id);
        createdUsers.push(row.owner_user_id);
        const c = createClient(URL, ANON, opts);
        await ok(c.auth.signInWithPassword({ email: `${loginId}@owners.cricauction.app`, password: "123456" }));
      });
      await test("duplicate owner login ID is rejected", async () => {
        const res = await fetch(`${APP}/api/owner`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ teamId: A.id, login: loginId, password: "123456" }),
        });
        assert(res.status === 400 && /taken/.test((await res.json()).error), `got ${res.status}`);
      });
      await test("another organiser cannot create logins for this tournament's teams", async () => {
        const otherToken = (await other.client.auth.getSession()).data.session.access_token;
        const res = await fetch(`${APP}/api/owner`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${otherToken}` },
          body: JSON.stringify({ teamId: B.id, login: `x${RUN}`, password: "123456" }),
        });
        assert(res.status === 404, `got ${res.status}`);
      });

      const reg = `${APP}/api/register/${t.registration_token}`;
      const form = { Timestamp: "26/10/2026 10:00", "Full Name": "Form Player", "Mobile Number": "+91 98765 43210", "Playing Role": "all rounder", "Batting Style": "Left-hand bat", Age: "23", Village: "Habra" };
      await test("Google Form response creates a pending player with mapped fields", async () => {
        const res = await fetch(reg, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
        assert(res.ok, await res.text());
        const p = await ok(admin.from("players").select("*").eq("tournament_id", t.id).eq("name", "Form Player").single());
        assert(p.status === "pending" && p.role === "All-rounder" && p.city === "Habra" && p.age === 23 && p.base_price === 500, JSON.stringify(p));
      });
      await test("same phone number registering twice is ignored", async () => {
        const res = await fetch(reg, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, "Mobile Number": "9876543210" }) });
        assert((await res.json()).duplicate === true, "duplicate not detected");
      });
      await test("registration link form (multipart) works", async () => {
        const fd = new FormData();
        fd.set("Name", "Link Player");
        fd.set("Phone", "9123456780");
        fd.set("Role", "Bowler");
        const res = await fetch(reg, { method: "POST", body: fd });
        assert(res.ok, await res.text());
      });
      await test("closed registration is rejected", async () => {
        await ok(db.from("tournaments").update({ registration_open: false }).eq("id", t.id));
        const res = await fetch(reg, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Name: "Late" }) });
        assert(res.status === 403, `got ${res.status}`);
      });
      await test("invalid registration link is rejected", async () => {
        const res = await fetch(`${APP}/api/register/00000000-0000-0000-0000-000000000000`, { method: "POST", body: "{}" });
        assert(res.status === 404, `got ${res.status}`);
      });
      await test("Google Sheet import requires login and a Google link", async () => {
        const a = await fetch(`${APP}/api/sheet?url=x`);
        const b = await fetch(`${APP}/api/sheet?url=https://example.com`, { headers: { Authorization: `Bearer ${token}` } });
        assert(a.status === 401 && b.status === 400, `got ${a.status}/${b.status}`);
      });
      for (const page of ["/", "/login", `/live/${t.id}`, `/squads/${t.id}`, `/register/${t.registration_token}`, `/t/${t.id}/auction`]) {
        await test(`page ${page.replace(t.id, ":id").replace(t.registration_token, ":token")} loads`, async () => {
          const res = await fetch(`${APP}${page}`);
          assert(res.status === 200, `status ${res.status}`);
        });
      }
    }

    console.log("\nSite admin & pausing (needs migration 004)");
    const boss = await makeUser("site-admin", "organiser");
    await ok(admin.from("profiles").update({ is_admin: true }).eq("id", boss.user.id));
    t2 = await ok(other.client.from("tournaments").insert({ name: `TEST2 ${RUN}`, bid_timer_seconds: 0 }).select().single());
    const [T2] = await ok(other.client.from("teams").insert({ tournament_id: t2.id, name: "Team X", purse: 10000, owner_user_id: owners.c.user.id }).select());
    const [Q1, Q2] = await ok(
      other.client.from("players").insert([1, 2].map((i) => ({ tournament_id: t2.id, name: `Q${i}`, base_price: 500 }))).select(),
    );
    const access = async (client) => ok(client.rpc("my_access"));

    await test("organisers and owners cannot open the admin overview", async () => {
      await fails(rpc(other.client, "admin_overview"), /admins only/i);
      await fails(rpc(owners.c.client, "admin_overview"), /admins only/i);
    });
    await test("admin overview lists organisers, owners and tournaments with emails", async () => {
      const o = await ok(rpc(boss.client, "admin_overview"));
      assert(o.users.some((u) => u.email === other.email && u.tournament_count >= 1), "organiser missing");
      assert(o.users.some((u) => u.id === owners.c.user.id && u.role === "owner" && u.teams.length >= 1), "owner missing");
      const row = o.tournaments.find((x) => x.id === t2.id);
      assert(row && row.team_count === 1 && row.player_count === 2 && row.active, JSON.stringify(row));
    });
    await test("non-admins cannot change anyone's access", async () => {
      await fails(rpc(other.client, "admin_update_user", { p_user: other.user.id, p_changes: { is_admin: true } }), /admins only/i);
      await fails(rpc(owners.c.client, "admin_update_user", { p_user: owners.c.user.id, p_changes: { suspended: false } }), /admins only/i);
    });
    await test("organiser cannot pause or un-pause their own tournament", () =>
      fails(other.client.from("tournaments").update({ suspended: true }).eq("id", t2.id), /site admin/i));
    await test("organiser cannot hand a tournament to another account", () =>
      fails(other.client.from("tournaments").update({ organiser_id: org.user.id }).eq("id", t2.id), /site admin|row-level/i));
    await test("admin can edit and run another organiser's tournament", async () => {
      await ok(boss.client.from("tournaments").update({ venue: "Admin edit" }).eq("id", t2.id));
      await ok(rpc(boss.client, "start_player", { p_tournament: t2.id, p_player: Q1.id }));
      await ok(rpc(boss.client, "cancel_player", { p_tournament: t2.id }));
    });

    await test("paused tournament: bidding, auto timer and organiser controls all stop", async () => {
      await ok(rpc(other.client, "start_player", { p_tournament: t2.id, p_player: Q1.id }));
      await ok(boss.client.from("tournaments").update({ suspended: true, suspended_reason: "Payment pending" }).eq("id", t2.id));
      await fails(rpc(owners.c.client, "place_bid", { p_tournament: t2.id, p_amount: 500 }), /paused/i);
      assert((await ok(rpc(anon, "auction_tick", { p_tournament: t2.id }))) === "paused", "tick ran while paused");
      await fails(rpc(other.client, "close_player", { p_tournament: t2.id }), /organiser/i);
      await other.client.from("tournaments").update({ name: "renamed while paused" }).eq("id", t2.id);
      const row = await ok(admin.from("tournaments").select("name").eq("id", t2.id).single());
      assert(row.name === `TEST2 ${RUN}`, "organiser edited a paused tournament");
    });
    await test("resumed tournament works again", async () => {
      await ok(boss.client.from("tournaments").update({ suspended: false, suspended_reason: null }).eq("id", t2.id));
      await ok(rpc(owners.c.client, "place_bid", { p_tournament: t2.id, p_amount: 500 }));
    });

    await test("paused organiser: no new tournaments, bidding stops in their auctions", async () => {
      await ok(rpc(boss.client, "admin_update_user", { p_user: other.user.id, p_changes: { suspended: true, suspended_reason: "Pay first" } }));
      const a = await access(other.client);
      assert(!a.active && a.suspended_reason === "Pay first", JSON.stringify(a));
      await fails(other.client.from("tournaments").insert({ name: "blocked" }), /row-level security/i);
      await fails(rpc(owners.c.client, "place_bid", { p_tournament: t2.id, p_amount: 1000 }), /paused/i);
      const row = (await ok(rpc(boss.client, "admin_overview"))).tournaments.find((x) => x.id === t2.id);
      assert(row && !row.active, "tournament should show as not active");
    });
    await test("access-until date in the past pauses, future date restores", async () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      await ok(rpc(boss.client, "admin_update_user", { p_user: other.user.id, p_changes: { suspended: false, access_until: yesterday } }));
      assert(!(await access(other.client)).active, "expired account still active");
      await ok(rpc(boss.client, "admin_update_user", { p_user: other.user.id, p_changes: { access_until: nextMonth } }));
      assert((await access(other.client)).active, "renewed account not active");
      // Team X still leads from before the pause, so the only refusal left is "already highest" - not "paused"
      await fails(rpc(owners.c.client, "place_bid", { p_tournament: t2.id, p_amount: 1000 }), /highest bid/i);
    });
    await test("paused team owner cannot bid", async () => {
      await ok(rpc(other.client, "cancel_player", { p_tournament: t2.id }));
      await ok(rpc(other.client, "start_player", { p_tournament: t2.id, p_player: Q2.id }));
      await ok(rpc(boss.client, "admin_update_user", { p_user: owners.c.user.id, p_changes: { suspended: true } }));
      await fails(rpc(owners.c.client, "place_bid", { p_tournament: t2.id, p_amount: 500 }), /login is paused/i);
      await ok(rpc(boss.client, "admin_update_user", { p_user: owners.c.user.id, p_changes: { suspended: false } }));
      await ok(rpc(owners.c.client, "place_bid", { p_tournament: t2.id, p_amount: 500 }));
    });
    await test("team owners can never be made admin", async () => {
      await ok(rpc(boss.client, "admin_update_user", { p_user: owners.c.user.id, p_changes: { is_admin: true } }));
      assert(!(await access(owners.c.client)).is_admin, "owner became admin");
    });
    await test("admin cannot pause or demote themselves", async () => {
      await fails(rpc(boss.client, "admin_update_user", { p_user: boss.user.id, p_changes: { suspended: true } }), /own admin/i);
      await fails(rpc(boss.client, "admin_update_user", { p_user: boss.user.id, p_changes: { is_admin: false } }), /own admin/i);
    });
    if (up) {
      await test("admin user API: only admins can reset passwords", async () => {
        const call = async (client) =>
          fetch(`${APP}/api/admin/user`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${(await client.auth.getSession()).data.session.access_token}` },
            body: JSON.stringify({ action: "password", userId: owners.d.user.id, password: "newpass1" }),
          });
        const denied = await call(other.client);
        const allowed = await call(boss.client);
        assert(denied.status === 403 && allowed.ok, `got ${denied.status}/${allowed.status}`);
      });
      await test("admin can manage team owner logins in any tournament", async () => {
        const res = await fetch(`${APP}/api/owner`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${(await boss.client.auth.getSession()).data.session.access_token}` },
          body: JSON.stringify({ teamId: T2.id, login: `adm${RUN}`, password: "secret1" }),
        });
        assert(res.ok, await res.text());
      });
    }

    console.log("\nUp next (needs migration 005)");
    t3 = await ok(db.from("tournaments").insert({ name: `TEST3 ${RUN}`, bid_timer_seconds: 0, result_pause_seconds: 2 }).select().single());
    await ok(db.from("teams").insert({ tournament_id: t3.id, name: "Team N", purse: 10000, owner_user_id: owners.b.user.id }).select());
    const [R1, R2, R3] = await ok(db.from("players").insert([1, 2, 3].map((i) => ({ tournament_id: t3.id, name: `R${i}`, base_price: 500 }))).select());
    const state3 = async () => ok(admin.from("auction_state").select("*").eq("tournament_id", t3.id).single());

    await test("starting a player also picks who is up next (never the one on stage)", async () => {
      await ok(rpc(db, "start_player", { p_tournament: t3.id, p_player: R1.id }));
      const s = await state3();
      assert(s.next_player_id && s.next_player_id !== R1.id, JSON.stringify(s));
    });
    await test("team owners cannot change who is next", () =>
      fails(rpc(owners.b.client, "set_next_player", { p_tournament: t3.id, p_player: R3.id }), /organiser/i));
    await test("organiser can choose the next player, but not the one on stage", async () => {
      await ok(rpc(db, "set_next_player", { p_tournament: t3.id, p_player: R3.id }));
      assert((await state3()).next_player_id === R3.id, "next not set");
      await fails(rpc(db, "set_next_player", { p_tournament: t3.id, p_player: R1.id }), /not available/i);
    });
    await test("after SOLD, the automatic flow brings the chosen next player and picks a new one", async () => {
      await ok(rpc(owners.b.client, "place_bid", { p_tournament: t3.id, p_amount: 500 }));
      await ok(rpc(db, "close_player", { p_tournament: t3.id }));
      await sleep(2500);
      await ok(rpc(anon, "auction_tick", { p_tournament: t3.id }));
      const s = await state3();
      assert(s.phase === "bidding" && s.player_id === R3.id && s.next_player_id === R2.id, JSON.stringify(s));
    });
    await test("when the last player is on stage there is no next, and the auction ends idle", async () => {
      await ok(rpc(db, "close_player", { p_tournament: t3.id }));
      await ok(rpc(db, "start_player", { p_tournament: t3.id, p_player: R2.id }));
      assert((await state3()).next_player_id === null, "next should be empty");
      await ok(rpc(db, "close_player", { p_tournament: t3.id }));
      await sleep(2500);
      assert((await ok(rpc(anon, "auction_tick", { p_tournament: t3.id }))) === "idle", "should be idle");
    });

    console.log("\nFixtures (needs migration 006)");
    const [X1, X2] = await ok(admin.from("teams").select("id").eq("tournament_id", t3.id));
    const fixture = { tournament_id: t3.id, match_no: 1, stage: "league", round: 1, round_name: "Match 1", team_a_id: X1?.id ?? null, team_b_id: X2?.id ?? null };
    let matchId;
    await test("organiser can create matches and save fixture settings", async () => {
      matchId = (await ok(db.from("matches").insert(fixture).select().single())).id;
      await ok(db.from("tournaments").update({ fixture_settings: { format: "league", overs: 10 } }).eq("id", t3.id));
    });
    await test("team owners and other organisers cannot add or change matches", async () => {
      await fails(owners.b.client.from("matches").insert({ ...fixture, match_no: 2 }), /row-level security/i);
      await fails(other.client.from("matches").insert({ ...fixture, match_no: 3 }), /row-level security/i);
      await owners.b.client.from("matches").update({ result_text: "hacked" }).eq("id", matchId);
      const row = await ok(admin.from("matches").select("result_text").eq("id", matchId).single());
      assert(row.result_text === null, "owner changed a match");
    });
    await test("anyone (not logged in) can see fixtures and results", async () => {
      await ok(db.from("matches").update({ status: "completed", outcome: "win", winner_team_id: fixture.team_a_id, result_text: "Team N won by 5 runs" }).eq("id", matchId));
      const rows = await ok(anon.from("matches").select("*").eq("tournament_id", t3.id));
      assert(rows.length === 1 && rows[0].result_text === "Team N won by 5 runs", JSON.stringify(rows));
    });
    await test("match numbers are unique within a tournament", () => fails(db.from("matches").insert(fixture), /duplicate|unique/i));
    if (up) {
      await test("page /fixtures/:id loads", async () => {
        const res = await fetch(`${APP}/fixtures/${t3.id}`);
        assert(res.status === 200, `status ${res.status}`);
      });
    }
  } finally {
    console.log("\nCleaning up test data...");
    if (t3) await admin.from("tournaments").delete().eq("id", t3.id);
    const { data: extra } = await admin.from("teams").select("owner_user_id").eq("owner_login", `adm${RUN}`);
    for (const row of extra ?? []) if (row.owner_user_id) createdUsers.push(row.owner_user_id);
    if (t2) await admin.from("tournaments").delete().eq("id", t2.id);
    if (t) await admin.from("tournaments").delete().eq("id", t.id);
    for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
    if (t) {
      const { data: files } = await admin.storage.from("photos").list(t.id);
      if (files?.length) await admin.storage.from("photos").remove(files.map((f) => `${t.id}/${f.name}`));
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
