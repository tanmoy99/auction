// Ball-by-ball scoring engine. A match is a list of events (toss, innings start, balls, new batter,
// new bowler ...). Every screen replays the same list, so the scorer's phone, the public scorecard and
// the big screen always agree, and undo is just "remove the last event".
// Plain functions with no app imports, so scripts can use them too.

export type ScoringRules = {
  format: "limited" | "test";
  overs: number; // per innings, 0 = no limit (Tests)
  wickets: number; // all out after this many wickets (also capped by the playing XI size)
  wide_runs: number;
  noball_runs: number;
  wide_rebowl: boolean;
  noball_rebowl: boolean;
  free_hit: boolean;
  max_bowler_overs: number; // 0 = no limit
  innings_per_side: 1 | 2;
  follow_on: number; // Tests: first-innings lead that lets a side make the other follow on
  overs_per_day: number; // Tests: overs scheduled each day, 0 = not tracked
  days: number;
};

type RuleSettings = { overs?: number; wickets?: number; scoring?: Partial<ScoringRules>; test?: Partial<ScoringRules> } | null;

export function defaultRules(s?: RuleSettings): ScoringRules {
  const overs = s?.overs ?? 10;
  return {
    overs,
    wickets: s?.wickets ?? 10,
    wide_runs: 1,
    noball_runs: 1,
    wide_rebowl: true,
    noball_rebowl: true,
    free_hit: true,
    max_bowler_overs: Math.ceil(overs / 5),
    ...s?.scoring,
    format: "limited",
    innings_per_side: 1,
    follow_on: 0,
    overs_per_day: 0,
    days: 1,
  };
}

// Laws of cricket 14.1.1: lead needed to enforce the follow-on, by match length
export function followOnLead(days: number) {
  return days >= 5 ? 200 : days >= 3 ? 150 : days === 2 ? 100 : 75;
}

// Rules for one match: the tournament's limited-overs rules, or Test rules for a multi-day match
export function matchRules(s: RuleSettings | undefined, match?: { match_type?: string | null; days?: number | null } | null): ScoringRules {
  if (match?.match_type !== "test") return defaultRules(s);
  const days = match.days ?? 5;
  return {
    format: "test",
    overs: 0,
    wickets: 10,
    wide_runs: 1,
    noball_runs: 1,
    wide_rebowl: true,
    noball_rebowl: true,
    free_hit: false,
    max_bowler_overs: 0,
    overs_per_day: 90,
    ...s?.test,
    innings_per_side: 2,
    follow_on: followOnLead(days),
    days,
  };
}

export type Extra = "wd" | "nb" | "b" | "lb";
export type WicketKind = "bowled" | "caught" | "lbw" | "stumped" | "run_out" | "hit_wicket";

export const WICKET_KINDS: { key: WicketKind; label: string; bowler: boolean; fielder: boolean }[] = [
  { key: "bowled", label: "Bowled", bowler: true, fielder: false },
  { key: "caught", label: "Caught", bowler: true, fielder: true },
  { key: "lbw", label: "LBW", bowler: true, fielder: false },
  { key: "run_out", label: "Run out", bowler: false, fielder: true },
  { key: "stumped", label: "Stumped", bowler: true, fielder: true },
  { key: "hit_wicket", label: "Hit wicket", bowler: true, fielder: false },
];

export type EventData =
  | { type: "toss"; winner: string; decision: "bat" | "bowl" }
  | { type: "innings_start"; batting_team: string; bowling_team: string; striker: string; non_striker: string; bowler: string; follow_on?: boolean }
  | { type: "ball"; runs: number; extra: Extra | null; extra_runs: number; wicket: { kind: WicketKind; out: string; fielder: string | null } | null }
  | { type: "new_batter"; player: string }
  | { type: "new_bowler"; player: string }
  | { type: "swap" }
  | { type: "retire"; player: string; out: boolean }
  | { type: "end_innings" } // limited: innings cut short; Test: declaration
  // Tests only
  | { type: "stumps" } // close of play for the day
  | { type: "break"; kind: BreakKind }
  | { type: "end_match" }; // time ran out: the match is drawn

