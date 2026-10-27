// Checks of the fixture engine (no database needed):  npm run test:fixtures
import * as F from "../src/lib/fixtures.ts";

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

const teams = (n) => Array.from({ length: n }, (_, i) => `T${i + 1}`);
const settings = (over = {}) => ({
  ...F.DEFAULT_SETTINGS,
  ...over,
  schedule: { ...F.DEFAULT_SETTINGS.schedule, start_date: "2026-11-01", ...over.schedule },
});
const pairKey = (m) => [m.team_a_id, m.team_b_id].sort().join("-");
let idSeq = 0;
const asMatches = (list) =>
  list.map((m) => ({
    ...m,
    id: `m${++idSeq}`,
    tournament_id: "t",
    status: "scheduled",
    outcome: null,
    winner_team_id: null,
    batting_first: null,
    a_runs: null,
    a_wickets: null,
    a_balls: null,
    b_runs: null,
    b_wickets: null,
    b_balls: null,
    result_text: null,
    created_at: "",
  }));
// team A scores a, team B scores b, both bat the full 10 overs
function play(m, a, b) {
  Object.assign(m, {
    status: "completed",
    outcome: a === b ? "tie" : "win",
    batting_first: "a",
    a_runs: a,
    a_wickets: 5,
    a_balls: 60,
    b_runs: b,
    b_wickets: 5,
    b_balls: 60,
    winner_team_id: a > b ? m.team_a_id : a < b ? m.team_b_id : null,
  });
}
function applyResolve(all, s) {
  for (const c of F.resolveTeams(all, s)) Object.assign(all.find((m) => m.id === c.id), c);
}

console.log("\nFixture engine");

test("single league: every pair plays exactly once, numbered 1..n", () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8, 10]) {
    const ms = F.generateFixtures(settings({ playoff: "none" }), teams(n));
    assert(ms.length === (n * (n - 1)) / 2, `${n} teams -> ${ms.length} matches`);
    assert(new Set(ms.map(pairKey)).size === ms.length, `repeat pair with ${n} teams`);
    assert(ms.every((m, i) => m.match_no === i + 1), "numbering");
  }
});

test("double league: every pair plays twice, home and away swapped", () => {
  const ms = F.generateFixtures(settings({ legs: 2, playoff: "none" }), teams(6));
  assert(ms.length === 30, `got ${ms.length}`);
  assert(new Set(ms.map((m) => `${m.team_a_id}>${m.team_b_id}`)).size === 30, "same fixture twice");
});

test("no team plays twice in the same round", () => {
  const ms = F.generateFixtures(settings({ playoff: "none" }), teams(8));
  for (const list of Object.values(Object.groupBy(ms, (m) => m.round))) {
    const ids = list.flatMap((m) => [m.team_a_id, m.team_b_id]);
    assert(new Set(ids).size === ids.length, "team twice in a round");
  }
});

test("IPL playoffs: Qualifier 1, Eliminator, Qualifier 2 (loser Q1 v winner E), Final", () => {
  const ko = F.generateFixtures(settings({ playoff: "ipl" }), teams(6)).filter((m) => m.stage === "knockout");
  assert(ko.map((m) => m.round_name).join(",") === "Qualifier 1,Eliminator,Qualifier 2,Final", ko.map((m) => m.round_name).join(","));
  assert(ko[2].a_source.type === "loser" && ko[2].a_source.match === ko[0].match_no, "Q2 source");
});

test("league + semi-finals: 1 v 4 and 2 v 3", () => {
  const ko = F.generateFixtures(settings({ playoff: "semis" }), teams(6)).filter((m) => m.stage === "knockout");
  assert(ko.length === 3, `got ${ko.length}`);
  const sf = ko.slice(0, 2).map((m) => [m.a_source.position, m.b_source.position].sort().join("v"));
  assert(sf.includes("1v4") && sf.includes("2v3"), sf.join(","));
});

test("knockout with 8 teams: 4 quarter-finals, 2 semi-finals, final", () => {
  const names = F.generateFixtures(settings({ format: "knockout" }), teams(8)).map((m) => m.round_name.replace(/ \d$/, ""));
  assert(names.join(",") === "Quarter-final,Quarter-final,Quarter-final,Quarter-final,Semi-final,Semi-final,Final", names.join(","));
});

