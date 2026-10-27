// Fixture generation, scheduling, points table and knockout progression.
// Plain functions with no app imports, so scripts can use them too.

export type FixtureFormat = "league" | "groups" | "knockout";
export type Playoff = "none" | "final" | "semis" | "quarters" | "ipl";

export type FixtureSettings = {
  format: FixtureFormat;
  legs: 1 | 2; // league / group stage: every team meets every other once or twice
  playoff: Playoff; // league format only
  groups: number; // groups format
  qualify: number; // teams per group that reach the knockouts
  overs: number;
  wickets: number; // a side is all out after this many wickets
  points: { win: number; tie: number; no_result: number };
  schedule: { start_date: string; first_time: string; per_day: number; gap_minutes: number; venue: string; knockouts_new_day: boolean };
};

export type Source =
  | { type: "team"; team_id: string }
  | { type: "winner"; match: number }
  | { type: "loser"; match: number }
  | { type: "standing"; group: string | null; position: number };

export type Outcome = "win" | "tie" | "no_result" | "walkover";

export type Match = {
  id: string;
  tournament_id: string;
  match_no: number;
  stage: "league" | "group" | "knockout";
  group_name: string | null;
  round: number;
  round_name: string;
  team_a_id: string | null;
  team_b_id: string | null;
  a_source: Source | null;
  b_source: Source | null;
  scheduled_at: string | null;
  venue: string | null;
  status: "scheduled" | "completed";
  outcome: Outcome | null;
  winner_team_id: string | null;
  batting_first: "a" | "b" | null;
  a_runs: number | null;
  a_wickets: number | null;
  a_balls: number | null;
  b_runs: number | null;
  b_wickets: number | null;
  b_balls: number | null;
  result_text: string | null;
  created_at: string;
};

export type NewMatch = Pick<Match, "match_no" | "stage" | "group_name" | "round" | "round_name" | "team_a_id" | "team_b_id" | "a_source" | "b_source" | "scheduled_at" | "venue">;

export const DEFAULT_SETTINGS: FixtureSettings = {
  format: "league",
  legs: 1,
  playoff: "ipl",
  groups: 2,
  qualify: 2,
  overs: 10,
  wickets: 10,
  points: { win: 2, tie: 1, no_result: 1 },
  schedule: { start_date: "", first_time: "09:00", per_day: 4, gap_minutes: 150, venue: "", knockouts_new_day: true },
};

export const GROUP_NAMES = "ABCDEFGHIJKLMNOP".split("");

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

export function ballsToOvers(balls: number | null | undefined) {
  if (balls == null) return "";
  return `${Math.floor(balls / 6)}${balls % 6 ? `.${balls % 6}` : ""}`;
}