export type BreakKind = "lunch" | "tea" | "drinks" | "rain" | "bad_light";
export const BREAKS: { key: BreakKind; label: string }[] = [
  { key: "lunch", label: "Lunch" },
  { key: "tea", label: "Tea" },
  { key: "drinks", label: "Drinks" },
  { key: "rain", label: "Rain delay" },
  { key: "bad_light", label: "Bad light" },
];

export type MatchEvent = { id: string; match_id: string; seq: number; type: EventData["type"]; data: EventData; created_at: string };

export type BatterLine = { id: string; runs: number; balls: number; fours: number; sixes: number; out: boolean; how: string | null; retired: boolean };
export type BowlerLine = { id: string; balls: number; runs: number; wickets: number; maidens: number; wides: number; noballs: number; dots: number };
export type BallMark = { label: string; kind: "dot" | "run" | "four" | "six" | "extra" | "wicket" };

export type InningsState = {
  number: number;
  batting_team: string;
  bowling_team: string;
  runs: number;
  wickets: number;
  legal_balls: number;
  extras: { wd: number; nb: number; b: number; lb: number };
  batters: BatterLine[]; // in batting order
  bowlers: BowlerLine[]; // in order they first bowled
  fow: { wicket: number; runs: number; balls: number; player: string }[];
  overs: BallMark[][];
  striker: string | null;
  non_striker: string | null;
  bowler: string | null;
  last_over_bowler: string | null;
  free_hit: boolean;
  partnership: { runs: number; balls: number };
  complete: boolean;
  end_reason: "all_out" | "overs" | "target" | "declared" | null;
  follow_on: boolean; // Tests: this side was made to bat again straight away
};

export type Next = "toss" | "innings_start" | "new_batter" | "new_bowler" | "ball" | "innings_break" | "finished";

export type MatchState = {
  toss: { winner: string; decision: "bat" | "bowl" } | null;
  innings: InningsState[];
  current: InningsState | null;
  target: number | null;
  next: Next;
  fielding: Record<string, { catches: number; stumpings: number; run_outs: number }>;
  error: string | null;
  // Tests
  day: number;
  day_balls: number; // legal balls bowled today
  stumps: boolean; // play has closed for the day (until the next action)
  on_break: BreakKind | null;
  drawn: boolean; // ended with "end_match"
};

export function ballsText(balls: number) {
  return `${Math.floor(balls / 6)}${balls % 6 ? `.${balls % 6}` : ""}`;
}

export function runRate(runs: number, balls: number) {
  return balls ? (runs * 6) / balls : 0;
}

function emptyInnings(number: number, batting: string, bowling: string): InningsState {
  return {
    number,
    batting_team: batting,
    bowling_team: bowling,
    runs: 0,
    wickets: 0,
    legal_balls: 0,
    extras: { wd: 0, nb: 0, b: 0, lb: 0 },
    batters: [],
    bowlers: [],
    fow: [],
    overs: [],
    striker: null,
    non_striker: null,
    bowler: null,
    last_over_bowler: null,
    free_hit: false,
    partnership: { runs: 0, balls: 0 },
    complete: false,
    end_reason: null,
    follow_on: false,
  };
}

// Runs per team over all its innings so far
export function teamTotals(state: Pick<MatchState, "innings">) {
  const totals: Record<string, number> = {};
  for (const inn of state.innings) {
    totals[inn.batting_team] = (totals[inn.batting_team] ?? 0) + inn.runs;
    totals[inn.bowling_team] ??= 0;
  }
  return totals;
}

// Tests: the batting side's lead (negative = still behind) including this innings
export function leadOf(state: MatchState) {
  const inn = state.current;
  if (!inn) return 0;
  const totals = teamTotals(state);
  return (totals[inn.batting_team] ?? 0) - (totals[inn.bowling_team] ?? 0);
}

// Is the match over? Limited: both innings done. Test: 4 innings done, target reached,
// or the side batting third is all out still behind (an innings win).
function matchOver(state: MatchState, rules: ScoringRules) {
  const done = state.innings.filter((i) => i.complete);
  if (rules.innings_per_side === 1) return done.length >= 2;
  if (done.length >= 4) return true;
  const last = state.innings.at(-1);
  if (last?.complete && last.end_reason === "target") return true;
  if (done.length === 3 && state.innings.length === 3) {
    const totals = teamTotals(state);
    const third = state.innings[2]!;
    return (totals[third.batting_team] ?? 0) < (totals[third.bowling_team] ?? 0);
  }
  return false;
}

