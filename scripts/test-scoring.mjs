// Checks of the ball-by-ball scoring engine (no database needed):  npm run test:scoring
import { decideResult } from "../src/lib/fixtures.ts";
import * as S from "../src/lib/scoring.ts";

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
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

// Team A: a1..a11, team B: b1..b11
const xi = (t, n = 11) => Array.from({ length: n }, (_, i) => `${t}${i + 1}`);
const lineups = (n = 11) => ({ A: xi("a", n), B: xi("b", n) });

// Tiny script language for building events
function match(rules = {}, n = 11) {
  const r = S.defaultRules({ overs: 2, wickets: 10, scoring: rules });
  const events = [];
  const add = (data) => events.push({ seq: events.length + 1, data });
  const api = {
    r,
    events,
    lineups: lineups(n),
    toss: () => (add({ type: "toss", winner: "A", decision: "bat" }), api),
    start: (bat = "A", striker = "a1", non = "a2", bowler = "b1") =>
      (add({ type: "innings_start", batting_team: bat, bowling_team: bat === "A" ? "B" : "A", striker, non_striker: non, bowler }), api),
    ball: (runs = 0, extra = null, extra_runs = 0, wicket = null) => (add({ type: "ball", runs, extra, extra_runs, wicket }), api),
    out: (kind, out, fielder = null, runs = 0) => api.ball(runs, null, 0, { kind, out, fielder }),
    batter: (player) => (add({ type: "new_batter", player }), api),
    bowler: (player) => (add({ type: "new_bowler", player }), api),
    retire: (player, out = false) => (add({ type: "retire", player, out }), api),
    state: () => S.replay(events, r, api.lineups),
  };
  return api;
}
const cur = (m) => m.state().current;
const bat = (m, id) => cur(m).batters.find((b) => b.id === id);
const bowlLine = (m, id) => cur(m).bowlers.find((b) => b.id === id);

console.log("\nScoring engine");

test("starts by asking for the toss, then the innings openers", () => {
  const m = match();
  assert(m.state().next === "toss", m.state().next);
  m.toss();
  assert(m.state().next === "innings_start", m.state().next);
  m.start();
  assert(m.state().next === "ball", m.state().next);
});

test("six dots: maiden, over done, batters change ends, new bowler needed", () => {
  const m = match().toss().start();
  for (let i = 0; i < 6; i++) m.ball(0);
  const s = m.state();
  assert(s.next === "new_bowler" && s.current.legal_balls === 6, s.next);
  assert(s.current.striker === "a2" && s.current.non_striker === "a1", "ends not changed");
  assert(bowlLine(m, "b1").maidens === 1 && bowlLine(m, "b1").dots === 6, "maiden");
  assert(s.current.overs.length === 2 && s.current.overs[0].every((b) => b.label === "•"), "over marks");
});

test("odd runs swap strike, boundaries and 2s don't", () => {
  const m = match().toss().start();
  m.ball(1);
  assert(cur(m).striker === "a2", "1 should swap");
  m.ball(4);
  assert(cur(m).striker === "a2", "4 should not swap");
  m.ball(3);
  assert(cur(m).striker === "a1", "3 should swap");
  m.ball(2);
  assert(cur(m).striker === "a1" && bat(m, "a2").fours === 1 && cur(m).runs === 10, "2 should not swap");
});

test("wide: 1 extra to the bowler, not a ball faced, re-bowled", () => {
  const m = match().toss().start().ball(0, "wd");
  const s = cur(m);
  assert(s.runs === 1 && s.legal_balls === 0 && s.extras.wd === 1, JSON.stringify(s.extras));
  assert(bat(m, "a1").balls === 0 && bowlLine(m, "b1").runs === 1 && bowlLine(m, "b1").wides === 1, "wide credit");
  m.ball(0, "wd", 1); // wide + they ran one: 2 wides, batters swap
  assert(cur(m).runs === 3 && cur(m).extras.wd === 3 && cur(m).striker === "a2", "wide with a run");
});

test("no-ball + four: 5 runs, batter gets 4 and a ball faced, then a free hit", () => {
  const m = match().toss().start().ball(4, "nb");
  assert(cur(m).runs === 5 && cur(m).legal_balls === 0 && bat(m, "a1").runs === 4 && bat(m, "a1").balls === 1, "no-ball runs");
  assert(bowlLine(m, "b1").runs === 5 && bowlLine(m, "b1").noballs === 1 && cur(m).free_hit, "free hit");
  m.out("bowled", "a1"); // not out on a free hit
  assert(cur(m).wickets === 0 && !bat(m, "a1").out && !cur(m).free_hit, "free hit wicket should not count");
});

test("run out still counts on a free hit", () => {
  const m = match().toss().start().ball(0, "nb");
  m.out("run_out", "a2", "b5");
  assert(cur(m).wickets === 1 && bat(m, "a2").out && bat(m, "a2").how === "run out (b5)", bat(m, "a2").how);
  assert(bowlLine(m, "b1").wickets === 0, "run out is not the bowler's wicket");
});

test("byes and leg byes: team extras, not the bowler's runs, ball counts as faced", () => {
  const m = match().toss().start().ball(0, "b", 2).ball(0, "lb", 1);
  assert(cur(m).runs === 3 && cur(m).extras.b === 2 && cur(m).extras.lb === 1 && cur(m).legal_balls === 2, JSON.stringify(cur(m).extras));
  assert(bowlLine(m, "b1").runs === 0 && bat(m, "a1").balls === 2 && bat(m, "a1").runs === 0, "bye credit");
});

