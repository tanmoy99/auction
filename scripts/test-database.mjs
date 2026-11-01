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
console.log(`${passed} database checks passed (embedded PostgreSQL; hosted Auth/Storage/Realtime and scheduler untested)`);
await db.close();
const fresh = new PGlite();
await fresh.exec(bootstrap);
const canonical = (await readFile("supabase/schema.sql", "utf8")).replace("create extension if not exists pgcrypto;", "");
await fresh.exec(canonical);
await fresh.exec(canonical);
await fresh.close();
console.log("PASS canonical fresh-install schema and safe rerun");
