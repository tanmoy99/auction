"use client";

import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import type { PlayerStatRow } from "@/lib/hooks";
import { ballsText, runRate } from "@/lib/scoring";
import type { Team } from "@/lib/types";
import { Card, EmptyState, TeamDot, cn } from "./ui";

export type PlayerTotals = {
  key: string;
  name: string;
  team_id: string;
  matches: number;
  innings: number;
  runs: number;
  balls: number;
  not_outs: number;
  high: number;
  high_not_out: boolean;
  fours: number;
  sixes: number;
  fifties: number;
  bowl_balls: number;
  bowl_runs: number;
  wickets: number;
  maidens: number;
  best: { wickets: number; runs: number } | null;
  catches: number;
  stumpings: number;
  run_outs: number;
};

// Adds up every finished match per player (auction player, or guest).
// A Test gives a player one row per innings, so matches are counted by match id.
export function tournamentTotals(rows: PlayerStatRow[]) {
  const map = new Map<string, PlayerTotals>();
  const seen = new Set<string>();
  for (const r of rows) {
    const key = r.player_id ?? r.guest_id ?? `${r.team_id}:${r.name}`;
    let t = map.get(key);
    if (!t) {
      t = {
        key,
        name: r.name,
        team_id: r.team_id,
        matches: 0,
        innings: 0,
        runs: 0,
        balls: 0,
        not_outs: 0,
        high: 0,
        high_not_out: false,
        fours: 0,
        sixes: 0,
        fifties: 0,
        bowl_balls: 0,
        bowl_runs: 0,
        wickets: 0,
        maidens: 0,
        best: null,
        catches: 0,
        stumpings: 0,
        run_outs: 0,
      };
      map.set(key, t);
    }
    if (!seen.has(`${key}:${r.match_id}`)) {
      seen.add(`${key}:${r.match_id}`);
      t.matches++;
    }
    if (r.did_bat) {
      t.innings++;
      t.runs += r.bat_runs;
      t.balls += r.bat_balls;
      if (!r.out) t.not_outs++;
      if (r.bat_runs > t.high || (r.bat_runs === t.high && !r.out)) {
        t.high = r.bat_runs;
        t.high_not_out = !r.out;
      }
      if (r.bat_runs >= 50) t.fifties++;
    }
    t.fours += r.fours;
    t.sixes += r.sixes;
    t.bowl_balls += r.bowl_balls;
    t.bowl_runs += r.bowl_runs;
    t.wickets += r.wickets;
    t.maidens += r.maidens;
    if (r.bowl_balls && (!t.best || r.wickets > t.best.wickets || (r.wickets === t.best.wickets && r.bowl_runs < t.best.runs))) {
      t.best = { wickets: r.wickets, runs: r.bowl_runs };
    }
    t.catches += r.catches;
    t.stumpings += r.stumpings;
    t.run_outs += r.run_outs;
  }
  return [...map.values()];
}

function Leader({ title, value, sub, player, team }: { title: string; value: string; sub?: string; player?: PlayerTotals; team?: Team }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {player ? (
        <>
          <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{value}</p>
          <p className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-800">
            <TeamDot color={team?.color ?? "#cbd5e1"} /> {player.name}
          </p>
          {sub && <p className="text-xs text-slate-500">{sub}</p>}
        </>
      ) : (
        <p className="mt-2 text-sm text-slate-400">-</p>
      )}
    </Card>
  );
}