test("caught: bowler's wicket, fielder's catch, new batter takes the empty end", () => {
  const m = match().toss().start().out("caught", "a1", "b7");
  const s = m.state();
  assert(s.next === "new_batter" && s.current.striker === null && s.current.wickets === 1, s.next);
  assert(bat(m, "a1").how === "c b7 b b1" && bowlLine(m, "b1").wickets === 1 && s.fielding.b7.catches === 1, bat(m, "a1").how);
  m.batter("a3");
  assert(cur(m).striker === "a3" && cur(m).non_striker === "a2" && cur(m).partnership.runs === 0, "new batter on strike");
});

test("run out after a single: the right batter leaves, the other end is filled", () => {
  const m = match().toss().start().ball(1, null, 0, { kind: "run_out", out: "a1", fielder: "b2" });
  // they crossed: a2 on strike, a1 (out) was heading to the non-striker's end
  assert(cur(m).striker === "a2" && cur(m).non_striker === null && cur(m).runs === 1, `${cur(m).striker}/${cur(m).non_striker}`);
});

test("all out when the batting side runs out of batters (XI of 4 -> 3 wickets)", () => {
  const m = match({}, 4).toss().start();
  m.out("bowled", "a1").batter("a3").out("bowled", "a3").batter("a4").out("lbw", "a4");
  const s = m.state();
  assert(s.current.complete && s.current.end_reason === "all_out" && s.next === "innings_break", s.next);
  assert(s.target === 1, `target ${s.target}`);
});

test("innings ends after the overs, second innings chases and finishes at the target", () => {
  const m = match().toss().start();
  for (let i = 0; i < 6; i++) m.ball(1);
  m.bowler("b2");
  for (let i = 0; i < 6; i++) m.ball(2);
  let s = m.state();
  assert(s.current.end_reason === "overs" && s.next === "innings_break" && s.target === 19, `target ${s.target}`);
  m.start("B", "b1", "b2", "a1").ball(6).ball(6).ball(6);
  s = m.state();
  assert(s.next === "ball" && s.current.runs === 18, "not yet");
  m.ball(1);
  s = m.state();
  assert(s.next === "finished" && s.current.end_reason === "target", s.next);
});

test("bowler limits: not the same bowler twice in a row, max overs per bowler", () => {
  const m = match({ max_bowler_overs: 1 }).toss().start();
  for (let i = 0; i < 6; i++) m.ball(0);
  const opts = S.availableBowlers(cur(m), m.lineups.B, m.r);
  assert(opts.find((o) => o.id === "b1").reason, "b1 should be blocked");
  assert(!opts.find((o) => o.id === "b2").reason, "b2 should be allowed");
});

test("mid-over bowler change (injury) continues the same over", () => {
  const m = match().toss().start().ball(0).ball(0).bowler("b3").ball(0).ball(0).ball(0).ball(0);
  assert(cur(m).overs[0].length === 6 && m.state().next === "new_bowler", `over length ${cur(m).overs[0].length}`);
  assert(bowlLine(m, "b1").balls === 2 && bowlLine(m, "b3").balls === 4, "balls split between bowlers");
});

test("retired hurt can come back later and keeps their score", () => {
  const mm = match().toss().start().ball(4).retire("a1").batter("a3").out("bowled", "a3").batter("a1");
  assert(cur(mm).striker === "a1" && bat(mm, "a1").runs === 4 && !bat(mm, "a1").retired, "returning batter");
  assert(cur(mm).wickets === 1, "retired hurt is not a wicket");
  assert(S.availableBatters(cur(mm), mm.lineups.A).includes("a4") && !S.availableBatters(cur(mm), mm.lineups.A).includes("a1"), "available");
});

test("local rules: wide not re-bowled counts as a ball, 2-run wides", () => {
  const m = match({ wide_rebowl: false, wide_runs: 2 }).toss().start().ball(0, "wd");
  assert(cur(m).legal_balls === 1 && cur(m).runs === 2, `${cur(m).legal_balls} balls, ${cur(m).runs} runs`);
});

test("undo = replay without the last event, gives back the exact earlier state", () => {
  const m = match().toss().start().ball(1).ball(4, "nb").out("caught", "a2", "b4");
  const before = JSON.stringify(S.replay(m.events.slice(0, -1), m.r, m.lineups));
  m.batter("a3");
  const after = JSON.stringify(S.replay(m.events.slice(0, -2), m.r, m.lineups));
  assert(before === after, "replay mismatch");
});

test("match stats and result: batting, bowling, fielding, winner text", () => {
  const m = match().toss().start();
  m.ball(6).ball(4).out("caught", "a1", "b9").batter("a3").ball(0).ball(1).ball(0);
  m.bowler("b2").ball(0).ball(0).ball(0).ball(0).ball(0).ball(0);
  m.start("B", "b1", "b2", "a1").ball(4).ball(4).ball(4).ball(1);
  const s = m.state();
  assert(s.next === "finished", s.next);
  const stats = S.matchStats(s, m.lineups);
  const a1 = stats.find((x) => x.match_player_id === "a1");
  const b9 = stats.find((x) => x.match_player_id === "b9");
  const b1 = stats.find((x) => x.match_player_id === "b1");
  assert(a1.bat_runs === 10 && a1.sixes === 1 && a1.fours === 1 && a1.out && a1.bat_balls === 3, JSON.stringify(a1));
  assert(b9.catches === 1 && b1.wickets === 1 && b1.bowl_balls === 6 && b1.bowl_runs === 11, JSON.stringify(b1));
  assert(b1.bat_runs === 12 && b1.did_bat, "b1 batting");
  const scores = S.resultScores(s, "A");
  const res = decideResult({ team_a_id: "A", team_b_id: "B" }, { outcome: "win", winner_team_id: null, ...scores }, m.r, (id) => `Team ${id}`);
  assert(res.winner === "B" && res.text === "Team B won by 10 wickets", res.text);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
