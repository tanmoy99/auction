// Player of the Match and tournament MVP points. Plain functions with no app imports,
// so the match page, the stats page and the result image all use the same formula.

export type PerformanceLine = {
  bat_runs: number;
  bat_balls: number;
  fours: number;
  sixes: number;
  did_bat: boolean;
  bowl_balls: number;
  bowl_runs: number;
  wickets: number;
  maidens: number;
  catches: number;
  stumpings: number;
  run_outs: number;
};

export const POINTS = {
  run: 1,
  four: 1, // on top of the 4 runs
  six: 2, // on top of the 6 runs
  fifty: 10,
  hundred: 20, // on top of the fifty bonus
  wicket: 20,
  threeWickets: 10,
  fiveWickets: 20, // on top of the three-wicket bonus
  maiden: 10,
  catch: 8,
  stumping: 10,
  runOut: 10,
};

// Points for one innings (a Test gives a player one line per innings; add them up)
export function performancePoints(p: PerformanceLine) {
  let bat = p.bat_runs * POINTS.run + p.fours * POINTS.four + p.sixes * POINTS.six;
  if (p.bat_runs >= 50) bat += POINTS.fifty;
  if (p.bat_runs >= 100) bat += POINTS.hundred;
  let bowl = p.wickets * POINTS.wicket + p.maidens * POINTS.maiden;
  if (p.wickets >= 3) bowl += POINTS.threeWickets;
  if (p.wickets >= 5) bowl += POINTS.fiveWickets;
  const field = p.catches * POINTS.catch + p.stumpings * POINTS.stumping + p.run_outs * POINTS.runOut;
  return { bat, bowl, field, total: bat + bowl + field };
}

export type MatchPerformance = {
  id: string;
  team_id: string;
  runs: number;
  balls: number;
  wickets: number;
  conceded: number;
  bowl_balls: number;
  dismissals: number; // catches + stumpings + run outs
  points: number;
};

// Adds a player's lines in one match together and ranks them. Ties go to the winning side, then runs, then wickets.
export function rankMatch<T extends PerformanceLine & { team_id: string }>(lines: T[], idOf: (l: T) => string, winner: string | null) {
  const map = new Map<string, MatchPerformance>();
  for (const l of lines) {
    const id = idOf(l);
    const m = map.get(id) ?? { id, team_id: l.team_id, runs: 0, balls: 0, wickets: 0, conceded: 0, bowl_balls: 0, dismissals: 0, points: 0 };
    m.runs += l.bat_runs;
    m.balls += l.bat_balls;
    m.wickets += l.wickets;
    m.conceded += l.bowl_runs;
    m.bowl_balls += l.bowl_balls;
    m.dismissals += l.catches + l.stumpings + l.run_outs;
    m.points += performancePoints(l).total;
    map.set(id, m);
  }
  return [...map.values()]
    .filter((m) => m.points > 0)
    .sort(
      (a, b) =>
        b.points - a.points || Number(b.team_id === winner) - Number(a.team_id === winner) || b.runs - a.runs || b.wickets - a.wickets,
    );
}

// "54 (32) · 2/18 · 1 ct" style summary of a match performance
export function performanceText(m: Pick<MatchPerformance, "runs" | "balls" | "wickets" | "conceded" | "bowl_balls" | "dismissals">) {
  const parts: string[] = [];
  if (m.balls || m.runs) parts.push(`${m.runs} (${m.balls})`);
  if (m.bowl_balls) parts.push(`${m.wickets}/${m.conceded}`);
  if (m.dismissals) parts.push(`${m.dismissals} dismissal${m.dismissals === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