export function StatsView({ rows, teams }: { rows: PlayerStatRow[]; teams: Map<string, Team> }) {
  const [tab, setTab] = useState<"batting" | "bowling" | "fielding">("batting");
  const totals = useMemo(() => tournamentTotals(rows), [rows]);
  const matchesDone = new Set(rows.map((r) => r.match_id)).size;

  if (!rows.length)
    return (
      <EmptyState
        icon={<BarChart3 className="size-6" />}
        title="No stats yet"
        text="Player stats appear here after the first ball-by-ball scored match is finished."
      />
    );

  const top = <T,>(list: T[], score: (x: T) => number) => [...list].sort((a, b) => score(b) - score(a))[0];
  const mostRuns = top(totals, (t) => t.runs * 1000 - t.balls);
  const mostWickets = top(totals, (t) => t.wickets * 10000 - t.bowl_runs);
  const mostSixes = top(totals, (t) => t.sixes);
  const best = top(totals.filter((t) => t.best), (t) => t.best!.wickets * 1000 - t.best!.runs);
  const highest = top(rows.filter((r) => r.did_bat), (r) => r.bat_runs * 2 + (r.out ? 0 : 1));
  const highestPlayer = highest && totals.find((t) => t.key === (highest.player_id ?? highest.guest_id ?? `${highest.team_id}:${highest.name}`));
  const strike = top(totals.filter((t) => t.balls >= 20), (t) => runRate(t.runs, t.balls));
  const economy = top(totals.filter((t) => t.bowl_balls >= 12), (t) => -runRate(t.bowl_runs, t.bowl_balls));
  const catches = top(totals, (t) => t.catches);
  const sr = (t: PlayerTotals) => (t.balls ? ((t.runs * 100) / t.balls).toFixed(1) : "-");

  const batting = totals.filter((t) => t.innings > 0).sort((a, b) => b.runs - a.runs || a.balls - b.balls);
  const bowling = totals.filter((t) => t.bowl_balls > 0).sort((a, b) => b.wickets - a.wickets || a.bowl_runs - b.bowl_runs);
  const fielding = totals.filter((t) => t.catches + t.stumpings + t.run_outs > 0).sort((a, b) => b.catches + b.stumpings + b.run_outs - (a.catches + a.stumpings + a.run_outs));

  const th = "px-2 py-2 text-right font-medium";
  const td = "px-2 py-2 text-right tabular-nums text-slate-600";
  const nameCell = (t: PlayerTotals) => (
    <td className="px-3 py-2">
      <span className="flex items-center gap-2 font-medium text-slate-900">
        <TeamDot color={teams.get(t.team_id)?.color ?? "#cbd5e1"} className="size-2.5 shrink-0" />
        <span className="max-w-44 truncate">{t.name}</span>
      </span>
    </td>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">From {matchesDone} scored match{matchesDone === 1 ? "" : "es"}. Updated when each match finishes.</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Leader title="Most runs" value={`${mostRuns?.runs ?? 0}`} sub={mostRuns && `${mostRuns.innings} inns · SR ${sr(mostRuns)}`} player={mostRuns} team={teams.get(mostRuns?.team_id ?? "")} />
        <Leader title="Most wickets" value={`${mostWickets?.wickets ?? 0}`} sub={mostWickets && `${ballsText(mostWickets.bowl_balls)} ov · econ ${runRate(mostWickets.bowl_runs, mostWickets.bowl_balls).toFixed(2)}`} player={mostWickets?.wickets ? mostWickets : undefined} team={teams.get(mostWickets?.team_id ?? "")} />
        <Leader title="Highest score" value={highest ? `${highest.bat_runs}${highest.out ? "" : "*"}` : "-"} sub={highest && `${highest.bat_balls} balls`} player={highestPlayer} team={teams.get(highest?.team_id ?? "")} />
        <Leader title="Best bowling" value={best?.best ? `${best.best.wickets}/${best.best.runs}` : "-"} player={best?.best?.wickets ? best : undefined} team={teams.get(best?.team_id ?? "")} />
        <Leader title="Most sixes" value={`${mostSixes?.sixes ?? 0}`} player={mostSixes?.sixes ? mostSixes : undefined} team={teams.get(mostSixes?.team_id ?? "")} />
        <Leader title="Best strike rate" value={strike ? sr(strike) : "-"} sub="min 20 balls" player={strike} team={teams.get(strike?.team_id ?? "")} />
        <Leader title="Best economy" value={economy ? runRate(economy.bowl_runs, economy.bowl_balls).toFixed(2) : "-"} sub="min 2 overs" player={economy} team={teams.get(economy?.team_id ?? "")} />
        <Leader title="Most catches" value={`${catches?.catches ?? 0}`} player={catches?.catches ? catches : undefined} team={teams.get(catches?.team_id ?? "")} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex border-b border-slate-100 text-sm">
          {(["batting", "bowling", "fielding"] as const).map((x) => (
            <button key={x} onClick={() => setTab(x)} className={cn("flex-1 py-2.5 font-medium capitalize", tab === x ? "border-b-2 border-emerald-600 text-emerald-700" : "text-slate-500")}>
              {x}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            {tab === "batting" && (
              <>
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Player</th>
                    <th className={th}>M</th>
                    <th className={th}>Inn</th>
                    <th className="px-2 py-2 text-right font-semibold text-slate-700">Runs</th>
                    <th className={th}>HS</th>
                    <th className={th}>Avg</th>
                    <th className={th}>SR</th>
                    <th className={th}>4s</th>
                    <th className={th}>6s</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {batting.map((t) => {
                    const outs = t.innings - t.not_outs;
                    return (
                      <tr key={t.key}>
                        {nameCell(t)}
                        <td className={td}>{t.matches}</td>
                        <td className={td}>{t.innings}</td>
                        <td className="px-2 py-2 text-right font-bold tabular-nums text-slate-900">{t.runs}</td>
                        <td className={td}>
                          {t.high}
                          {t.high_not_out ? "*" : ""}
                        </td>
                        <td className={td}>{outs ? (t.runs / outs).toFixed(1) : "-"}</td>
                        <td className={td}>{sr(t)}</td>
                        <td className={td}>{t.fours}</td>
                        <td className={td}>{t.sixes}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </>
            )}
            {tab === "bowling" && (
              <>
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Player</th>
                    <th className={th}>M</th>
                    <th className={th}>Overs</th>
                    <th className="px-2 py-2 text-right font-semibold text-slate-700">Wkts</th>
                    <th className={th}>Runs</th>
                    <th className={th}>Best</th>
                    <th className={th}>Econ</th>
                    <th className={th}>Avg</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bowling.map((t) => (
                    <tr key={t.key}>
                      {nameCell(t)}
                      <td className={td}>{t.matches}</td>
                      <td className={td}>{ballsText(t.bowl_balls)}</td>
                      <td className="px-2 py-2 text-right font-bold tabular-nums text-slate-900">{t.wickets}</td>
                      <td className={td}>{t.bowl_runs}</td>
                      <td className={td}>{t.best ? `${t.best.wickets}/${t.best.runs}` : "-"}</td>
                      <td className={td}>{runRate(t.bowl_runs, t.bowl_balls).toFixed(2)}</td>
                      <td className={td}>{t.wickets ? (t.bowl_runs / t.wickets).toFixed(1) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
            {tab === "fielding" && (
              <>
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Player</th>
                    <th className={th}>Catches</th>
                    <th className={th}>Stumpings</th>
                    <th className={th}>Run outs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {fielding.map((t) => (
                    <tr key={t.key}>
                      {nameCell(t)}
                      <td className={td}>{t.catches}</td>
                      <td className={td}>{t.stumpings}</td>
                      <td className={td}>{t.run_outs}</td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}
