// Embedded PostgreSQL executes real migrations/RLS without contacting Supabase.
// Auth and storage schemas below are fixtures, not a replacement for hosted integration tests.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
const bootstrap = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
grant usage on schema auth,storage to anon,authenticated,service_role;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
grant select,insert,update,delete on storage.objects to anon,authenticated;
create publication supabase_realtime;
`;
await db.exec(bootstrap);
await db.exec(
  (await readFile("supabase/schema.sql", "utf8"))
    .split("-- CRICMATE HARDENING MIGRATIONS 011+")[0]
    .replace("create extension if not exists pgcrypto;", ""),
);
for (const name of [
  "011_registration_security",
  "012_public_projections",
  "013_scoring_actions",
  "014_scheduler_audit_sponsors",
  "015_upload_recovery",
  "016_organiser_player_writes",
  "017_auction_serialisation",
  "018_restrict_base_reads",
  "019_player_career",
  "020_player_accounts",
  "021_restart_match",
  "022_auction_rounds",
  "023_registration_category",
  "024_registration_categories_v2",
]) {
  await db.exec(await readFile(`supabase/migrations/${name}.sql`, "utf8"));
  console.log(`PASS migration ${name}`);
}
let passed = 0;
async function check(name, fn) {
  await fn();
  console.log(`PASS ${name}`);
  passed++;
}
const ids = {
  org: "00000000-0000-4000-8000-000000000001",
  other: "00000000-0000-4000-8000-000000000002",
  owner: "00000000-0000-4000-8000-000000000003",
  t: "00000000-0000-4000-8000-000000000010",
  token: "00000000-0000-4000-8000-000000000020",
};
for (const id of [ids.org, ids.other, ids.owner])
  await db.query("insert into auth.users(id,email) values($1,$2)", [id, `${id}@example.invalid`]);
await db.query("insert into public.tournaments(id,organiser_id,name,registration_token) values($1,$2,$3,$4)", [
  ids.t,
  ids.org,
  "Test tournament",
  ids.token,
]);
async function as(role, id, sql, params = []) {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
    await db.exec("select set_config('request.jwt.claim.sub','',false)");
  }
}
await check("anonymous and unrelated accounts cannot read base tournament secrets", async () => {
  for (const [role, id] of [
    ["anon", null],
    ["authenticated", ids.other],
  ]) {
    assert.equal((await as(role, id, "select * from public.tournaments")).rows.length, 0);
    const row = (await as(role, id, "select * from public.tournament_display")).rows[0];
    assert.equal(row.registration_token, null);
    assert.equal(row.organiser_id, null);
  }
  assert.equal(
    (await as("authenticated", ids.org, "select registration_token from public.tournaments")).rows[0].registration_token,
    ids.token,
  );
});
await check("photo insert and update enforce tournament ownership", async () => {
  await as("authenticated", ids.org, "insert into storage.objects(bucket_id,name) values($1,$2)", ["photos", `${ids.t}/photo.jpg`]);
  await assert.rejects(
    as("authenticated", ids.other, "insert into storage.objects(bucket_id,name) values($1,$2)", ["photos", `${ids.t}/evil.jpg`]),
  );
  const result = await as("authenticated", ids.other, "update storage.objects set name=$1 returning id", [`${ids.t}/changed.jpg`]);
  assert.equal(result.rows.length, 0);
  await assert.rejects(
    as("authenticated", ids.org, "insert into storage.objects(bucket_id,name) values($1,$2)", ["photos", "invalid/path.jpg"]),
  );
});
const player = { name: "Ravi", phone: "+919876543210", age: 22 };
const register = () => db.query("select public.register_player($1,$2,$3) result", [ids.token, player, "google-form"]);
await check("registration and contact are atomic and duplicate retries create one player", async () => {
  assert.equal((await register()).rows[0].result.duplicate, false);
  assert.equal((await register()).rows[0].result.duplicate, true);
  assert.equal((await db.query("select count(*)::int n from public.players")).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int n from public.player_contacts")).rows[0].n, 1);
});
await check("contact-write failure rolls player insertion back", async () => {
  await db.exec(
    "create function public.fail_contact_test() returns trigger language plpgsql as $$ begin raise exception 'simulated contact failure'; end $$; create trigger fail_contact_test before insert on public.player_contacts for each row execute function public.fail_contact_test();",
  );
  await assert.rejects(
    db.query("select public.register_player($1,$2,$3)", [ids.token, { ...player, phone: "+919876543211" }, "google-form"]),
  );
  assert.equal((await db.query("select count(*)::int n from public.players")).rows[0].n, 1);
  await db.exec("drop trigger fail_contact_test on public.player_contacts");
});
await check("closed and suspended tournaments reject registration", async () => {
  await db.query("update public.tournaments set registration_open=false where id=$1", [ids.t]);
  await assert.rejects(register());
  await db.query("update public.tournaments set registration_open=true,suspended=true where id=$1", [ids.t]);
  await assert.rejects(register());
  await db.query("update public.tournaments set suspended=false where id=$1", [ids.t]);
});
await check("audit history cannot be forged or edited", async () => {
  await assert.rejects(
    as("authenticated", ids.org, "insert into public.audit_history(tournament_id,action,actor_kind) values($1,$2,$3)", [
      ids.t,
      "forged",
      "account",
    ]),
  );
  await assert.rejects(as("authenticated", ids.org, "delete from public.audit_history"));
});
await check("public callers cannot execute service registration and scheduler functions", async () => {
  await assert.rejects(as("anon", null, "select public.register_player($1,$2,$3)", [ids.token, player, "google-form"]));
  await assert.rejects(as("anon", null, "select public.tick_due_auctions()"));
});

const teamA = "00000000-0000-4000-8000-000000000030",
  teamB = "00000000-0000-4000-8000-000000000031",
  match = "00000000-0000-4000-8000-000000000040";
await db.query(
  "insert into public.teams(id,tournament_id,name,purse,owner_user_id,owner_login) values($1,$3,'Royals',100000,$4,'private-login'),($2,$3,'Lions',100000,null,null)",
  [teamA, teamB, ids.t, ids.owner],
);
await check("owner sees their own login but unrelated accounts and anonymous viewers do not", async () => {
  for (const [role, id] of [
    ["anon", null],
    ["authenticated", ids.other],
  ]) {
    const rows = (await as(role, id, "select owner_login,owner_user_id from public.team_display")).rows;
    assert.ok(rows.every((r) => r.owner_login === null && r.owner_user_id === null));
  }
  assert.equal(
    (await as("authenticated", ids.owner, "select owner_login from public.team_display where id=$1", [teamA])).rows[0].owner_login,
    "private-login",
  );
});
await check("sponsor edits require organiser access", async () => {
  await assert.rejects(as("authenticated", ids.other, "insert into public.sponsors(tournament_id,name) values($1,'Forged')", [ids.t]));
  await as("authenticated", ids.org, "insert into public.sponsors(tournament_id,name) values($1,'Community sponsor')", [ids.t]);
});
await db.query(
  "insert into public.matches(id,tournament_id,match_no,stage,round_name,team_a_id,team_b_id) values($1,$2,1,'league','League',$3,$4)",
  [match, ids.t, teamA, teamB],
);
await as("authenticated", ids.org, "select public.scorer_claim($1,'','device-a','Scorer A',false)", [match]);
let revision = Number((await db.query("select score_revision from public.matches where id=$1", [match])).rows[0].score_revision);
const action = "00000000-0000-4000-8000-000000000050",
  undoAction = "00000000-0000-4000-8000-000000000051";
const actionSql = "select public.scorer_action($1,'','device-a',$2,$3,$4,$5,$6,$7) revision";
const actionArgs = [match, action, revision, "event", 1, { type: "toss", winner: teamA, decision: "bat" }, {}];
await check("scoring retries are idempotent and conflicting revisions are rejected", async () => {
  const first = await as("authenticated", ids.org, actionSql, actionArgs);
  const retry = await as("authenticated", ids.org, actionSql, actionArgs);
  assert.equal(first.rows[0].revision, retry.rows[0].revision);
  assert.equal((await db.query("select count(*)::int n from public.match_events where match_id=$1", [match])).rows[0].n, 1);
  await assert.rejects(as("authenticated", ids.org, actionSql, [match, crypto.randomUUID(), revision, "event", 2, { type: "ball" }, {}]));
  await assert.rejects(as("authenticated", ids.org, actionSql, [...actionArgs.slice(0, 5), { type: "swap" }, {}]));
  revision = Number(first.rows[0].revision);
});
await check("Undo retries cannot remove a second ball", async () => {
  const args = [match, undoAction, revision, "undo", 1, {}, {}];
  const result = await as("authenticated", ids.org, actionSql, args);
  await as("authenticated", ids.org, actionSql, args);
  assert.equal((await db.query("select count(*)::int n from public.match_events where match_id=$1", [match])).rows[0].n, 0);
  revision = Number(result.rows[0].revision);
});
await check("takeover protects pending input even without any new ball", async () => {
  await as("authenticated", ids.org, "select public.scorer_claim($1,'','device-b','Scorer B',true)", [match]);
  await assert.rejects(
    as("authenticated", ids.org, actionSql, [match, crypto.randomUUID(), revision, "event", 1, { type: "toss" }, {}]),
    /took over/,
  );
  await as("authenticated", ids.org, "select public.scorer_claim($1,'','device-a','Scorer A',true)", [match]);
  await assert.rejects(
    as("authenticated", ids.org, actionSql, [match, crypto.randomUUID(), revision, "event", 1, { type: "toss" }, {}]),
    /Score changed/,
  );
});
await check("suspension blocks writes including storage and scoring", async () => {
  await db.query("update public.profiles set suspended=true where id=$1", [ids.org]);
  await assert.rejects(
    as("authenticated", ids.org, "insert into storage.objects(bucket_id,name) values($1,$2)", ["photos", `${ids.t}/paused.jpg`]),
  );
  await assert.rejects(
    as("authenticated", ids.org, actionSql, [match, crypto.randomUUID(), revision, "event", 1, { type: "toss" }, {}]),
    /paused/,
  );
  await db.query("update public.profiles set suspended=false where id=$1", [ids.org]);
});
await check("same player can register in a different tournament", async () => {
  const other = (
    await db.query("insert into public.tournaments(organiser_id,name) values($1,'Second') returning registration_token", [ids.org])
  ).rows[0];
  const result = await db.query("select public.register_player($1,$2,$3) result", [other.registration_token, player, "google-form"]);
  assert.equal(result.rows[0].result.duplicate, false);
});
await check("scheduler tick closes an expired auction without any browser", async () => {
  const playerId = (await db.query("select id from public.players where tournament_id=$1 limit 1", [ids.t])).rows[0].id;
  await db.query("update public.players set status='available' where id=$1", [playerId]);
  await as("authenticated", ids.org, "select public.start_player($1,$2)", [ids.t, playerId]);
  await db.query("update public.auction_state set ends_at=now()-interval '1 second' where tournament_id=$1", [ids.t]);
  await assert.rejects(as("authenticated", ids.owner, "select public.place_bid($1,500)", [ids.t]), /Time is up/);
  await db.exec("select public.tick_due_auctions();select public.tick_due_auctions();");
  assert.equal((await db.query("select status from public.players where id=$1", [playerId])).rows[0].status, "unsold");
  await db.query("update public.auction_state set updated_at=now()-interval '1 minute' where tournament_id=$1", [ids.t]);
  await db.exec("select public.tick_due_auctions()");
  assert.equal((await db.query("select phase from public.auction_state where tournament_id=$1", [ids.t])).rows[0].phase, "idle");
});

await check("imports roll back every player when any contact is invalid", async () => {
  const before = (await db.query("select count(*)::int n from public.players")).rows[0].n;
  await assert.rejects(
    as("authenticated", ids.org, "select public.import_players($1,$2)", [
      ids.t,
      [
        { name: "Good", phone: "9876543290", base_price: 500 },
        { name: "Bad", phone: "invalid", base_price: 500 },
      ],
    ]),
  );
  assert.equal((await db.query("select count(*)::int n from public.players")).rows[0].n, before);
  await as("authenticated", ids.org, "select public.import_players($1,$2)", [
    ids.t,
    [{ name: "Imported", phone: "9876543290", base_price: 500 }],
  ]);
  await assert.rejects(
    as("authenticated", ids.other, "select public.import_players($1,$2)", [ids.t, [{ name: "No access", base_price: 500 }]]),
  );
});
await check("rate limits are shared and reset only after the time window", async () => {
  for (const expected of [true, true, false])
    assert.equal((await db.query("select public.registration_allow('test-key',2) allowed")).rows[0].allowed, expected);
  await db.exec("update public.registration_limits set window_at=now()-interval '2 minutes'");
  assert.equal((await db.query("select public.registration_allow('test-key',2) allowed")).rows[0].allowed, true);
});
await check("abandoned uploads can be claimed, referenced uploads cannot", async () => {
  const path = ids.t + "/abandoned.jpg",
    url = "https://example.invalid/storage/v1/object/public/photos/" + path;
  await db.query("insert into public.registration_uploads(path,url,created_at) values($1,$2,now()-interval '2 days')", [path, url]);
  assert.equal((await db.query("select * from public.claim_abandoned_uploads()")).rows[0].path, path);
  await assert.rejects(
    db.query("select public.register_player($1,$2,$3)", [
      ids.token,
      { name: "Late upload", phone: "9876543289", photo_url: url },
      "registration-link",
    ]),
    /Photo expired/,
  );
  const path2 = ids.t + "/saved.jpg",
    url2 = "https://example.invalid/storage/v1/object/public/photos/" + path2;
  await db.query("insert into public.registration_uploads(path,url,created_at) values($1,$2,now()-interval '2 days')", [path2, url2]);
  await db.query("select public.register_player($1,$2,$3)", [
    ids.token,
    { name: "Saved photo", phone: "9876543288", photo_url: url2 },
    "registration-link",
  ]);
  assert.ok((await db.query("select * from public.claim_abandoned_uploads()")).rows.every((row) => row.path !== path2));
});

await check("PIN scorer permissions and admin visibility remain intact", async () => {
  const pin = (await as("authenticated", ids.org, "select public.scorer_pin($1) pin", [match])).rows[0].pin;
  await as("anon", null, "select public.scorer_claim($1,$2,$3,$4,true)", [match, pin, "pin-device", "Volunteer"]);
  const revision = Number((await db.query("select score_revision from public.matches where id=$1", [match])).rows[0].score_revision);
  const args = [match, pin, "pin-device", crypto.randomUUID(), revision, "event", 1, { type: "toss", winner: teamA, decision: "bat" }, {}];
  await as("anon", null, "select public.scorer_action($1,$2,$3,$4,$5,$6,$7,$8,$9)", args);
  await assert.rejects(
    as("anon", null, "select public.scorer_action($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
      match,
      "wrong",
      "pin-device",
      crypto.randomUUID(),
      revision + 1,
      "event",
      2,
      { type: "swap" },
      {},
    ]),
    /Wrong PIN/,
  );
  await db.query("update public.profiles set is_admin=true where id=$1", [ids.other]);
  assert.equal(
    (await as("authenticated", ids.other, "select registration_token from public.tournament_display where id=$1", [ids.t])).rows[0]
      .registration_token,
    ids.token,
  );
  await db.query("update public.profiles set is_admin=false where id=$1", [ids.other]);
});
await check("bids enforce purse, squad, suspension and exactly-once settlement", async () => {
  const p = (
    await db.query("insert into public.players(tournament_id,name,base_price) values($1,'Auction regression',500) returning id", [ids.t])
  ).rows[0].id;
  await db.query("update public.teams set owner_user_id=$1,purse=0 where id=$2", [ids.other, teamB]);
  await as("authenticated", ids.org, "select public.start_player($1,$2)", [ids.t, p]);
  await assert.rejects(as("authenticated", ids.other, "select public.place_bid($1,500)", [ids.t]), /purse/);
  await db.query("update public.profiles set suspended=true where id=$1", [ids.owner]);
  await assert.rejects(as("authenticated", ids.owner, "select public.place_bid($1,500)", [ids.t]), /paused/);
  await db.query("update public.profiles set suspended=false where id=$1", [ids.owner]);
  await as("authenticated", ids.owner, "select public.place_bid($1,500)", [ids.t]);
  await assert.rejects(as("authenticated", ids.owner, "select public.place_bid($1,1000)", [ids.t]), /highest bid/);
  await db.query("update public.teams set purse=100000 where id=$1", [teamB]);
  await db.query("update public.tournaments set max_squad=1 where id=$1", [ids.t]);
  const full = (
    await db.query(
      "insert into public.players(tournament_id,name,base_price,status,team_id,sold_price) values($1,'Full squad',500,'sold',$2,0) returning id",
      [ids.t, teamB],
    )
  ).rows[0].id;
  await assert.rejects(as("authenticated", ids.other, "select public.place_bid($1,1000)", [ids.t]), /Squad is full/);
  await db.query("delete from public.players where id=$1", [full]);
  await db.query("update public.auction_state set ends_at=now()-interval '1 second' where tournament_id=$1", [ids.t]);
  await db.exec("select public.tick_due_auctions(); select public.tick_due_auctions();");
  assert.equal((await db.query("select spent from public.teams where id=$1", [teamA])).rows[0].spent, 500);
  await as("authenticated", ids.org, "select public.reset_auction($1)", [ids.t]);
  assert.equal((await db.query("select spent from public.teams where id=$1", [teamA])).rows[0].spent, 0);
});
await check("legacy duplicates stop migration without deleting player records", async () => {
  await db.exec("drop index public.contacts_tournament_mobile_unique");
  const dup = (
    await db.query("insert into public.players(tournament_id,name,base_price) values($1,'Duplicate legacy record',500) returning id", [
      ids.t,
    ])
  ).rows[0].id;
  await db.query("insert into public.player_contacts values($1,$2,$3)", [dup, ids.t, player.phone]);
  const before = (await db.query("select count(*)::int n from public.players")).rows[0].n;
  await assert.rejects(db.exec(await readFile("supabase/migrations/011_registration_security.sql", "utf8")), /Duplicate mobile/);
  await db.exec("rollback");
  assert.equal((await db.query("select count(*)::int n from public.players")).rows[0].n, before);
});
await check("restart match: organiser only; toss, balls, result and stats go; playing XIs stay; score revision moves", async () => {
  const m = crypto.randomUUID();
  await db.query(
    "insert into public.matches(id,tournament_id,match_no,stage,round_name,team_a_id,team_b_id,status,outcome,winner_team_id,result_text,a_runs,live_score) values($1,$2,50,'league','League',$3,$4,'completed','win',$3,'Royals won',120,'{}')",
    [m, ids.t, teamA, teamB],
  );
  await db.query("insert into public.match_events(match_id,tournament_id,seq,type,data) values($1,$2,1,'toss','{}'),($1,$2,2,'ball','{}')", [m, ids.t]);
  await db.query("insert into public.match_players(match_id,tournament_id,team_id,name) values($1,$2,$3,'Opener'),($1,$2,$4,'Bowler')", [m, ids.t, teamA, teamB]);
  await db.query("insert into public.player_match_stats(match_id,match_player_id,tournament_id,team_id,name) values($1,gen_random_uuid(),$2,$3,'Opener')", [m, ids.t, teamA]);
  const before = Number((await db.query("select score_revision from public.matches where id=$1", [m])).rows[0].score_revision);
  for (const [role, id] of [["anon", null], ["authenticated", ids.other], ["authenticated", ids.owner]])
    await assert.rejects(as(role, id, "select public.restart_match($1)", [m]));
  await as("authenticated", ids.org, "select public.restart_match($1)", [m]);
  const row = (await db.query("select * from public.matches where id=$1", [m])).rows[0];
  assert.equal(row.status, "scheduled");
  assert.equal(row.result_text, null);
  assert.equal(row.winner_team_id, null);
  assert.equal(row.a_runs, null);
  assert.equal(row.live_score, null);
  assert.ok(Number(row.score_revision) > before, "revision must move so old scorer phones stop");
  const count = async (table) => (await db.query(`select count(*)::int n from public.${table} where match_id=$1`, [m])).rows[0].n;
  assert.equal(await count("match_events"), 0);
  assert.equal(await count("player_match_stats"), 0);
  assert.equal(await count("match_players"), 2);
});
await check("restart is refused while a later knockout using the result is under way, then empties its slot", async () => {
  const semi = crypto.randomUUID(),
    final = crypto.randomUUID();
  await db.query(
    "insert into public.matches(id,tournament_id,match_no,stage,round_name,team_a_id,team_b_id,status,outcome,winner_team_id) values($1,$2,51,'knockout','Semi',$3,$4,'completed','win',$3)",
    [semi, ids.t, teamA, teamB],
  );
  await db.query(
    `insert into public.matches(id,tournament_id,match_no,stage,round_name,team_a_id,a_source,b_source,status) values($1,$2,52,'knockout','Final',$3,'{"type":"winner","match":51}','{"type":"winner","match":53}','live')`,
    [final, ids.t, teamA],
  );
  await assert.rejects(as("authenticated", ids.org, "select public.restart_match($1)", [semi]), /Restart match 52 first/);
  assert.equal((await db.query("select status from public.matches where id=$1", [semi])).rows[0].status, "completed");
  await db.query("update public.matches set status='scheduled' where id=$1", [final]);
  await as("authenticated", ids.org, "select public.restart_match($1)", [semi]);
  assert.equal((await db.query("select team_a_id from public.matches where id=$1", [final])).rows[0].team_a_id, null);
});
await check("account roles: sign-ups stay organisers, owners and players get their own role, players cannot organise", async () => {
  const [plain, owner, player] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await db.query(
    `insert into auth.users(id,email,raw_app_meta_data) values($1,'plain@example.invalid','{}'),($2,'own@example.invalid','{"role":"owner"}'),($3,'9876543210@players.cricauction.app','{"role":"player"}')`,
    [plain, owner, player],
  );
  const role = async (id) => (await db.query("select role from public.profiles where id=$1", [id])).rows[0].role;
  assert.equal(await role(plain), "organiser");
  assert.equal(await role(owner), "owner");
  assert.equal(await role(player), "player");
  await assert.rejects(as("authenticated", player, "insert into public.tournaments(organiser_id,name) values($1,'Not allowed')", [player]));
  await as("authenticated", plain, "insert into public.tournaments(organiser_id,name) values($1,'Still allowed')", [plain]);
  await assert.rejects(as("authenticated", player, "select * from public.player_accounts"));
  await assert.rejects(as("authenticated", player, "select * from public.player_invites"));
});
await check("player profile: pending players hidden; tournaments linked by mobile and first name only", async () => {
  const t2 = crypto.randomUUID(),
    t3 = crypto.randomUUID(),
    t4 = crypto.randomUUID();
  for (const [id, name] of [[t2, "Second cup"], [t3, "Third cup"], [t4, "Fourth cup"]])
    await db.query("insert into public.tournaments(id,organiser_id,name) values($1,$2,$3)", [id, ids.org, name]);
  const add = async (t, name, status) => {
    const id = (await db.query("insert into public.players(tournament_id,name,base_price,status) values($1,$2,500,$3) returning id", [t, name, status])).rows[0].id;
    await db.query("insert into public.player_contacts(player_id,tournament_id,phone) values($1,$2,'+91 98111 22233')", [id, t]);
    return id;
  };
  const me = await add(ids.t, "Rahul Das", "available");
  await add(t2, "RAHUL Kumar Das", "available"); // same person, other spelling
  const pending = await add(t3, "Rahul Das", "pending");
  await add(t4, "Amit Das", "available"); // shares the family phone: kept apart
  const career = (await as("anon", null, "select public.player_career($1) c", [me])).rows[0].c;
  assert.deepEqual(career.entries.map((e) => e.tournament).sort(), ["Second cup", "Test tournament"]);
  assert.ok(!JSON.stringify(career).includes("98111"), "phone number must never be returned");
  assert.equal((await as("anon", null, "select public.player_career($1) c", [pending])).rows[0].c, null);
});
await check("auction rounds: organiser only; random and automatic picks stay inside the chosen category / role", async () => {
  const t5 = crypto.randomUUID();
  await db.query("insert into public.tournaments(id,organiser_id,name) values($1,$2,'Rounds cup')", [t5, ids.org]);
  const add = async (name, category, role) =>
    (await db.query("insert into public.players(tournament_id,name,base_price,category,role) values($1,$2,500,$3,$4) returning id", [t5, name, category, role]))
      .rows[0].id;
  const aBat1 = await add("A bat one", "A", "Batsman");
  const aBat2 = await add("A bat two", " a ", "batsman"); // spacing / case from a spreadsheet
  const aBowl = await add("A bowl", "A", "Bowler");
  const bBowl = await add("B bowl", "B", "Bowler");
  const noCat = await add("No category", null, "Batsman");
  const state = async () => (await db.query("select * from public.auction_state where tournament_id=$1", [t5])).rows[0];
  const setPool = (cats, roles, who = ids.org) => as("authenticated", who, "select public.set_auction_pool($1,$2,$3)", [t5, cats, roles]);

  // before any round is chosen nothing changes: everyone can come up
  assert.equal((await state()).pool_categories, null);
  assert.equal((await state()).pool_roles, null);
  await assert.rejects(setPool(["A"], null, ids.other), /organiser/);
  await assert.rejects(as("anon", null, "select public.set_auction_pool($1,$2,$3)", [t5, ["A"], null]));

  await setPool(["a"], ["BOWLER"]);
  let s = await state();
  assert.deepEqual(s.pool_categories, ["a"]);
  assert.equal(s.next_player_id, aBowl, "only A bowler fits");
  await as("authenticated", ids.org, "select public.start_player($1,$2)", [t5, aBowl]);
  assert.equal((await state()).next_player_id, null, "nobody else is in this round");
  await as("authenticated", ids.org, "select public.close_player($1)", [t5]);
  await db.query("update public.auction_state set updated_at=now()-interval '1 minute' where tournament_id=$1", [t5]);
  await db.query("select public.auction_tick($1)", [t5]);
  s = await state();
  assert.equal(s.phase, "idle", "round finished: auction waits for the organiser instead of bringing a B player");

  // batsmen of category A only: never B, never the player without category
  await setPool(["A"], ["Batsman"]);
  for (let i = 0; i < 25; i++) {
    const id = (await db.query("select public.pick_next_player($1,null) id", [t5])).rows[0].id;
    assert.ok([aBat1, aBat2].includes(id), "picked outside the round");
  }
  // a hand-picked next player inside the round is kept, outside the round is replaced
  await as("authenticated", ids.org, "select public.set_next_player($1,$2)", [t5, aBat2]);
  await setPool(["A", "B"], ["Batsman"]);
  assert.equal((await state()).next_player_id, aBat2);
  await setPool(["B"], null);
  assert.equal((await state()).next_player_id, bBowl);
  // roles only, then clear: empty lists mean everyone again
  await setPool([], ["Batsman"]);
  s = await state();
  assert.equal(s.pool_categories, null);
  assert.ok([aBat1, aBat2, noCat].includes(s.next_player_id));
  await setPool([], []);
  s = await state();
  assert.equal(s.pool_roles, null);
  assert.ok([aBat1, aBat2, bBowl, noCat].includes(s.next_player_id));
  // suspended tournaments cannot change rounds
  await db.query("update public.tournaments set suspended=true where id=$1", [t5]);
  await assert.rejects(setPool(["A"], null), /organiser|paused/);
  await db.query("update public.tournaments set suspended=false where id=$1", [t5]);
});
await check("auction rounds: Under 19 / Local / Marquee / Ranji combined with player type", async () => {
  const t6 = crypto.randomUUID();
  await db.query("insert into public.tournaments(id,organiser_id,name) values($1,$2,'Local premier league')", [t6, ids.org]);
  const made = {};
  for (const cat of ["Under 19", "Local", "Marquee", "Ranji"])
    for (const role of ["Batsman", "Bowler", "All-rounder", "Wicket-keeper"])
      made[`${cat}|${role}`] = (
        await db.query("insert into public.players(tournament_id,name,base_price,category,role) values($1,$2,500,$3,$4) returning id", [
          t6,
          `${cat} ${role}`,
          cat,
          role,
        ])
      ).rows[0].id;
  const before = (await db.query("select count(*)::int n from public.players where tournament_id=$1", [t6])).rows[0].n;
  const pick = async () => (await db.query("select public.pick_next_player($1,null) id", [t6])).rows[0].id;
  const allowed = (cats, roles) => cats.flatMap((c) => roles.map((r) => made[`${c}|${r}`]));
  const rounds = [
    [["Under 19"], ["Batsman"]],
    [["Under 19", "Ranji"], ["Bowler"]],
    [["Marquee"], []],
    [[], ["Wicket-keeper"]],
    [["local"], ["batsman", "BOWLER"]],
  ];
  for (const [cats, roles] of rounds) {
    await as("authenticated", ids.org, "select public.set_auction_pool($1,$2,$3)", [t6, cats, roles]);
    const ok = allowed(
      cats.length ? cats.map((c) => ["Under 19", "Local", "Marquee", "Ranji"].find((x) => x.toLowerCase() === c.toLowerCase())) : ["Under 19", "Local", "Marquee", "Ranji"],
      roles.length ? roles.map((r) => ["Batsman", "Bowler", "All-rounder", "Wicket-keeper"].find((x) => x.toLowerCase() === r.toLowerCase())) : ["Batsman", "Bowler", "All-rounder", "Wicket-keeper"],
    );
    assert.ok(ok.includes((await db.query("select next_player_id from public.auction_state where tournament_id=$1", [t6])).rows[0].next_player_id));
    for (let i = 0; i < 20; i++) assert.ok(ok.includes(await pick()), `round ${JSON.stringify([cats, roles])} picked outside`);
  }
  // running a whole round: Ranji bowlers + all-rounders come up, then the auction stops; nobody is deleted
  await as("authenticated", ids.org, "select public.set_auction_pool($1,$2,$3)", [t6, ["Ranji"], ["Bowler", "All-rounder"]]);
  const seen = [];
  let next = (await db.query("select next_player_id from public.auction_state where tournament_id=$1", [t6])).rows[0].next_player_id;
  await as("authenticated", ids.org, "select public.start_player($1,$2)", [t6, next]);
  for (;;) {
    const s = (await db.query("select * from public.auction_state where tournament_id=$1", [t6])).rows[0];
    if (s.phase === "idle") break;
    seen.push(s.player_id);
    await as("authenticated", ids.org, "select public.close_player($1)", [t6]);
    await db.query("update public.auction_state set updated_at=now()-interval '1 minute' where tournament_id=$1", [t6]);
    await db.query("select public.auction_tick($1)", [t6]);
  }
  assert.deepEqual(seen.sort(), [made["Ranji|Bowler"], made["Ranji|All-rounder"]].sort());
  assert.equal((await db.query("select count(*)::int n from public.players where tournament_id=$1", [t6])).rows[0].n, before);
});
await check("registration saves only the 6 player categories; Special, other or missing values save no category", async () => {
  const t7 = crypto.randomUUID(),
    token7 = crypto.randomUUID();
  await db.query("insert into public.tournaments(id,organiser_id,name,registration_token) values($1,$2,'Category cup',$3)", [t7, ids.org, token7]);
  const reg = async (phone, category) => {
    const r = (await db.query("select public.register_player($1,$2,'web') r", [token7, { name: `Reg ${phone}`, phone, category }])).rows[0].r;
    return (await db.query("select category, status from public.players where id=$1", [r.id])).rows[0];
  };
  assert.deepEqual(await reg("9800000001", "Outside player"), { category: "Outside player", status: "pending" });
  assert.equal((await reg("9800000002", "Local player")).category, "Local player");
  assert.equal((await reg("9800000003", "  ranji / STATE player ")).category, "Ranji / State player");
  assert.equal((await reg("9800000004", "Under 19 player")).category, "Under 19 player");
  assert.equal((await reg("9800000005", "Captain of the world")).category, null, "unknown category is not stored");
  assert.equal((await reg("9800000007", "Special player")).category, null, "players cannot make themselves Special");
  assert.equal((await reg("9800000008", "Amateur player")).category, "Amateur player");
  assert.equal((await reg("9800000009", "Professional player")).category, "Professional player");
  assert.equal((await reg("9800000006", undefined)).category, null, "older forms without a category still register");
  // a registered category works with auction rounds once the organiser approves the player
  await db.query("update public.players set status='available' where tournament_id=$1", [t7]);
  await as("authenticated", ids.org, "select public.set_auction_pool($1,$2,$3)", [t7, ["Under 19 player"], null]);
  const next = (await db.query("select p.name from public.auction_state s join public.players p on p.id=s.next_player_id where s.tournament_id=$1", [t7])).rows[0];
  assert.equal(next.name, "Reg 9800000004");
});
await check("migrations 022, 023 and 024 re-run keep every player, team, bid and auction row unchanged", async () => {
  const snapshot = async () =>
    JSON.stringify(
      await Promise.all(
        ["players", "player_contacts", "teams", "bids", "auction_state", "tournaments", "matches"].map(
          async (tbl) => (await db.query(`select * from public.${tbl} order by 1, 2`)).rows,
        ),
      ),
    );
  const before = await snapshot();
  await db.exec(await readFile("supabase/migrations/022_auction_rounds.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/023_registration_category.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/024_registration_categories_v2.sql", "utf8"));
  assert.equal(await snapshot(), before);
});
console.log(`${passed} database checks passed (embedded PostgreSQL; hosted Auth/Storage/Realtime and scheduler untested)`);
await db.close();
const fresh = new PGlite();
await fresh.exec(bootstrap);
const canonical = (await readFile("supabase/schema.sql", "utf8")).replace("create extension if not exists pgcrypto;", "");
await fresh.exec(canonical);
await fresh.exec(canonical);
await fresh.close();
console.log("PASS canonical fresh-install schema and safe rerun");