// Tests: after both first innings, may the side that batted first make the other follow on?
export function canEnforceFollowOn(state: MatchState, rules: ScoringRules) {
  if (rules.innings_per_side !== 2 || state.innings.length !== 2 || !state.innings[1]!.complete) return false;
  const [i1, i2] = state.innings as [InningsState, InningsState];
  return i1.runs - i2.runs >= rules.follow_on;
}

// Which side bats in the next innings
export function nextBattingTeam(state: MatchState, teamA: string, teamB: string, followOn = false) {
  const other = (id: string) => (id === teamA ? teamB : teamA);
  const n = state.innings.length;
  if (n === 0) {
    const toss = state.toss!;
    return toss.decision === "bat" ? toss.winner : other(toss.winner);
  }
  if (n === 1) return state.innings[0]!.bowling_team;
  if (n === 2) return followOn ? state.innings[1]!.batting_team : state.innings[0]!.batting_team;
  // 4th innings: whoever has batted only once
  const times = (id: string) => state.innings.filter((i) => i.batting_team === id).length;
  return times(teamA) < times(teamB) ? teamA : teamB;
}

function batter(inn: InningsState, id: string) {
  let b = inn.batters.find((x) => x.id === id);
  if (!b) {
    b = { id, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, how: null, retired: false };
    inn.batters.push(b);
  }
  return b;
}

function bowlerLine(inn: InningsState, id: string) {
  let b = inn.bowlers.find((x) => x.id === id);
  if (!b) {
    b = { id, balls: 0, runs: 0, wickets: 0, maidens: 0, wides: 0, noballs: 0, dots: 0 };
    inn.bowlers.push(b);
  }
  return b;
}

function markFor(runs: number, extra: Extra | null, extraRuns: number, wicket: boolean): BallMark {
  if (wicket) return { label: runs + extraRuns ? `${runs + extraRuns}W` : "W", kind: "wicket" };
  if (extra === "wd") return { label: extraRuns ? `${extraRuns + 1}Wd` : "Wd", kind: "extra" };
  if (extra === "nb") return { label: runs || extraRuns ? `${runs + extraRuns}Nb` : "Nb", kind: "extra" };
  if (extra === "b") return { label: `${extraRuns}B`, kind: "extra" };
  if (extra === "lb") return { label: `${extraRuns}Lb`, kind: "extra" };
  if (runs === 4) return { label: "4", kind: "four" };
  if (runs === 6) return { label: "6", kind: "six" };
  return runs ? { label: String(runs), kind: "run" } : { label: "•", kind: "dot" };
}

export type Lineups = Record<string, string[]>; // team id -> playing XI (match player ids)

// Wickets that end the innings: the rule, but never more than the batters available
export function allOutAt(rules: ScoringRules, xiSize: number) {
  return Math.max(1, Math.min(rules.wickets, xiSize - 1));
}