// "9.4" -> 58 balls. Returns null for anything that is not a valid overs figure.
export function oversToBalls(text: string) {
  const m = text.trim().match(/^(\d+)(?:\.(\d))?$/);
  if (!m) return null;
  const balls = Number(m[2] ?? 0);
  if (balls > 5) return null;
  return Number(m[1]) * 6 + balls;
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

function nextPow2(n: number) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// Standard bracket order so seed 1 and 2 can only meet in the final: 8 -> [1,8,4,5,2,7,3,6]
function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

function knockoutRoundName(teamsInRound: number) {
  if (teamsInRound === 2) return "Final";
  if (teamsInRound === 4) return "Semi-final";
  if (teamsInRound === 8) return "Quarter-final";
  return `Round of ${teamsInRound}`;
}

// Teams dealt into groups like cards (A B C C B A ...) so earlier teams spread evenly
export function dealGroups(teamIds: string[], groups: number) {
  const out: string[][] = Array.from({ length: groups }, () => []);
  teamIds.forEach((id, i) => {
    const lap = Math.floor(i / groups);
    const g = lap % 2 === 0 ? i % groups : groups - 1 - (i % groups);
    out[g]!.push(id);
  });
  return out;
}

// Circle method: every team plays once per round, nobody plays twice in a round
export function roundRobin(ids: string[], legs: 1 | 2) {
  const list: (string | null)[] = ids.length % 2 ? [...ids, null] : [...ids];
  const n = list.length;
  const rounds: [string, string][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a && b) pairs.push(r % 2 === 0 || i > 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    list.splice(1, 0, list.pop()!); // keep the first team fixed, rotate the rest
  }
  if (legs === 2) return [...rounds, ...rounds.map((pairs) => pairs.map(([a, b]) => [b, a] as [string, string]))];
  return rounds;
}

// ---------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------

// Knockout bracket from seeded entries (entries[0] = seed 1). Missing seeds are byes: that
// team goes straight to the next round. Returns the matches and where the champion comes from.
function bracket(entries: Source[], firstNo: number, firstRound: number) {
  const matches: Omit<NewMatch, "scheduled_at" | "venue">[] = [];
  if (entries.length < 2) return matches;
  const size = nextPow2(entries.length);
  const order = seedOrder(size);
  let slots: (Source | null)[] = order.map((seed) => entries[seed - 1] ?? null);
  let no = firstNo;
  let round = firstRound;
  let teamsInRound = size;

  while (slots.length > 1) {
    const next: (Source | null)[] = [];
    // a round with byes is only there to cut the field down to a full bracket
    const name = slots.some((x) => !x) ? "Preliminary" : knockoutRoundName(teamsInRound);
    const real: { a: Source; b: Source; no: number }[] = [];
    for (let i = 0; i < slots.length; i += 2) {
      const a = slots[i]!;
      const b = slots[i + 1]!;
      if (a && b) {
        real.push({ a, b, no });
        next.push({ type: "winner", match: no });
        no++;
      } else next.push(a ?? b); // bye
    }
    real.forEach((m, i) =>
      matches.push({
        match_no: m.no,
        stage: "knockout",
        group_name: null,
        round,
        round_name: real.length > 1 ? `${name} ${i + 1}` : name,
        team_a_id: m.a.type === "team" ? m.a.team_id : null,
        team_b_id: m.b.type === "team" ? m.b.team_id : null,
        a_source: m.a,
        b_source: m.b,
      }),
    );
    if (real.length) round++;
    slots = next;
    teamsInRound /= 2;
  }
  return matches;
}

// Who comes through from each group, seeded so group winners meet runners-up of another group
function groupQualifiers(groupCount: number, qualify: number): Source[] {
  const seeds: Source[] = [];
  for (let pos = 1; pos <= qualify; pos++) {
    for (let g = 0; g < groupCount; g++) seeds.push({ type: "standing", group: GROUP_NAMES[g]!, position: pos });
  }
  if (qualify !== 2 || groupCount < 2) return seeds;
  // seed (n + 1 - i) meets seed i in round one: make that the runner-up of a different group
  const n = groupCount * 2;
  const partner = (g: number) => (groupCount % 2 === 0 ? g ^ 1 : (g + 1) % groupCount);
  const result: Source[] = new Array(n);
  for (let g = 0; g < groupCount; g++) {
    result[g] = { type: "standing", group: GROUP_NAMES[g]!, position: 1 };
    result[n - 1 - g] = { type: "standing", group: GROUP_NAMES[partner(g)]!, position: 2 };
  }
  return result;
}

function leaguePlayoffs(playoff: Playoff, firstNo: number, firstRound: number) {
  const top = (position: number): Source => ({ type: "standing", group: null, position });
  if (playoff === "none") return [];
  if (playoff === "ipl") {
    const base = { stage: "knockout" as const, group_name: null, team_a_id: null, team_b_id: null };
    return [
      { ...base, match_no: firstNo, round: firstRound, round_name: "Qualifier 1", a_source: top(1), b_source: top(2) },
      { ...base, match_no: firstNo + 1, round: firstRound, round_name: "Eliminator", a_source: top(3), b_source: top(4) },
      { ...base, match_no: firstNo + 2, round: firstRound + 1, round_name: "Qualifier 2", a_source: { type: "loser" as const, match: firstNo }, b_source: { type: "winner" as const, match: firstNo + 1 } },
      { ...base, match_no: firstNo + 3, round: firstRound + 2, round_name: "Final", a_source: { type: "winner" as const, match: firstNo }, b_source: { type: "winner" as const, match: firstNo + 2 } },
    ];
  }
  const count = playoff === "final" ? 2 : playoff === "semis" ? 4 : 8;
  return bracket(Array.from({ length: count }, (_, i) => top(i + 1)), firstNo, firstRound);
}

// Minimum teams each option needs
export function playoffTeams(playoff: Playoff) {
  return { none: 0, final: 2, semis: 4, quarters: 8, ipl: 4 }[playoff];
}

// Problems with the chosen settings, or null when they can be generated
export function validateSettings(s: FixtureSettings, teamCount: number, groups?: string[][]) {
  if (teamCount < 2) return "Add at least 2 teams first";
  if (s.format === "league" && s.playoff !== "none" && teamCount < playoffTeams(s.playoff)) {
    return `This playoff needs at least ${playoffTeams(s.playoff)} teams`;
  }
  if (s.format === "groups") {
    if (s.groups < 2) return "Choose at least 2 groups";
    const sizes = (groups ?? dealGroups(Array.from({ length: teamCount }, (_, i) => String(i)), s.groups)).map((g) => g.length);
    if (Math.min(...sizes) < 2) return "Every group needs at least 2 teams";
    if (s.qualify < 1 || s.qualify > Math.min(...sizes)) return "More teams qualify than some groups have";
    if (s.groups * s.qualify < 2) return "At least 2 teams must reach the knockouts";
  }
  if (!s.schedule.start_date) return "Pick a start date";
  if (s.schedule.per_day < 1) return "At least 1 match per day";
  return null;
}

// Every match of the tournament, numbered and scheduled
export function generateFixtures(s: FixtureSettings, teamIds: string[], groups?: string[][]): NewMatch[] {
  const draft: Omit<NewMatch, "scheduled_at" | "venue">[] = [];
  let no = 1;

  if (s.format === "knockout") {
    draft.push(...bracket(teamIds.map((id) => ({ type: "team", team_id: id })), 1, 1));
  } else {
    const lists = s.format === "groups" ? (groups ?? dealGroups(teamIds, s.groups)) : [teamIds];
    const perGroup = lists.map((ids) => roundRobin(ids, s.legs));
    const rounds = Math.max(...perGroup.map((r) => r.length));
    for (let r = 0; r < rounds; r++) {
      // interleave groups so every group progresses at the same pace
      perGroup.forEach((groupRounds, g) => {
        for (const [a, b] of groupRounds[r] ?? []) {
          draft.push({
            match_no: no++,
            stage: s.format === "groups" ? "group" : "league",
            group_name: s.format === "groups" ? GROUP_NAMES[g]! : null,
            round: r + 1,
            round_name: s.format === "groups" ? `Group ${GROUP_NAMES[g]}` : `Match ${no - 1}`,
            team_a_id: a,
            team_b_id: b,
            a_source: null,
            b_source: null,
          });
        }
      });
    }
    const firstRound = rounds + 1;
    if (s.format === "league") draft.push(...leaguePlayoffs(s.playoff, no, firstRound));
    else draft.push(...bracket(groupQualifiers(lists.length, s.qualify), no, firstRound));
  }

  return schedule(draft, s.schedule);
}

// Fills dates and times in match order. Times are Indian Standard Time.
export function schedule<T extends Pick<NewMatch, "stage" | "round">>(matches: T[], sc: FixtureSettings["schedule"]) {
  let day = 0;
  let slot = 0;
  const firstKnockout = matches.findIndex((m) => m.stage === "knockout");
  return matches.map((m, i) => {
    if (slot >= sc.per_day || (sc.knockouts_new_day && i === firstKnockout && slot > 0)) {
      day++;
      slot = 0;
    }
    const at = sc.start_date ? slotTime(sc.start_date, sc.first_time, day, slot, sc.gap_minutes) : null;
    slot++;
    return { ...m, scheduled_at: at, venue: sc.venue.trim() || null };
  });
}

function slotTime(date: string, time: string, day: number, slot: number, gap: number) {
  const start = new Date(`${date}T${time || "09:00"}:00+05:30`);
  return new Date(start.getTime() + day * 86_400_000 + slot * gap * 60_000).toISOString();
}

// ---------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------

export function sourceLabel(src: Source | null, byNo?: Map<number, Pick<Match, "round_name">>) {
  if (!src) return "TBD";
  if (src.type === "team") return "TBD";
  if (src.type === "standing") {
    return src.group ? `Group ${src.group} ${src.position === 1 ? "winner" : src.position === 2 ? "runner-up" : ordinal(src.position)}` : `${ordinal(src.position)} in table`;
  }
  const name = byNo?.get(src.match)?.round_name ?? `Match ${src.match}`;
  return `${src.type === "winner" ? "Winner" : "Loser"} of ${name}`;
}

// ---------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------

export type ResultInput = {
  outcome: Outcome;
  batting_first: "a" | "b";
  a_runs: number | null;
  a_wickets: number | null;
  a_balls: number | null;
  b_runs: number | null;
  b_wickets: number | null;
  b_balls: number | null;
  winner_team_id: string | null; // walkover winner, or super over winner after a tie
};

// Winner and the result line ("Tigers won by 24 runs") from the scores
export function decideResult(m: Pick<Match, "team_a_id" | "team_b_id">, r: ResultInput, s: Pick<FixtureSettings, "wickets">, name: (id: string | null) => string) {
  if (r.outcome === "no_result") {
    return { outcome: r.outcome, winner: r.winner_team_id, text: r.winner_team_id ? `No result · ${name(r.winner_team_id)} go through` : "No result" };
  }
  if (r.outcome === "walkover") return { outcome: r.outcome, winner: r.winner_team_id, text: `${name(r.winner_team_id)} won by walkover` };

  const first = r.batting_first === "a" ? { id: m.team_a_id, runs: r.a_runs ?? 0 } : { id: m.team_b_id, runs: r.b_runs ?? 0 };
  const second =
    r.batting_first === "a"
      ? { id: m.team_b_id, runs: r.b_runs ?? 0, wickets: r.b_wickets ?? 0 }
      : { id: m.team_a_id, runs: r.a_runs ?? 0, wickets: r.a_wickets ?? 0 };

  if (first.runs === second.runs || r.outcome === "tie") {
    return {
      outcome: "tie" as const,
      winner: r.winner_team_id,
      text: r.winner_team_id ? `Match tied · ${name(r.winner_team_id)} won the super over` : "Match tied",
    };
  }
  if (first.runs > second.runs) {
    const by = first.runs - second.runs;
    return { outcome: "win" as const, winner: first.id, text: `${name(first.id)} won by ${by} run${by === 1 ? "" : "s"}` };
  }
  const left = Math.max(s.wickets - second.wickets, 1);
  return { outcome: "win" as const, winner: second.id, text: `${name(second.id)} won by ${left} wicket${left === 1 ? "" : "s"}` };
}

// ---------------------------------------------------------------------
// Points table
// ---------------------------------------------------------------------

export type StandingRow = {
  team_id: string;
  played: number;
  won: number;
  lost: number;
  tied: number;
  no_result: number;
  points: number;
  runs_for: number;
  balls_faced: number;
  runs_against: number;
  balls_bowled: number;
  nrr: number;
  form: ("W" | "L" | "T" | "N")[];
};

// One table per group (key null = the single league table), sorted by points, wins, net run rate
export function standings(matches: Match[], s: Pick<FixtureSettings, "overs" | "wickets" | "points">) {
  const tables = new Map<string | null, Map<string, StandingRow>>();
  const row = (group: string | null, id: string) => {
    if (!tables.has(group)) tables.set(group, new Map());
    const t = tables.get(group)!;
    if (!t.has(id)) {
      t.set(id, { team_id: id, played: 0, won: 0, lost: 0, tied: 0, no_result: 0, points: 0, runs_for: 0, balls_faced: 0, runs_against: 0, balls_bowled: 0, nrr: 0, form: [] });
    }
    return t.get(id)!;
  };
  // an all-out side counts as having faced its full overs (standard NRR rule)
  const faced = (balls: number | null, wickets: number | null) => ((wickets ?? 0) >= s.wickets ? s.overs * 6 : (balls ?? 0));

  const ordered = matches.filter((m) => m.stage !== "knockout").sort((a, b) => a.match_no - b.match_no);
  for (const m of ordered) {
    if (!m.team_a_id || !m.team_b_id) continue;
    const a = row(m.group_name, m.team_a_id);
    const b = row(m.group_name, m.team_b_id);
    if (m.status !== "completed") continue;
    a.played++;
    b.played++;

    if (m.outcome === "no_result") {
      for (const r of [a, b]) {
        r.no_result++;
        r.points += s.points.no_result;
        r.form.push("N");
      }
      continue;
    }
    const tieNoWinner = m.outcome === "tie" && !m.winner_team_id;
    if (tieNoWinner) {
      for (const r of [a, b]) {
        r.tied++;
        r.points += s.points.tie;
        r.form.push("T");
      }
    } else {
      const [w, l] = m.winner_team_id === m.team_a_id ? [a, b] : [b, a];
      w.won++;
      w.points += s.points.win;
      w.form.push("W");
      l.lost++;
      l.form.push("L");
    }
    if (m.outcome !== "walkover" && m.a_balls != null && m.b_balls != null) {
      const aFaced = faced(m.a_balls, m.a_wickets);
      const bFaced = faced(m.b_balls, m.b_wickets);
      a.runs_for += m.a_runs ?? 0;
      a.balls_faced += aFaced;
      a.runs_against += m.b_runs ?? 0;
      a.balls_bowled += bFaced;
      b.runs_for += m.b_runs ?? 0;
      b.balls_faced += bFaced;
      b.runs_against += m.a_runs ?? 0;
      b.balls_bowled += aFaced;
    }
  }

  const result = new Map<string | null, StandingRow[]>();
  for (const [group, t] of [...tables.entries()].sort((x, y) => String(x[0]).localeCompare(String(y[0])))) {
    const rows = [...t.values()];
    for (const r of rows) {
      const forRate = r.balls_faced ? (r.runs_for * 6) / r.balls_faced : 0;
      const againstRate = r.balls_bowled ? (r.runs_against * 6) / r.balls_bowled : 0;
      r.nrr = r.balls_faced || r.balls_bowled ? forRate - againstRate : 0;
      r.form = r.form.slice(-5);
    }
    rows.sort((x, y) => y.points - x.points || y.won - x.won || y.nrr - x.nrr || x.team_id.localeCompare(y.team_id));
    result.set(group, rows);
  }
  return result;
}

// ---------------------------------------------------------------------
// Knockout progression
// ---------------------------------------------------------------------

// Which knockout matches now know their teams. Table positions are filled once every match of that
// league / group is finished; winners and losers as soon as their match has a result.
export function resolveTeams(matches: Match[], s: Pick<FixtureSettings, "overs" | "wickets" | "points">) {
  const byNo = new Map(matches.map((m) => [m.match_no, m]));
  const tables = standings(matches, s);
  const groupDone = (group: string | null) =>
    matches.filter((m) => m.stage !== "knockout" && m.group_name === group).every((m) => m.status === "completed");

  const team = (src: Source | null): string | null => {
    if (!src) return null;
    if (src.type === "team") return src.team_id;
    if (src.type === "standing") return groupDone(src.group) ? (tables.get(src.group)?.[src.position - 1]?.team_id ?? null) : null;
    const m = byNo.get(src.match);
    if (!m || m.status !== "completed" || !m.winner_team_id) return null;
    if (src.type === "winner") return m.winner_team_id;
    return m.winner_team_id === m.team_a_id ? m.team_b_id : m.team_a_id;
  };

  const changes: { id: string; team_a_id: string | null; team_b_id: string | null }[] = [];
  for (const m of [...matches].sort((a, b) => a.match_no - b.match_no)) {
    if (m.stage !== "knockout" || m.status === "completed") continue;
    const a = team(m.a_source);
    const b = team(m.b_source);
    if (a !== m.team_a_id || b !== m.team_b_id) changes.push({ id: m.id, team_a_id: a, team_b_id: b });
  }
  return changes;
}

// The tournament winner, once the last knockout (or a league with no playoffs) is done
export function champion(matches: Match[], s: Pick<FixtureSettings, "overs" | "wickets" | "points">) {
  if (!matches.length || matches.some((m) => m.status !== "completed")) return null;
  const knockouts = matches.filter((m) => m.stage === "knockout");
  if (knockouts.length) return knockouts.sort((a, b) => b.match_no - a.match_no)[0]!.winner_team_id;
  return standings(matches, s).get(null)?.[0]?.team_id ?? null;
}