test("knockout with 6 teams: seeds 1 and 2 get byes into the semis", () => {
  const ms = F.generateFixtures(settings({ format: "knockout" }), teams(6));
  assert(ms.length === 5, `got ${ms.length}`);
  const firstRound = ms.filter((m) => m.round === 1).flatMap((m) => [m.team_a_id, m.team_b_id]);
  assert(!firstRound.includes("T1") && !firstRound.includes("T2"), "seeds 1 and 2 should have byes");
  const semis = ms.filter((m) => m.round_name.startsWith("Semi"));
  assert(semis.some((m) => m.team_a_id === "T1") && semis.some((m) => m.team_a_id === "T2"), "bye teams should already be in the semis");
});

test("knockout with 2, 3, 5, 9, 12 teams always has (teams - 1) matches", () => {
  for (const n of [2, 3, 5, 9, 12]) {
    const ms = F.generateFixtures(settings({ format: "knockout" }), teams(n));
    assert(ms.length === n - 1, `${n} teams -> ${ms.length}`);
    assert(ms.at(-1).round_name === "Final", "last match is the final");
  }
});

test("2 groups of 4, top 2: each group winner meets the other group's runner-up", () => {
  const ms = F.generateFixtures(settings({ format: "groups", groups: 2, qualify: 2 }), teams(8));
  assert(ms.filter((m) => m.stage === "group").length === 12, "12 group matches");
  for (const m of ms.filter((x) => x.round_name.startsWith("Semi"))) {
    assert(m.a_source.group !== m.b_source.group, `${JSON.stringify(m.a_source)} v ${JSON.stringify(m.b_source)}`);
  }
});

test("3 groups, top 2: 6 qualifiers, no same-group first knockout", () => {
  const ko = F.generateFixtures(settings({ format: "groups", groups: 3, qualify: 2 }), teams(9)).filter((m) => m.stage === "knockout");
  assert(ko.length === 5, `got ${ko.length}`);
  for (const m of ko.filter((x) => x.a_source.type === "standing" && x.b_source.type === "standing")) {
    assert(m.a_source.group !== m.b_source.group, "same group");
  }
});

test("4 groups top 1 -> semi-finals, 4 groups top 2 -> quarter-finals", () => {
  const a = F.generateFixtures(settings({ format: "groups", groups: 4, qualify: 1 }), teams(12)).filter((m) => m.stage === "knockout");
  const b = F.generateFixtures(settings({ format: "groups", groups: 4, qualify: 2 }), teams(16)).filter((m) => m.stage === "knockout");
  assert(a.length === 3 && b.length === 7, `${a.length}/${b.length}`);
});

test("schedule: matches per day, gap between matches, knockouts on a new day (IST)", () => {
  const ms = F.generateFixtures(
    settings({ playoff: "semis", schedule: { per_day: 4, gap_minutes: 120, first_time: "08:00", knockouts_new_day: true } }),
    teams(5),
  );
  assert(ms[0].scheduled_at === "2026-11-01T02:30:00.000Z", ms[0].scheduled_at);
  assert(ms[1].scheduled_at === "2026-11-01T04:30:00.000Z", ms[1].scheduled_at);
  assert(ms[4].scheduled_at.startsWith("2026-11-02T02:30"), ms[4].scheduled_at);
  const ko = ms.find((m) => m.stage === "knockout");
  assert(ko.scheduled_at.slice(11, 16) === "02:30", `first knockout at ${ko.scheduled_at}`);
});

test("overs text <-> balls", () => {
  assert(F.oversToBalls("9.4") === 58 && F.oversToBalls("10") === 60, "parse");
  assert(F.oversToBalls("9.6") === null && F.oversToBalls("x") === null, "reject bad overs");
  assert(F.ballsToOvers(58) === "9.4" && F.ballsToOvers(60) === "10", "format");
});

test("result text: runs margin, wickets margin, tie with super over, walkover", () => {
  const m = { team_a_id: "A", team_b_id: "B" };
  const name = (id) => id;
  const base = { outcome: "win", batting_first: "a", a_wickets: 6, a_balls: 60, b_balls: 60, winner_team_id: null };
  assert(F.decideResult(m, { ...base, a_runs: 120, b_runs: 100, b_wickets: 8 }, { wickets: 10 }, name).text === "A won by 20 runs", "runs");
  const chase = F.decideResult(m, { ...base, a_runs: 120, b_runs: 121, b_wickets: 3 }, { wickets: 10 }, name);
  assert(chase.text === "B won by 7 wickets" && chase.winner === "B", chase.text);
  const tie = F.decideResult(m, { ...base, a_runs: 100, b_runs: 100, b_wickets: 9, winner_team_id: "B" }, { wickets: 10 }, name);
  assert(tie.outcome === "tie" && tie.winner === "B" && tie.text.includes("super over"), tie.text);
  assert(F.decideResult(m, { ...base, outcome: "walkover", winner_team_id: "A" }, { wickets: 10 }, name).text === "A won by walkover", "walkover");
});