export function replay(events: Pick<MatchEvent, "seq" | "data">[], rules: ScoringRules, lineups: Lineups, nameOf: (id: string) => string = (id) => id): MatchState {
  const state: MatchState = {
    toss: null,
    innings: [],
    current: null,
    target: null,
    next: "toss",
    fielding: {},
    error: null,
    day: 1,
    day_balls: 0,
    stumps: false,
    on_break: null,
    drawn: false,
  };
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  let overRuns = 0; // runs against the bowler in the current over (for maidens)
  const lastInnings = rules.innings_per_side * 2;

  const finishCheck = (inn: InningsState) => {
    const xi = lineups[inn.batting_team]?.length ?? 11;
    if (inn.wickets >= allOutAt(rules, xi)) inn.end_reason = "all_out";
    else if (rules.overs > 0 && inn.legal_balls >= rules.overs * 6) inn.end_reason = "overs";
    else if (state.target != null && inn.number === lastInnings && inn.runs >= state.target) inn.end_reason = "target";
    if (inn.end_reason) {
      inn.complete = true;
      inn.striker = inn.non_striker = inn.bowler = null;
    }
  };

  for (const { data: e } of sorted) {
    const inn = state.current;
    if (state.drawn) continue;
    // any action after the close of play or a break means play has resumed
    if (e.type !== "stumps") state.stumps = false;
    if (e.type !== "break") state.on_break = null;
    if (e.type === "toss") {
      state.toss = { winner: e.winner, decision: e.decision };
      continue;
    }
    if (e.type === "stumps") {
      if (!state.stumps) {
        state.day++;
        state.day_balls = 0;
      }
      state.stumps = true;
      continue;
    }
    if (e.type === "break") {
      state.on_break = e.kind;
      continue;
    }
    if (e.type === "end_match") {
      state.drawn = true;
      if (inn && !inn.complete) inn.striker = inn.non_striker = inn.bowler = null;
      continue;
    }
    if (e.type === "innings_start") {
      const next = emptyInnings(state.innings.length + 1, e.batting_team, e.bowling_team);
      next.striker = e.striker;
      next.non_striker = e.non_striker;
      next.bowler = e.bowler;
      next.follow_on = !!e.follow_on;
      batter(next, e.striker);
      batter(next, e.non_striker);
      bowlerLine(next, e.bowler);
      next.overs.push([]);
      // last innings chases: everything the other side scored, minus what this side already has, plus one
      if (next.number === lastInnings) {
        const totals = teamTotals(state);
        state.target = (totals[e.bowling_team] ?? 0) - (totals[e.batting_team] ?? 0) + 1;
      }
      state.innings.push(next);
      state.current = next;
      overRuns = 0;
      continue;
    }
    if (!inn || inn.complete) continue;

    if (e.type === "end_innings") {
      inn.complete = true;
      inn.end_reason = "declared";
      inn.striker = inn.non_striker = inn.bowler = null;
      continue;
    }
    if (e.type === "swap") {
      [inn.striker, inn.non_striker] = [inn.non_striker, inn.striker];
      continue;
    }
    if (e.type === "new_bowler") {
      // a change in the middle of an over (injury) carries on the same over
      if (inn.legal_balls % 6 === 0 && !inn.overs.at(-1)?.length) overRuns = 0;
      inn.bowler = e.player;
      bowlerLine(inn, e.player);
      continue;
    }
    if (e.type === "new_batter") {
      const b = batter(inn, e.player);
      if (b.retired && !b.out) {
        b.retired = false;
        b.how = null;
      }
      if (!inn.striker) inn.striker = e.player;
      else if (!inn.non_striker) inn.non_striker = e.player;
      inn.partnership = { runs: 0, balls: 0 };
      continue;
    }
    if (e.type === "retire") {
      const b = batter(inn, e.player);
      b.retired = true;
      b.how = e.out ? "retired out" : "retired hurt";
      if (e.out) {
        b.out = true;
        inn.wickets++;
        inn.fow.push({ wicket: inn.wickets, runs: inn.runs, balls: inn.legal_balls, player: e.player });
      }
      if (inn.striker === e.player) inn.striker = null;
      if (inn.non_striker === e.player) inn.non_striker = null;
      finishCheck(inn);
      continue;
    }

    // a delivery
    if (!inn.striker || !inn.non_striker || !inn.bowler) {
      state.error = "Ball recorded before batters and bowler were set";
      continue;
    }
    const penalty = e.extra === "wd" ? rules.wide_runs : e.extra === "nb" ? rules.noball_runs : 0;
    const legal = !((e.extra === "wd" && rules.wide_rebowl) || (e.extra === "nb" && rules.noball_rebowl));
    const total = e.runs + e.extra_runs + penalty;
    const striker = batter(inn, inn.striker);
    const bowl = bowlerLine(inn, inn.bowler);
    const wasFreeHit = inn.free_hit;

    inn.runs += total;
    inn.partnership.runs += total;
    if (e.extra === "wd") inn.extras.wd += penalty + e.extra_runs;
    if (e.extra === "nb") inn.extras.nb += penalty;
    if (e.extra === "b" || e.extra === "nb") inn.extras.b += e.extra_runs; // runs run off a no-ball are byes
    if (e.extra === "lb") inn.extras.lb += e.extra_runs;

    if (e.extra !== "wd") {
      striker.balls++;
      striker.runs += e.runs;
      if (e.runs === 4) striker.fours++;
      if (e.runs === 6) striker.sixes++;
      inn.partnership.balls++;
    }
    const conceded = e.runs + penalty + (e.extra === "wd" ? e.extra_runs : 0);
    bowl.runs += conceded;
    overRuns += conceded;
    if (e.extra === "wd") bowl.wides++;
    if (e.extra === "nb") bowl.noballs++;
    if (legal) {
      inn.legal_balls++;
      state.day_balls++;
      bowl.balls++;
      if (total === 0 && !e.wicket) bowl.dots++;
    }
    // on a free hit only a run out counts
    const wicket = e.wicket && !(wasFreeHit && e.wicket.kind !== "run_out") ? e.wicket : null;
    inn.overs.at(-1)!.push(markFor(e.runs, e.extra, e.extra_runs, !!wicket));

    // runs taken swap the batters (boundaries are even so they don't)
    if ((e.runs + e.extra_runs) % 2 === 1) [inn.striker, inn.non_striker] = [inn.non_striker, inn.striker];

    if (wicket) {
      const out = batter(inn, wicket.out);
      out.out = true;
      const kind = WICKET_KINDS.find((k) => k.key === wicket.kind);
      const fielder = wicket.fielder ? nameOf(wicket.fielder) : null;
      const bowlerName = nameOf(bowl.id);
      out.how =
        wicket.kind === "caught"
          ? wicket.fielder === bowl.id
            ? `c & b ${bowlerName}`
            : `c ${fielder ?? "?"} b ${bowlerName}`
          : wicket.kind === "stumped"
            ? `st ${fielder ?? "?"} b ${bowlerName}`
            : wicket.kind === "run_out"
              ? `run out${fielder ? ` (${fielder})` : ""}`
              : wicket.kind === "lbw"
                ? `lbw b ${bowlerName}`
                : wicket.kind === "bowled"
                  ? `b ${bowlerName}`
                  : `hit wicket b ${bowlerName}`;
      if (kind?.bowler) bowl.wickets++;
      if (wicket.fielder) {
        const f = (state.fielding[wicket.fielder] ??= { catches: 0, stumpings: 0, run_outs: 0 });
        if (wicket.kind === "caught") f.catches++;
        if (wicket.kind === "stumped") f.stumpings++;
        if (wicket.kind === "run_out") f.run_outs++;
      }
      inn.wickets++;
      inn.fow.push({ wicket: inn.wickets, runs: inn.runs, balls: inn.legal_balls, player: wicket.out });
      if (inn.striker === wicket.out) inn.striker = null;
      else if (inn.non_striker === wicket.out) inn.non_striker = null;
    }

    // free hit follows a no-ball and lasts until the next legal delivery
    if (e.extra === "nb" && rules.free_hit) inn.free_hit = true;
    else if (legal) inn.free_hit = false;

    if (legal && inn.legal_balls % 6 === 0) {
      if (overRuns === 0 && inn.overs.at(-1)!.length > 0) bowl.maidens++;
      inn.last_over_bowler = bowl.id;
      inn.bowler = null;
      [inn.striker, inn.non_striker] = [inn.non_striker, inn.striker];
      overRuns = 0;
    }
    finishCheck(inn);
    if (!inn.complete && legal && inn.legal_balls % 6 === 0) inn.overs.push([]);
  }

  const cur = state.current;
  if (!state.toss) state.next = "toss";
  else if (state.drawn) state.next = "finished";
  else if (!cur) state.next = "innings_start";
  else if (cur.complete) state.next = matchOver(state, rules) ? "finished" : "innings_break";
  else if (!cur.striker || !cur.non_striker) state.next = "new_batter";
  else if (!cur.bowler) state.next = "new_bowler";
  else state.next = "ball";
  // limited overs: show the target during the break
  if (rules.innings_per_side === 1 && cur?.complete && state.innings.length === 1) state.target = cur.runs + 1;
  return state;
}

