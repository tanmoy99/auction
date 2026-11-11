// Organiser fixtures screen in a real browser, against a mocked Supabase (nothing leaves this computer):
// "Add match", "Restart match" on a started match, and "Make your own" fixtures.   npm run test:organiser-fixtures
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.TEST_APP_URL ?? "http://localhost:3100";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw Error("Local app required");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!supabaseUrl) throw Error("NEXT_PUBLIC_SUPABASE_URL is needed to name the mocked session (it is never contacted)");
const ref = new URL(supabaseUrl).hostname.split(".")[0];

const org = "00000000-0000-4000-8000-000000000001";
const t = "00000000-0000-4000-8000-000000000010";
const teams = ["A", "B", "C", "D"].map((x, i) => ({
  id: `00000000-0000-4000-8000-00000000003${i}`,
  tournament_id: t,
  name: `Team ${x}`,
  short_name: x,
  color: ["#059669", "#f59e0b", "#0ea5e9", "#e11d48"][i],
  purse: 100000,
  spent: 0,
}));
const tournament = {
  id: t,
  organiser_id: org,
  name: "Restart test cup",
  venue: "Test Ground",
  starts_on: "2026-12-01",
  status: "completed",
  suspended: false,
  team_budget: 100000,
  base_price: 500,
  min_squad: 2,
  max_squad: 15,
  increment_slabs: [],
  fixture_settings: null,
};
const liveMatch = {
  id: "00000000-0000-4000-8000-000000000040",
  tournament_id: t,
  match_no: 1,
  stage: "league",
  group_name: null,
  round: 1,
  round_name: "Match 1",
  team_a_id: teams[0].id,
  team_b_id: teams[1].id,
  a_source: null,
  b_source: null,
  scheduled_at: "2026-12-01T03:30:00Z",
  venue: "Test Ground",
  status: "live",
  match_type: "limited",
  score_revision: 5,
};
let matches = [];
const writes = [];

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: org, role: "authenticated", exp })}.sig`;
const user = { id: org, aud: "authenticated", role: "authenticated", email: "organiser@example.invalid", app_metadata: {}, user_metadata: {} };
const session = { access_token: jwt, refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: exp, user };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [`sb-${ref}-auth-token`, JSON.stringify(session)]);
const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "*" };
await context.route("**/*", async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  if (url.origin === base) return route.continue();
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
  if (!url.hostname.endsWith(".supabase.co")) return route.abort();
  const reply = (body, status = 200) => route.fulfill({ status, headers, contentType: "application/json", body: JSON.stringify(body) });
  if (url.pathname.startsWith("/auth/v1/user")) return reply(user);
  if (url.pathname.startsWith("/auth/v1/")) return reply(session);
  const name = url.pathname.split("/").at(-1);
  const single = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
  if (url.pathname.includes("/rpc/")) {
    if (name === "my_access") return reply({ is_admin: false, active: true, suspended: false, suspended_reason: null, access_until: null });
    if (name === "server_now") return reply(new Date().toISOString());
    writes.push({ rpc: name, body: req.postDataJSON() });
    if (name === "restart_match") matches = matches.map((m) => (m.id === liveMatch.id ? { ...m, status: "scheduled" } : m));
    return reply(null);
  }
  if (req.method() !== "GET") {
    const body = req.postDataJSON();
    writes.push({ table: name, method: req.method(), body });
    if (name === "matches" && req.method() === "POST") matches.push(...(Array.isArray(body) ? body : [body]).map((m, i) => ({ id: `new-${matches.length + i}`, status: "scheduled", match_type: "limited", ...m })));
    return reply(single ? {} : []);
  }
  const rows =
    name === "tournament_display" ? [tournament] : name === "team_display" ? teams : name === "matches" ? matches : [];
  return reply(single ? (rows[0] ?? null) : rows);
});
await context.routeWebSocket(() => true, (ws) => ws.close());

let passed = 0;
const ok = (label) => {
  passed++;
  console.log(`  \x1b[32m✔\x1b[0m ${label}`);
};
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "RESTART" : undefined));
try {
  // 1. A started match can be restarted from its edit window
  matches = [liveMatch];
  await page.goto(`${base}/t/${t}/fixtures`);
  await page.getByText("Match 1").first().waitFor({ timeout: 20000 });
  await page.getByTitle("Edit date, time, venue").first().click();
  if (process.env.SHOTS) await page.getByRole("dialog").screenshot({ path: `${process.env.SHOTS}/edit-started-match.png` });
  await page.getByRole("button", { name: "Restart match" }).click();
  await page.getByText("restarted").first().waitFor({ timeout: 10000 });
  const restart = writes.find((w) => w.rpc === "restart_match");
  assert.deepEqual(restart?.body, { p_match: liveMatch.id });
  ok("started match: Restart match asks for RESTART and calls restart_match for that match only");

  // 2. Add one match by hand to existing fixtures
  writes.length = 0;
  await page.getByRole("button", { name: "Add match" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Opponent").selectOption({ label: "Team C" });
  await dialog.getByLabel("Match name").fill("Final");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Add match" }).click();
  await page.getByText("Match 2 added").waitFor({ timeout: 10000 });
  const added = writes.find((w) => w.table === "matches" && w.method === "POST")?.body;
  assert.equal(added.match_no, 2);
  assert.equal(added.round_name, "Final");
  assert.equal(added.stage, "knockout");
  assert.deepEqual([added.team_a_id, added.team_b_id], [teams[0].id, teams[2].id]);
  assert.deepEqual(added.a_source, { type: "team", team_id: teams[0].id });
  assert.equal(added.tournament_id, t);
  ok("Add match: next number, chosen teams and name, knockout keeps its own teams");

  // 3. "Make your own" fixtures from scratch
  writes.length = 0;
  matches = [];
  await page.reload();
  await page.getByRole("button", { name: /Make your own/ }).click();
  await page.getByRole("button", { name: "Add another match" }).click();
  await page.getByLabel("Opponent").nth(1).selectOption({ label: "Team D" });
  await page.getByLabel("Team").nth(1).selectOption({ label: "Team C" });
  await page.getByLabel("Match name").nth(1).fill("Final");
  await page.getByText("Knockout (not in points table)").nth(1).click();
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/make-your-own.png`, fullPage: true });
  await page.getByRole("button", { name: "Create fixtures" }).click();
  await page.getByText("2 matches created").waitFor({ timeout: 10000 });
  const settings = writes.find((w) => w.table === "tournaments")?.body.fixture_settings;
  assert.equal(settings.format, "custom");
  const created = writes.find((w) => w.table === "matches" && w.method === "POST")?.body;
  assert.equal(created.length, 2);
  assert.deepEqual(
    created.map((m) => [m.match_no, m.stage, m.round_name, m.team_a_id, m.team_b_id]),
    [
      [1, "league", "Match 1", teams[0].id, teams[1].id],
      [2, "knockout", "Final", teams[2].id, teams[3].id],
    ],
  );
  assert.equal(created[0].scheduled_at, "2026-12-01T03:30:00.000Z");
  assert.equal(created[0].venue, "Test Ground");
  ok("Make your own: each hand-made match saved with its teams, day, time, ground and name");

  // 4. The same team twice is refused before anything is saved
  writes.length = 0;
  matches = [];
  await page.reload();
  await page.getByRole("button", { name: /Make your own/ }).click();
  await page.getByLabel("Opponent").first().selectOption({ label: "Team A" });
  assert.equal(await page.getByRole("button", { name: "Create fixtures" }).isDisabled(), true);
  await page.getByText("Match 1: Pick two different teams").waitFor();
  assert.equal(writes.length, 0);
  ok("Make your own: a team against itself is refused and nothing is saved");

  assert.deepEqual(errors, []);
  console.log(`\n${passed} organiser fixture scenarios passed (mocked Supabase; real UI)`);
} catch (error) {
  console.log((await page.locator("body").innerText()).slice(0, 1500));
  await page.screenshot({ path: "artifacts/organiser-fixtures-failure.png", fullPage: true });
  throw error;
} finally {
  await browser.close();
}