test("points table: points, net run rate with the all-out rule, sorting", () => {
  const s = settings({ playoff: "none", overs: 10, wickets: 10 });
  const all = asMatches(F.generateFixtures(s, teams(3)));
  const find = (x, y) => all.find((m) => pairKey(m) === [x, y].sort().join("-"));
  // T1 150 beats T2 100
  const m12 = find("T1", "T2");
  const t1a = m12.team_a_id === "T1";
  play(m12, t1a ? 150 : 100, t1a ? 100 : 150);
  // T1 120/2 beats T3 60 all out in 8 overs (T3 is charged the full 10 overs)
  const m13 = find("T1", "T3");
  const t1 = { runs: 120, wickets: 2, balls: 60 };
  const t3 = { runs: 60, wickets: 10, balls: 48 };
  const [a, b] = m13.team_a_id === "T1" ? [t1, t3] : [t3, t1];
  Object.assign(m13, { status: "completed", outcome: "win", winner_team_id: "T1", a_runs: a.runs, a_wickets: a.wickets, a_balls: a.balls, b_runs: b.runs, b_wickets: b.wickets, b_balls: b.balls });
  Object.assign(find("T2", "T3"), { status: "completed", outcome: "no_result", winner_team_id: null });

  const table = F.standings(all, s).get(null);
  assert(table.map((r) => r.team_id).join(",") === "T1,T2,T3", table.map((r) => r.team_id).join(","));
  assert(table.map((r) => r.points).join(",") === "4,1,1", table.map((r) => r.points).join(","));
  const row3 = table.find((r) => r.team_id === "T3");
  assert(row3.balls_faced === 60 && Math.abs(row3.nrr - (6 - 12)) < 1e-9, `T3 nrr ${row3.nrr}, faced ${row3.balls_faced}`);
});

test("IPL flow: playoffs fill only when the league is over, then winners move on", () => {
  const s = settings({ playoff: "ipl" });
  const all = asMatches(F.generateFixtures(s, teams(4)));
  const league = all.filter((m) => m.stage === "league");
  const strength = { T1: 4, T2: 3, T3: 2, T4: 1 };
  const playByStrength = (m) => play(m, strength[m.team_a_id] * 40, strength[m.team_b_id] * 40);
  league.slice(0, -1).forEach(playByStrength);
  applyResolve(all, s);
  assert(all.filter((m) => m.stage === "knockout").every((m) => !m.team_a_id), "playoffs filled before the league ended");
  playByStrength(league.at(-1));
  applyResolve(all, s);
  const [q1, el, q2, final] = all.filter((m) => m.stage === "knockout");
  assert(q1.team_a_id === "T1" && q1.team_b_id === "T2" && el.team_a_id === "T3" && el.team_b_id === "T4", "Qualifier 1 / Eliminator teams");
  play(q1, 100, 120); // T2 wins Qualifier 1
  play(el, 130, 90); // T3 wins the Eliminator
  applyResolve(all, s);
  assert(q2.team_a_id === "T1" && q2.team_b_id === "T3", `Qualifier 2 is ${q2.team_a_id} v ${q2.team_b_id}`);
  assert(final.team_a_id === "T2" && !final.team_b_id, "final should have T2 and a TBD");
  play(q2, 150, 100);
  applyResolve(all, s);
  play(final, 90, 140);
  assert(F.champion(all, s) === "T1", `champion ${F.champion(all, s)}`);
});

test("changing a result before the next round is played updates the next round", () => {
  const s = settings({ format: "knockout" });
  const all = asMatches(F.generateFixtures(s, teams(4)));
  const [sf1, , final] = all;
  play(sf1, 100, 50);
  applyResolve(all, s);
  const before = final.team_a_id;
  play(sf1, 50, 100);
  applyResolve(all, s);
  assert(final.team_a_id !== before && final.team_a_id === sf1.team_b_id, "final not updated");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