export type Result = { outcome: "win" | "tie" | "draw"; winner: string | null; text: string };

// Tests: the result from the replayed innings (call once state.next is "finished")
export function testResult(state: MatchState, rules: ScoringRules, lineups: Lineups, teamName: (id: string | null) => string): Result {
  const totals = teamTotals(state);
  const inns = state.innings;
  const fourth = inns[3];
  if (fourth?.end_reason === "target") {
    const left = allOutAt(rules, lineups[fourth.batting_team]?.length ?? 11) - fourth.wickets;
    return { outcome: "win", winner: fourth.batting_team, text: `${teamName(fourth.batting_team)} won by ${left} wicket${left === 1 ? "" : "s"}` };
  }
  if (state.drawn) return { outcome: "draw", winner: null, text: "Match drawn" };
  if (inns.length === 3 && inns[2]!.complete) {
    const third = inns[2]!;
    const by = (totals[third.bowling_team] ?? 0) - (totals[third.batting_team] ?? 0);
    if (by > 0) return { outcome: "win", winner: third.bowling_team, text: `${teamName(third.bowling_team)} won by an innings and ${by} run${by === 1 ? "" : "s"}` };
  }
  if (fourth?.complete) {
    const by = (totals[fourth.bowling_team] ?? 0) - (totals[fourth.batting_team] ?? 0);
    if (by === 0) return { outcome: "tie", winner: null, text: "Match tied" };
    return { outcome: "win", winner: fourth.bowling_team, text: `${teamName(fourth.bowling_team)} won by ${by} run${by === 1 ? "" : "s"}` };
  }
  return { outcome: "draw", winner: null, text: "Match drawn" };
}

