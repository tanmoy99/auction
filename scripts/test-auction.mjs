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
  console.log(`\nCricMate scenario tests (run ${RUN})\n`);
  const org = await makeUser("organiser", "organiser");
  const other = await makeUser("other-organiser", "organiser");
  const owners = {};
  for (const k of ["a", "b", "c", "d"]) owners[k] = await makeUser(`owner-${k}`, "owner");

  let t, t2, t3, t4, t5, t6, t7, teams, players;
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

    console.log("\nBall-by-ball scoring (needs migration 007)");
    t4 = await ok(db.from("tournaments").insert({ name: `TEST4 ${RUN}`, fixture_settings: { format: "league", overs: 2, wickets: 2, points: { win: 2, tie: 1, no_result: 1 } } }).select().single());
    const [S1, S2] = await ok(db.from("teams").insert([{ tournament_id: t4.id, name: "Strikers", purse: 10000 }, { tournament_id: t4.id, name: "Smashers", purse: 10000 }]).select());
    const squad = await ok(
      admin
        .from("players")
        .insert([S1, S1, S1, S2, S2, S2].map((tm, i) => ({ tournament_id: t4.id, name: `P${i + 1}`, status: "sold", team_id: tm.id, sold_price: 500, base_price: 500 })))
        .select(),
    );
    const outsider = await ok(admin.from("players").insert({ tournament_id: t4.id, name: "Not in squad", status: "available", base_price: 500 }).select().single());
    const sm = await ok(db.from("matches").insert({ tournament_id: t4.id, match_no: 1, stage: "league", round: 1, round_name: "Match 1", team_a_id: S1.id, team_b_id: S2.id }).select().single());
    const scorer = createClient(URL, ANON, opts); // a volunteer with no account
    const P = { p_match: sm.id };
    let pin;
    const ev = (client, pinValue, device, seq, data) =>
      rpc(client, "scorer_event", { ...P, p_pin: pinValue, p_device: device, p_seq: seq, p_type: data.type, p_data: data, p_live: null });

    await test("only the organiser can see or make the scorer PIN", async () => {
      await fails(rpc(anon, "scorer_pin", { p_match: sm.id }), /permission|organiser/i);
      await fails(rpc(owners.a.client, "scorer_pin", { p_match: sm.id }), /organiser/i);
      pin = await ok(rpc(db, "scorer_pin", { p_match: sm.id }));
      assert(/^\d{4}$/.test(pin), `pin ${pin}`);
      const again = await ok(rpc(db, "scorer_pin", { p_match: sm.id }));
      assert(again === pin, "PIN should stay the same unless a new one is asked for");
    });
    await test("the PIN is never readable from the database directly", async () => {
      const rows = await ok(anon.from("match_scorers").select("*"));
      const rows2 = await ok(owners.a.client.from("match_scorers").select("*"));
      assert(rows.length === 0 && rows2.length === 0, "PIN table leaked");
    });
    await test("wrong PIN is refused; right PIN lets a phone without an account score", async () => {
      const wrong = await ok(rpc(scorer, "scorer_claim", { ...P, p_pin: pin === "0000" ? "1111" : "0000", p_device: "phone-1", p_name: "Volunteer" }));
      assert(wrong.status === "wrong_pin", JSON.stringify(wrong));
      const right = await ok(rpc(scorer, "scorer_claim", { ...P, p_pin: pin, p_device: "phone-1", p_name: "Volunteer" }));
      assert(right.status === "ok", JSON.stringify(right));
    });
    await test("one phone at a time: a second phone is asked, can take over, and the first is then locked out", async () => {
      const second = await ok(rpc(anon, "scorer_claim", { ...P, p_pin: pin, p_device: "phone-2", p_name: "Other" }));
      assert(second.status === "taken" && second.device_name === "Volunteer", JSON.stringify(second));
      await ok(rpc(anon, "scorer_claim", { ...P, p_pin: pin, p_device: "phone-2", p_name: "Other", p_force: true }));
      await fails(ev(scorer, pin, "phone-1", 1, { type: "toss", winner: S1.id, decision: "bat" }), /took over/i);
      await ok(rpc(scorer, "scorer_claim", { ...P, p_pin: pin, p_device: "phone-1", p_name: "Volunteer", p_force: true }));
    });
    await test("playing XI: squad players only; guests only after the organiser approves", async () => {
      await fails(rpc(scorer, "scorer_lineup", { ...P, p_pin: pin, p_device: "phone-1", p_team: S1.id, p_players: [{ player_id: outsider.id, name: "x" }] }), /squad/i);
      const guestId = await ok(rpc(scorer, "scorer_request_guest", { ...P, p_pin: pin, p_device: "phone-1", p_team: S1.id, p_name: "Guest Guy", p_role: "Bowler" }));
      const g = await ok(anon.from("guest_players").select("status").eq("id", guestId).single());
      assert(g.status === "pending", "guest from a scorer should wait for approval");
      const xi1 = [...squad.slice(0, 3).map((p) => ({ player_id: p.id, name: p.name })), { guest_id: guestId, name: "Guest Guy" }];
      await fails(rpc(scorer, "scorer_lineup", { ...P, p_pin: pin, p_device: "phone-1", p_team: S1.id, p_players: xi1 }), /approval/i);
      await fails(owners.a.client.from("guest_players").update({ status: "approved" }).eq("id", guestId).select().single(), /row|0 rows|JSON object/i);
      await ok(db.from("guest_players").update({ status: "approved" }).eq("id", guestId));
      await ok(rpc(scorer, "scorer_lineup", { ...P, p_pin: pin, p_device: "phone-1", p_team: S1.id, p_players: xi1 }));
      await ok(rpc(scorer, "scorer_lineup", { ...P, p_pin: pin, p_device: "phone-1", p_team: S2.id, p_players: squad.slice(3).map((p) => ({ player_id: p.id, name: p.name })) }));
      const xi = await ok(anon.from("match_players").select("*").eq("match_id", sm.id));
      assert(xi.length === 7, `XI rows ${xi.length}`);
    });
    let mp;
    await test("scoring events must come in order; the match goes live with a live score", async () => {
      mp = await ok(admin.from("match_players").select("*").eq("match_id", sm.id).order("sort"));
      const a = mp.filter((x) => x.team_id === S1.id);
      const b = mp.filter((x) => x.team_id === S2.id);
      await ok(ev(scorer, pin, "phone-1", 1, { type: "toss", winner: S1.id, decision: "bat" }));
      await fails(ev(scorer, pin, "phone-1", 5, { type: "swap" }), /out of sync/i);
      await fails(ev(scorer, pin, "phone-1", 1, { type: "swap" }), /out of sync/i);
      await ok(ev(scorer, pin, "phone-1", 2, { type: "innings_start", batting_team: S1.id, bowling_team: S2.id, striker: a[0].id, non_striker: a[1].id, bowler: b[0].id }));
      await ok(
        rpc(scorer, "scorer_event", {
          ...P,
          p_pin: pin,
          p_device: "phone-1",
          p_seq: 3,
          p_type: "ball",
          p_data: { type: "ball", runs: 4, extra: null, extra_runs: 0, wicket: null },
          p_live: { innings: 1, team: S1.id, runs: 4, wickets: 0, balls: 1, target: null, overs: 2 },
        }),
      );
      const m = await ok(anon.from("matches").select("status, live_score").eq("id", sm.id).single());
      assert(m.status === "live" && m.live_score.runs === 4, JSON.stringify(m));
      const events = await ok(anon.from("match_events").select("seq").eq("match_id", sm.id));
      assert(events.length === 3, "events should be public");
    });
    await test("undo removes only the last event", async () => {
      await fails(rpc(scorer, "scorer_undo", { ...P, p_pin: pin, p_device: "phone-1", p_seq: 2, p_live: null }), /out of sync/i);
      await ok(rpc(scorer, "scorer_undo", { ...P, p_pin: pin, p_device: "phone-1", p_seq: 3, p_live: null }));
      const events = await ok(anon.from("match_events").select("seq").eq("match_id", sm.id));
      assert(events.length === 2, `events left ${events.length}`);
    });
    await test("team owners and other organisers cannot score without the PIN", async () => {
      await fails(ev(owners.a.client, "", "x", 3, { type: "swap" }), /PIN|took over/i);
      await fails(ev(other.client, "", "x", 3, { type: "swap" }), /PIN|took over/i);
      await fails(owners.a.client.from("match_events").insert({ match_id: sm.id, tournament_id: t4.id, seq: 3, type: "swap", data: {} }), /row-level security/i);
    });
    await test("finishing saves the result and player stats; scoring is then closed", async () => {
      const a0 = mp.find((x) => x.team_id === S1.id);
      const result = { outcome: "win", winner_team_id: S1.id, batting_first: "a", a_runs: 20, a_wickets: 1, a_balls: 12, b_runs: 10, b_wickets: 2, b_balls: 8, result_text: "Strikers won by 10 runs" };
      const stats = [{ match_player_id: a0.id, team_id: S1.id, did_bat: true, bat_runs: 12, bat_balls: 6, fours: 2, sixes: 0, out: false }];
      await fails(rpc(scorer, "scorer_finish", { ...P, p_pin: pin, p_device: "phone-1", p_result: { ...result, winner_team_id: t.id }, p_changes: [], p_stats: [] }), /winner/i);
      await ok(rpc(scorer, "scorer_finish", { ...P, p_pin: pin, p_device: "phone-1", p_result: result, p_changes: [], p_stats: stats }));
      const m = await ok(anon.from("matches").select("*").eq("id", sm.id).single());
      assert(m.status === "completed" && m.result_text === "Strikers won by 10 runs" && m.live_score === null, JSON.stringify(m));
      const rows = await ok(anon.from("player_match_stats").select("*").eq("match_id", sm.id));
      assert(rows.length === 1 && rows[0].bat_runs === 12 && rows[0].name === a0.name, JSON.stringify(rows));
      await fails(ev(scorer, pin, "phone-1", 3, { type: "swap" }), /finished/i);
    });
    await test("removing a result also removes the stats it produced", async () => {
      await ok(db.from("matches").update({ status: "scheduled" }).eq("id", sm.id));
      const rows = await ok(anon.from("player_match_stats").select("*").eq("match_id", sm.id));
      assert(rows.length === 0, "stats should be cleared");
    });
    await test("8 wrong PINs lock the scorer link for a while", async () => {
      for (let i = 0; i < 8; i++) await rpc(anon, "scorer_claim", { ...P, p_pin: pin === "0000" ? "1111" : "0000", p_device: "attacker", p_name: "x" });
      await fails(rpc(anon, "scorer_claim", { ...P, p_pin: pin, p_device: "attacker", p_name: "x" }), /too many/i);
      // the phone that is already scoring keeps working
      await ok(ev(scorer, pin, "phone-1", 3, { type: "swap" }));
    });
    if (up) {
      for (const page of [`/score/${sm.id}`, `/match/${sm.id}`, `/match/${sm.id}/screen`]) {
        await test(`page ${page.replace(sm.id, ":id")} loads`, async () => {
          const res = await fetch(`${APP}${page}`);
          assert(res.status === 200, `status ${res.status}`);
        });
      }
    }
    console.log("\nTeam owners add players (needs migration 008)");
    const has008 = !(await admin.from("teams").select("player_access").limit(1)).error;
    if (!has008) {
      console.log("  \x1b[33m- skipped: run supabase/migrations/008_team_players.sql in Supabase first\x1b[0m");
    } else {
      t5 = await ok(db.from("tournaments").insert({ name: `TEST5 ${RUN}`, base_price: 500, min_squad: 1, max_squad: 3 }).select().single());
      const [J1, J2] = await ok(
        db.from("teams").insert([
          { tournament_id: t5.id, name: "Join One", purse: 10000, owner_user_id: owners.a.user.id },
          { tournament_id: t5.id, name: "Join Two", purse: 10000, owner_user_id: owners.b.user.id },
        ]).select(),
      );
      const ownerA = owners.a.client;
      let link;

      await test("owner cannot get a join link before the organiser allows it", () =>
        fails(rpc(ownerA, "team_link", { p_team: J1.id }), /organiser/i));
      await test("owner cannot approve their own team directly", async () => {
        await ownerA.from("teams").update({ player_access: "approved" }).eq("id", J1.id);
        assert((await team(J1.id)).player_access === "none", "owner changed player_access");
      });
      await test("owner cannot ask on behalf of another team", () =>
        fails(rpc(owners.b.client, "request_player_access", { p_team: J1.id }), /not the owner/i));
      await test("owner asks once; the request waits for the organiser", async () => {
        await ok(rpc(ownerA, "request_player_access", { p_team: J1.id }));
        assert((await team(J1.id)).player_access === "requested", "not requested");
        await fails(rpc(ownerA, "team_link", { p_team: J1.id }), /organiser/i);
      });
      await test("organiser approves; owner then gets a stable join link", async () => {
        await ok(db.from("teams").update({ player_access: "approved" }).eq("id", J1.id));
        link = await ok(rpc(ownerA, "team_link", { p_team: J1.id }));
        assert(link && link === (await ok(rpc(ownerA, "team_link", { p_team: J1.id }))), "link changed between calls");
        // asking again after approval must not undo it
        await ok(rpc(ownerA, "request_player_access", { p_team: J1.id }));
        assert((await team(J1.id)).player_access === "approved", "request reset the approval");
      });
      await test("the public join page sees the team but never the token", async () => {
        const info = await ok(rpc(anon, "team_link_info", { p_token: link }));
        assert(info.team === "Join One" && info.open === true && info.full === false, JSON.stringify(info));
        assert(!JSON.stringify(info).includes(link), "token leaked");
        assert((await ok(rpc(anon, "team_link_info", { p_token: crypto.randomUUID() }))) === null, "unknown link returned data");
      });
      await test("join links are private (public, other owners, other organisers)", async () => {
        for (const c of [anon, owners.b.client, other.client, ownerA]) {
          const { data } = await c.from("team_links").select("*").eq("tournament_id", t5.id);
          assert(!data?.length, "team_links readable");
        }
        await fails(rpc(owners.b.client, "team_link", { p_team: J1.id }), /organiser/i);
        await fails(rpc(owners.b.client, "team_link", { p_team: J2.id }), /organiser/i);
      });
      await test("players can't be put into a team without the website", async () => {
        const args = { p_token: link, p_player: { name: "x" }, p_phone: null, p_source: "team-link" };
        await fails(rpc(anon, "add_team_player", args), /permission|not find|denied/i);
        await fails(rpc(ownerA, "add_team_player", args), /permission|not find|denied/i);
        await fails(ownerA.from("players").insert({ tournament_id: t5.id, name: "x", base_price: 500, status: "sold", team_id: J1.id }), /row-level security/i);
      });

      if (up) {
        const join = (fd, headers = {}) => fetch(`${APP}/api/join/${link}`, { method: "POST", body: fd, headers });
        const form = (name, phone) => {
          const fd = new FormData();
          fd.set("Name", name);
          if (phone) fd.set("Phone", phone);
          fd.set("Role", "Bowler");
          return fd;
        };
        const ownerToken = (await ownerA.auth.getSession()).data.session.access_token;
        await test("player fills the join link and goes straight into the squad at Rs 0", async () => {
          const res = await join(form("Link Joiner", "+91 90000 11111"));
          assert(res.ok, await res.text());
          const p = await ok(admin.from("players").select("*").eq("tournament_id", t5.id).eq("name", "Link Joiner").single());
          assert(p.status === "sold" && p.team_id === J1.id && p.sold_price === 0 && p.source === "team-link" && p.role === "Bowler", JSON.stringify(p));
          assert((await team(J1.id)).spent === 0, "purse was charged");
          const c = await ok(admin.from("player_contacts").select("phone").eq("player_id", p.id).single());
          assert(c.phone === "+91 90000 11111", "phone not saved");
        });
        await test("join link needs a mobile number, and the same number can't join twice", async () => {
          const a = await join(form("No Phone"));
          assert(a.status === 400, `got ${a.status}`);
          const b = await join(form("Again", "9000011111"));
          assert(b.status === 400 && /already registered/i.test((await b.json()).error), `got ${b.status}`);
        });
        await test("signed-in owner can add a player without a phone", async () => {
          const res = await join(form("Owner Pick"), { Authorization: `Bearer ${ownerToken}` });
          assert(res.ok, await res.text());
          const p = await ok(admin.from("players").select("*").eq("tournament_id", t5.id).eq("name", "Owner Pick").single());
          assert(p.source === "team-owner" && p.team_id === J1.id, JSON.stringify(p));
        });
        await test("squad limit is enforced", async () => {
          assert((await join(form("Third", "9000033333"))).ok, "third player rejected");
          const info = await ok(rpc(anon, "team_link_info", { p_token: link }));
          assert(info.full === true, "not marked full");
          const res = await join(form("Fourth", "9000044444"));
          assert(res.status === 400, `got ${res.status}`);
          const n = await ok(admin.from("players").select("id").eq("team_id", J1.id));
          assert(n.length === 3, `squad has ${n.length}`);
        });
        await test("owner removes only players their team added", async () => {
          const third = await ok(admin.from("players").select("id").eq("tournament_id", t5.id).eq("name", "Third").single());
          await fails(rpc(owners.b.client, "owner_remove_player", { p_player: third.id }), /not found/i);
          await ok(rpc(ownerA, "owner_remove_player", { p_player: third.id }));
          assert((await ok(admin.from("players").select("id").eq("id", third.id))).length === 0, "not removed");
          const bought = await ok(
            admin.from("players").insert({ tournament_id: t5.id, name: "Bought", base_price: 500, status: "sold", team_id: J1.id, sold_price: 700 }).select().single(),
          );
          await fails(rpc(ownerA, "owner_remove_player", { p_player: bought.id }), /organiser/i);
        });
        await test("a new link stops the old one", async () => {
          const old = link;
          link = await ok(rpc(ownerA, "team_link", { p_team: J1.id, p_new: true }));
          assert(link !== old, "token not changed");
          const res = await fetch(`${APP}/api/join/${old}`, { method: "POST", body: form("Old", "9000055555") });
          assert(res.status === 404, `got ${res.status}`);
        });
        for (const page of [`/join/${link}`, `/bid/${t5.id}/squad`]) {
          await test(`page ${page.replace(link, ":token").replace(t5.id, ":id")} loads`, async () => {
            const res = await fetch(`${APP}${page}`);
            assert(res.status === 200, `status ${res.status}`);
          });
        }
      }

      await test("organiser turning it off closes the link; added players stay", async () => {
        const before = (await ok(admin.from("players").select("id").eq("team_id", J1.id))).length;
        await ok(db.from("teams").update({ player_access: "none" }).eq("id", J1.id));
        assert((await ok(rpc(anon, "team_link_info", { p_token: link }))) === null, "old link still works");
        await fails(rpc(ownerA, "team_link", { p_team: J1.id }), /organiser/i);
        const after = (await ok(admin.from("players").select("id").eq("team_id", J1.id))).length;
        assert(before === after, `squad went from ${before} to ${after}`);
        if (up) {
          const res = await fetch(`${APP}/api/join/${link}`, { method: "POST", body: new FormData() });
          assert(res.status === 404, `got ${res.status}`);
        }
      });
      await test("another organiser cannot approve this tournament's teams", async () => {
        await other.client.from("teams").update({ player_access: "approved" }).eq("id", J2.id);
        assert((await team(J2.id)).player_access === "none", "other organiser approved");
      });
    }
    console.log("\nStart and finish the auction (needs migration 009)");
    const probe = await rpc(db, "set_auction_status", { p_tournament: crypto.randomUUID(), p_status: "live" });
    if (/could not find|does not exist/i.test(probe.error?.message ?? "")) {
      console.log("  \x1b[33m- skipped: run supabase/migrations/009_auction_lifecycle.sql in Supabase first\x1b[0m");
    } else {
      t6 = await ok(db.from("tournaments").insert({ name: `TEST6 ${RUN}`, base_price: 500, min_squad: 1, max_squad: 5, bid_timer_seconds: 0 }).select().single());
      const [F1] = await ok(db.from("teams").insert([{ tournament_id: t6.id, name: "Finish One", purse: 10000, owner_user_id: owners.c.user.id }]).select());
      const fp = await ok(
        db.from("players").insert([1, 2, 3].map((i) => ({ tournament_id: t6.id, name: `F${i}`, base_price: 500 }))).select(),
      );
      const S6 = { p_tournament: t6.id };
      const tour6 = async () => ok(admin.from("tournaments").select("status").eq("id", t6.id).single());
      const state6 = async () => ok(admin.from("auction_state").select("*").eq("tournament_id", t6.id).single());

      await test("team owners and other organisers cannot start or finish the auction", async () => {
        await fails(rpc(owners.c.client, "set_auction_status", { ...S6, p_status: "live" }), /organiser/i);
        await fails(rpc(other.client, "set_auction_status", { ...S6, p_status: "completed" }), /organiser/i);
        assert((await tour6()).status === "setup", "status changed");
      });
      await test("only live and completed are accepted", () => fails(rpc(db, "set_auction_status", { ...S6, p_status: "setup" }), /unknown/i));
      await test("organiser starts the auction", async () => {
        await ok(rpc(db, "set_auction_status", { ...S6, p_status: "live" }));
        assert((await tour6()).status === "live", "not live");
      });
      await test("can't finish while a player is on stage", async () => {
        await ok(rpc(db, "start_player", { ...S6, p_player: fp[0].id }));
        await fails(rpc(db, "set_auction_status", { ...S6, p_status: "completed" }), /close the player/i);
        assert((await tour6()).status === "live", "finished during bidding");
      });
      await test("finishing clears the stage and the up-next player", async () => {
        await ok(rpc(owners.c.client, "place_bid", { ...S6, p_amount: 500 }));
        await ok(rpc(db, "close_player", S6));
        await ok(rpc(db, "set_auction_status", { ...S6, p_status: "completed" }));
        const s = await state6();
        assert((await tour6()).status === "completed", "not completed");
        assert(s.phase === "idle" && s.player_id === null && s.next_player_id === null, JSON.stringify(s));
        assert((await player(fp[0].id)).team_id === F1.id, "the sale was lost");
      });
      await test("a finished auction takes no more players, and the timer can't restart it", async () => {
        await fails(rpc(db, "start_player", { ...S6, p_player: fp[1].id }), /finished/i);
        assert((await ok(rpc(anon, "auction_tick", S6))) === "idle", "tick changed the stage");
        await fails(rpc(owners.c.client, "place_bid", { ...S6, p_amount: 500 }), /not open/i);
      });
      await test("organiser can reopen and carry on", async () => {
        await ok(rpc(db, "set_auction_status", { ...S6, p_status: "live" }));
        await ok(rpc(db, "start_player", { ...S6, p_player: fp[1].id }));
        assert((await state6()).phase === "bidding", "player not on stage");
        await ok(rpc(db, "cancel_player", S6));
      });
      if (up) {
        await test("page /live/:id loads after finishing", async () => {
          await ok(rpc(db, "set_auction_status", { ...S6, p_status: "completed" }));
          const res = await fetch(`${APP}/live/${t6.id}`);
          assert(res.status === 200, `status ${res.status}`);
        });
      }
    }
    console.log("\nTest matches and squad roles (needs migration 010)");
    const has010 = !(await admin.from("players").select("is_captain").limit(1)).error;
    if (!has010) {
      console.log("  \x1b[33m- skipped: run supabase/migrations/010_tests_and_roles.sql in Supabase first\x1b[0m");
    } else {
      t7 = await ok(db.from("tournaments").insert({ name: `TEST7 ${RUN}`, fixture_settings: { format: "league", overs: 5, wickets: 10, points: { win: 2, tie: 1, no_result: 1 } } }).select().single());
      const [T1, T2] = await ok(
        db.from("teams").insert([
          { tournament_id: t7.id, name: "Test One", purse: 10000, owner_user_id: owners.d.user.id },
          { tournament_id: t7.id, name: "Test Two", purse: 10000, owner_user_id: owners.b.user.id },
        ]).select(),
      );
      const sq = await ok(
        admin
          .from("players")
          .insert([T1, T1, T1, T2, T2, T2].map((tm, i) => ({ tournament_id: t7.id, name: `Q${i + 1}`, status: "sold", team_id: tm.id, sold_price: 500, base_price: 500 })))
          .select(),
      );
      const role = (client, p, r, c = false, v = false, k = false) =>
        rpc(client, "set_player_role", { p_player: p.id, p_role: r, p_captain: c, p_vice: v, p_keeper: k });
      const pl = async (id) => ok(admin.from("players").select("*").eq("id", id).single());

      await test("team owner sets a player's role and makes them captain", async () => {
        await ok(role(owners.d.client, sq[0], "Bowler", true));
        const p = await pl(sq[0].id);
        assert(p.role === "Bowler" && p.is_captain && !p.is_keeper, JSON.stringify(p));
      });
      await test("there is one captain, one vice-captain and one keeper per team", async () => {
        await ok(role(owners.d.client, sq[1], "Batsman", true, false, true));
        assert(!(await pl(sq[0].id)).is_captain && (await pl(sq[1].id)).is_captain, "captaincy did not move");
        await ok(role(owners.d.client, sq[2], "Wicket-keeper", false, true, true));
        const [b, c] = [await pl(sq[1].id), await pl(sq[2].id)];
        assert(!b.is_keeper && c.is_keeper && c.is_vice_captain, "keeper did not move");
        await fails(role(owners.d.client, sq[0], null, true, true), /different players/i);
        await fails(role(owners.d.client, sq[0], "Umpire"), /unknown role/i);
      });
      await test("other owners and the public can't set roles; the organiser can", async () => {
        await fails(role(owners.b.client, sq[0], "Bowler", true), /owner or the organiser/i);
        await fails(role(anon, sq[0], "Bowler", true), /permission|owner or the organiser/i);
        await fails(owners.d.client.from("players").update({ is_captain: true }).eq("id", sq[0].id).select().single(), /row|0 rows|JSON object/i);
        await ok(role(db, sq[3], "All-rounder", true));
        assert((await pl(sq[3].id)).is_captain, "organiser could not set the captain");
      });
      await test("a released player loses captain / keeper marks", async () => {
        await ok(rpc(db, "release_player", { p_player: sq[2].id }));
        const p = await pl(sq[2].id);
        assert(!p.is_keeper && !p.is_vice_captain && p.team_id === null, JSON.stringify(p));
        await ok(rpc(db, "assign_player", { p_player: sq[2].id, p_team: T1.id, p_price: 500 }));
      });

      const tm = await ok(
        db.from("matches").insert({ tournament_id: t7.id, match_no: 1, stage: "league", round: 1, round_name: "1st Test", team_a_id: T1.id, team_b_id: T2.id, match_type: "test", days: 3 }).select().single(),
      );
      const lm = await ok(db.from("matches").insert({ tournament_id: t7.id, match_no: 2, stage: "league", round: 1, round_name: "Match 2", team_a_id: T1.id, team_b_id: T2.id }).select().single());
      const T = { p_match: tm.id, p_pin: "", p_device: "org-phone" };
      const L = { p_match: lm.id, p_pin: "", p_device: "org-phone" };
      const tev = (args, seq, data) => rpc(db, "scorer_event", { ...args, p_seq: seq, p_type: data.type, p_data: data, p_live: null });

      await test("matches are one-day by default; a Test has 1 to 5 days", async () => {
        assert(lm.match_type === "limited" && tm.match_type === "test" && tm.days === 3, `${lm.match_type} ${tm.match_type}`);
        await fails(db.from("matches").insert({ tournament_id: t7.id, match_no: 3, stage: "league", round: 1, round_name: "x", match_type: "test", days: 6 }), /check/i);
        await fails(db.from("matches").insert({ tournament_id: t7.id, match_no: 3, stage: "league", round: 1, round_name: "x", match_type: "hundred" }), /check/i);
      });
      await test("playing XI keeps the captain and keeper; only one of each", async () => {
        await ok(rpc(db, "scorer_claim", { p_match: tm.id, p_pin: "", p_device: "org-phone", p_name: "Organiser" }));
        await ok(rpc(db, "scorer_claim", { p_match: lm.id, p_pin: "", p_device: "org-phone", p_name: "Organiser" }));
        const xi = (list, cap, wk) => list.map((p, i) => ({ player_id: p.id, name: p.name, role: "Batsman", is_captain: i === cap, is_keeper: i === wk }));
        await fails(rpc(db, "scorer_lineup", { ...T, p_team: T1.id, p_players: xi(sq.slice(0, 3), 0, 1).map((x) => ({ ...x, is_captain: true })) }), /one captain/i);
        await ok(rpc(db, "scorer_lineup", { ...T, p_team: T1.id, p_players: xi(sq.slice(0, 3), 1, 2) }));
        await ok(rpc(db, "scorer_lineup", { ...T, p_team: T2.id, p_players: xi(sq.slice(3), 0, 1) }));
        const rows = await ok(anon.from("match_players").select("*").eq("match_id", tm.id).eq("team_id", T1.id).order("sort"));
        assert(rows[1].is_captain && rows[2].is_keeper && !rows[0].is_captain, JSON.stringify(rows.map((r) => [r.is_captain, r.is_keeper])));
      });
      await test("stumps, breaks and end-as-draw are for Test matches only", async () => {
        await fails(tev(L, 1, { type: "stumps" }), /only for test/i);
        await fails(tev(L, 1, { type: "end_match" }), /only for test/i);
        const mp = await ok(admin.from("match_players").select("*").eq("match_id", tm.id).order("sort"));
        const a = mp.filter((x) => x.team_id === T1.id);
        const b = mp.filter((x) => x.team_id === T2.id);
        await ok(tev(T, 1, { type: "toss", winner: T1.id, decision: "bat" }));
        await ok(tev(T, 2, { type: "innings_start", batting_team: T1.id, bowling_team: T2.id, striker: a[0].id, non_striker: a[1].id, bowler: b[0].id }));
        await ok(tev(T, 3, { type: "break", kind: "lunch" }));
        await ok(tev(T, 4, { type: "stumps" }));
        await ok(tev(T, 5, { type: "end_match" }));
      });
      await test("a Test can be drawn, saves every innings, and keeps stats per innings", async () => {
        const mp = await ok(admin.from("match_players").select("*").eq("match_id", tm.id).order("sort"));
        const a0 = mp.find((x) => x.team_id === T1.id);
        const innings = [
          { team: T1.id, runs: 120, wickets: 2, balls: 300, declared: false, follow_on: false },
          { team: T2.id, runs: 90, wickets: 2, balls: 250, declared: false, follow_on: false },
          { team: T1.id, runs: 60, wickets: 1, balls: 100, declared: true, follow_on: false },
        ];
        const result = { outcome: "draw", winner_team_id: null, batting_first: "a", a_runs: 180, a_wickets: 1, a_balls: 400, b_runs: 90, b_wickets: 2, b_balls: 250, result_text: "Match drawn", innings };
        const stats = [
          { match_player_id: a0.id, innings: 1, team_id: T1.id, did_bat: true, bat_runs: 70, bat_balls: 120, out: true },
          { match_player_id: a0.id, innings: 2, team_id: T1.id, did_bat: true, bat_runs: 40, bat_balls: 60, out: false },
        ];
        await fails(rpc(db, "scorer_finish", { ...L, p_result: { ...result, innings: null }, p_changes: [], p_stats: [] }), /only a test/i);
        await ok(rpc(db, "scorer_finish", { ...T, p_result: result, p_changes: [], p_stats: stats }));
        const m = await ok(anon.from("matches").select("*").eq("id", tm.id).single());
        assert(m.outcome === "draw" && m.status === "completed" && m.innings.length === 3 && m.innings[2].declared, JSON.stringify(m));
        const rows = await ok(anon.from("player_match_stats").select("*").eq("match_id", tm.id).order("innings"));
        assert(rows.length === 2 && rows[0].bat_runs === 70 && rows[1].innings === 2 && rows[1].bat_runs === 40, JSON.stringify(rows));
      });
      if (up) {
        for (const page of [`/match/${tm.id}`, `/fixtures/${t7.id}`, `/t/${t7.id}/fixtures`, `/squads/${t7.id}`]) {
          await test(`page ${page.replace(tm.id, ":id").replace(t7.id, ":id")} loads`, async () => {
            const res = await fetch(`${APP}${page}`);
            assert(res.status === 200, `status ${res.status}`);
          });
        }
      }
    }
  } finally {
    console.log("\nCleaning up test data...");
    if (t7) await admin.from("tournaments").delete().eq("id", t7.id);
    if (t6) await admin.from("tournaments").delete().eq("id", t6.id);
    if (t5) await admin.from("tournaments").delete().eq("id", t5.id);
    if (t4) await admin.from("tournaments").delete().eq("id", t4.id);
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
