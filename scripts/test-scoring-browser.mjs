import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.env.TEST_APP_URL ?? "http://localhost:3100";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw Error("Local app required");
const id = "00000000-0000-4000-8000-000000000040",
  tournament = "00000000-0000-4000-8000-000000000010";
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const match = {
  id,
  tournament_id: tournament,
  team_a_id: "A",
  team_b_id: "B",
  status: "live",
  match_no: 1,
  match_type: "limited",
  score_revision: 2,
};
let events = [
  { type: "toss", winner: "A", decision: "bat" },
  { type: "innings_start", batting_team: "A", bowling_team: "B", striker: "a1", non_striker: "a2", bowler: "b1" },
].map((data, i) => ({ id: `event-${i}`, match_id: id, seq: i + 1, type: data.type, data }));
const lineups = ["a1", "a2", "a3", "b1", "b2", "b3"].map((id, i) => ({ id, team_id: id[0].toUpperCase(), name: `Player ${id}`, sort: i }));
const sent = [],
  seen = new Map();
let delayFirst = true,
  release;
const gate = new Promise((resolve) => (release = resolve));
const headers = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};
await context.route("**/*", async (route) => {
  const req = route.request(),
    url = new URL(req.url());
  if (url.origin === base) return route.continue();
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
  const table = url.pathname.split("/").at(-1);
  let body;
  if (table === "scorer_claim") body = { status: "ok" };
  else if (table === "scorer_action") {
    const action = req.postDataJSON();
    sent.push(action);
    if (delayFirst) {
      delayFirst = false;
      await gate;
    }
    if (seen.has(action.p_action)) body = seen.get(action.p_action);
    else if (action.p_revision !== match.score_revision)
      return route.fulfill({
        status: 400,
        headers,
        contentType: "application/json",
        body: JSON.stringify({ code: "P0001", message: "Score changed. Review pending actions before continuing" }),
      });
    else {
      if (action.p_kind === "undo") events.pop();
      else events.push({ id: action.p_action, match_id: id, seq: action.p_seq, type: action.p_data.type, data: action.p_data });
      body = ++match.score_revision;
      seen.set(action.p_action, body);
    }
  } else if (table === "matches") body = { ...match };
  else if (table === "tournament_display") body = { id: tournament, name: "Scoring test", fixture_settings: null };
  else if (table === "team_display")
    body = [
      { id: "A", name: "Royals" },
      { id: "B", name: "Lions" },
    ];
  else if (table === "match_players") body = lineups;
  else if (table === "match_events") body = events;
  else if (table === "guest_players") body = [];
  else return route.abort();
  return route.fulfill({ status: 200, headers, contentType: "application/json", body: JSON.stringify(body) });
});
await context.routeWebSocket(
  (url) => !["localhost", "127.0.0.1"].includes(url.hostname),
  (ws) => ws.close(),
);
try {
  const page = await context.newPage();
  const enter = async () => {
    await page.getByLabel("4-digit PIN from the organiser").fill("1234");
    await page.getByRole("button", { name: "Start scoring", exact: true }).click();
    await page.getByText("Saved · 0 unsaved actions", { exact: true }).waitFor();
  };
  await page.goto(`${base}/score/${id}`);
  await enter();
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "4", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByText("Saving · 3 unsaved actions", { exact: true }).waitFor();
  assert.equal(sent.length, 1, "Requests overlapped instead of serialising");
  release();
  await page.getByText("Saved · 0 unsaved actions", { exact: true }).waitFor();
  assert.deepEqual(
    sent.map((a) => a.p_kind),
    ["event", "event", "undo"],
  );
  assert.deepEqual(
    sent.map((a) => a.p_revision),
    [2, 3, 4],
  );
  assert.equal(events.length, 3);
  await context.setOffline(true);
  await page.getByRole("button", { name: "2", exact: true }).click();
  await page.getByText("Offline · 1 unsaved actions", { exact: true }).waitFor();
  const firstPending = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.startsWith("cricmate-pending:"))?.[1]);
  assert.equal(JSON.parse(firstPending).length, 1, "Offline action was not persisted");
  // Only the revision moved (e.g. a lineup edit), the balls are unchanged: the action is saved on the new revision.
  match.score_revision++;
  await context.setOffline(false);
  await page.getByText("Saved · 0 unsaved actions", { exact: true }).waitFor();
  assert.equal(events.at(-1).id, JSON.parse(firstPending)[0].id, "the offline ball was not saved after a revision-only change");
  // Shot direction (wagon wheel): off by default; when on, runs off the bat ask where the shot went
  await page.getByRole("button", { name: "4", exact: true }).click();
  await page.getByText("Saved · 0 unsaved actions", { exact: true }).waitFor();
  assert.equal(events.at(-1).data.runs, 4);
  assert.equal(events.at(-1).data.zone, undefined, "direction recorded while switched off");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "4", exact: true }).click();
  await page.getByRole("button", { name: "Cover", exact: true }).click();
  await page.getByText("Saved · 0 unsaved actions", { exact: true }).waitFor();
  assert.equal(events.at(-1).data.runs, 4);
  assert.equal(events.at(-1).data.zone, 1, "picked direction not saved with the ball");
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await page.getByText("Saved · 0 unsaved actions", { exact: true }).waitFor();
  assert.equal(events.at(-1).data.runs, 1);
  assert.equal(events.at(-1).data.zone, undefined, "skipped direction should save the ball without one");
  assert.equal(await page.evaluate(() => localStorage.getItem("cricmitra-wagon-wheel")), "1", "switch not remembered");
  await page.getByRole("checkbox").uncheck();
  await context.setOffline(true);
  await page.getByRole("button", { name: "2", exact: true }).click();
  await page.getByText("Offline · 1 unsaved actions", { exact: true }).waitFor();
  const pending = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.startsWith("cricmate-pending:"))?.[1]);
  // Another phone scored a ball meanwhile: a real conflict. Automatic retry must stop with recoverable input.
  events.push({ id: "other-phone", match_id: id, seq: events.length + 1, type: "ball", data: { type: "ball", runs: 1, extra: null, extra_runs: 0, wicket: null } });
  match.score_revision++;
  await context.setOffline(false);
  await page.getByText("Review required · 1 unsaved actions", { exact: true }).waitFor();
  const offlineId = JSON.parse(pending)[0].id;
  assert.equal(sent.at(-1).p_action, offlineId);
  await page.reload();
  await page.getByLabel("4-digit PIN from the organiser").fill("1234");
  await page.getByRole("button", { name: "Start scoring", exact: true }).click();
  await page.getByText("Review required · 1 unsaved actions", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Export pending actions" }).isVisible(), true);
  console.log(
    "6 scoring-browser scenarios passed: rapid taps, pending Undo, offline persistence, shot direction, conflict stop, refresh recovery (mocked transport; real UI)",
  );
} catch (error) {
  const page = context.pages()[0];
  if (page) {
    console.log((await page.locator("body").innerText()).slice(0, 1500));
    await page.screenshot({ path: "artifacts/scoring-failure.png" });
  }
  throw error;
} finally {
  release();
  await context.close();
  await browser.close();
}