// Test scores in batting order, saved on the match row: "245 & 180/6d"
export type InningsSummary = { team: string; runs: number; wickets: number; balls: number; declared: boolean; follow_on: boolean };

export function inningsSummary(state: Pick<MatchState, "innings">): InningsSummary[] {
  return state.innings.map((i) => ({
    team: i.batting_team,
    runs: i.runs,
    wickets: i.wickets,
    balls: i.legal_balls,
    declared: i.end_reason === "declared",
    follow_on: i.follow_on,
  }));
}

// One team's Test score line, e.g. "245 & 180/6d (f/o)". allOut hides the wickets of a completed all-out innings.
export function testScoreText(list: InningsSummary[] | null | undefined, team: string | null, allOut = 10) {
  const mine = (list ?? []).filter((i) => i.team === team);
  if (!mine.length) return null;
  return mine
    .map((i) => `${i.runs}${i.wickets < allOut || i.declared ? `/${i.wickets}` : ""}${i.declared ? "d" : ""}${i.follow_on ? " (f/o)" : ""}`)
    .join(" & ");
}

// Players of the batting side who can still come in
export function availableBatters(inn: InningsState, xi: string[]) {
  return xi.filter((id) => {
    const b = inn.batters.find((x) => x.id === id);
    return !b || (b.retired && !b.out && id !== inn.striker && id !== inn.non_striker);
  });
}

// Bowlers allowed for the next over: not the last over's bowler, and under the overs limit
export function availableBowlers(inn: InningsState, xi: string[], rules: ScoringRules) {
  return xi.map((id) => {
    const line = inn.bowlers.find((x) => x.id === id);
    const overs = Math.floor((line?.balls ?? 0) / 6);
    const reason = id === inn.last_over_bowler ? "Bowled last over" : rules.max_bowler_overs && overs >= rules.max_bowler_overs ? `Max ${rules.max_bowler_overs} overs` : null;
    return { id, overs: line ? ballsText(line.balls) : "0", reason };
  });
}

// Short summary stored on the match row so lists can show the live score without replaying
// Tests also carry the day, the lead and every innings so far
export type LiveScore = {
  innings: number;
  team: string;
  runs: number;
  wickets: number;
  balls: number;
  target: number | null;
  overs: number;
  test?: { day: number; lead: number; stumps: boolean; on_break: BreakKind | null; scores: InningsSummary[] };
};

export function liveScore(state: MatchState, rules: ScoringRules): LiveScore | null {
  const c = state.current;
  if (!c) return null;
  const base = { innings: c.number, team: c.batting_team, runs: c.runs, wickets: c.wickets, balls: c.legal_balls, target: state.target, overs: rules.overs };
  if (rules.format !== "test") return base;
  return { ...base, test: { day: state.day, lead: leadOf(state), stumps: state.stumps, on_break: state.on_break, scores: inningsSummary(state) } };
}

// Fields for the matches table once the match is done (winner decided by decideResult / testResult).
// In a Test the runs and balls are both innings added up; wickets are from the side's last innings.
export function resultScores(state: MatchState, teamA: string) {
  const i1 = state.innings[0];
  if (!i1) return null;
  const side = (mine: boolean) => {
    const list = state.innings.filter((i) => (i.batting_team === teamA) === mine);
    return {
      runs: list.reduce((s, i) => s + i.runs, 0),
      wickets: list.at(-1)?.wickets ?? 0,
      balls: list.reduce((s, i) => s + i.legal_balls, 0),
    };
  };
  const a = side(true);
  const b = side(false);
  return {
    batting_first: (i1.batting_team === teamA ? "a" : "b") as "a" | "b",
    a_runs: a.runs,
    a_wickets: a.wickets,
    a_balls: a.balls,
    b_runs: b.runs,
    b_wickets: b.wickets,
    b_balls: b.balls,
  };
}

// Per player numbers for one match (saved when the match finishes)
export type PlayerMatchStats = {
  match_player_id: string;
  innings: number; // 1, or 2 for a player's second innings in a Test
  team_id: string;
  did_bat: boolean;
  bat_runs: number;
  bat_balls: number;
  fours: number;
  sixes: number;
  out: boolean;
  how_out: string | null;
  bowl_balls: number;
  bowl_runs: number;
  wickets: number;
  maidens: number;
  wides: number;
  noballs: number;
  catches: number;
  stumpings: number;
  run_outs: number;
};

// One row per player (per innings in a Test: a player's 2nd innings gets its own row)
export function matchStats(state: MatchState, lineups: Lineups): PlayerMatchStats[] {
  const rows = new Map<string, PlayerMatchStats>();
  const teamOf = new Map<string, string>();
  const blank = (id: string, team: string, innings: number): PlayerMatchStats => ({
    match_player_id: id,
    innings,
    team_id: team,
    did_bat: false,
    bat_runs: 0,
    bat_balls: 0,
    fours: 0,
    sixes: 0,
    out: false,
    how_out: null,
    bowl_balls: 0,
    bowl_runs: 0,
    wickets: 0,
    maidens: 0,
    wides: 0,
    noballs: 0,
    catches: 0,
    stumpings: 0,
    run_outs: 0,
  });
  const row = (id: string, innings: number) => {
    const key = `${id}:${innings}`;
    if (!rows.has(key) && teamOf.has(id)) rows.set(key, blank(id, teamOf.get(id)!, innings));
    return rows.get(key);
  };
  for (const [team, ids] of Object.entries(lineups)) {
    for (const id of ids) {
      teamOf.set(id, team);
      row(id, 1);
    }
  }
  // the nth time each side batted / bowled
  const batTimes: Record<string, number> = {};
  const bowlTimes: Record<string, number> = {};
  for (const inn of state.innings) {
    const batN = (batTimes[inn.batting_team] = (batTimes[inn.batting_team] ?? 0) + 1);
    const bowlN = (bowlTimes[inn.bowling_team] = (bowlTimes[inn.bowling_team] ?? 0) + 1);
    for (const b of inn.batters) {
      const r = row(b.id, batN);
      if (r) Object.assign(r, { did_bat: true, bat_runs: b.runs, bat_balls: b.balls, fours: b.fours, sixes: b.sixes, out: b.out, how_out: b.how });
    }
    for (const b of inn.bowlers) {
      const r = row(b.id, bowlN);
      if (r) Object.assign(r, { bowl_balls: b.balls, bowl_runs: b.runs, wickets: b.wickets, maidens: b.maidens, wides: b.wides, noballs: b.noballs });
    }
  }
  for (const [id, f] of Object.entries(state.fielding)) {
    const r = row(id, 1);
    if (r) Object.assign(r, f);
  }
  return [...rows.values()];
}
