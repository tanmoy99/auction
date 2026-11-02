"use client";

import { useMemo } from "react";
import Link from "next/link";
import { tournamentTotals } from "./stats";
import { Avatar, Card, TeamDot } from "./ui";
import { rupees } from "@/lib/format";
import type { PlayerStatRow } from "@/lib/hooks";
import { performanceText, rankMatch } from "@/lib/mvp";
import { runRate } from "@/lib/scoring";

export type CareerEntry = {
  player_id: string;
  tournament_id: string;
  tournament: string;
  starts_on: string | null;
  team_id: string | null;
  team: string | null;
  team_color: string | null;
  sold_price: number | null;
  status: string;
};
export type CareerStatRow = PlayerStatRow & {
  match_no: number;
  round_name: string | null;
  scheduled_at: string | null;
  result_text: string | null;
  winner_team_id: string | null;
  opponent: string | null;
};
// What public.player_career() returns (migration 019)
export type Career = {
  profile: { id: string; name: string; role: string | null; batting_style: string | null; bowling_style: string | null; city: string | null; photo_url: string | null };
  entries: CareerEntry[];
  stats: CareerStatRow[];
};

// Profile card, career stats, tournaments and matches. `children` go under the career stats (e.g. upcoming matches).
export function CareerView({ career, children }: { career: Career; children?: React.ReactNode }) {
  const t = useMemo(() => (career.stats.length ? tournamentTotals(career.stats.map((s) => ({ ...s, player_id: career.profile.id })))[0] : null), [career]);
  const matches = useMemo(() => {
    const byMatch = new Map<string, CareerStatRow[]>();
    for (const s of career.stats) byMatch.set(s.match_id, [...(byMatch.get(s.match_id) ?? []), s]);
    return [...byMatch.values()].map((rows) => ({ row: rows[0]!, perf: rankMatch(rows, () => "me", rows[0]!.winner_team_id)[0] }));
  }, [career]);

  const p = career.profile;
  const tournamentName = new Map(career.entries.map((e) => [e.tournament_id, e.tournament]));
  const outs = t ? t.innings - t.not_outs : 0;
  const tiles: [string, string][] = t
    ? [
        ["Matches", String(t.matches)],
        ["Runs", String(t.runs)],
        ["Highest", `${t.high}${t.high_not_out ? "*" : ""}`],
        ["Average", outs ? (t.runs / outs).toFixed(1) : "-"],
        ["Strike rate", t.balls ? ((t.runs * 100) / t.balls).toFixed(1) : "-"],
        ["Wickets", String(t.wickets)],
        ["Best", t.best ? `${t.best.wickets}/${t.best.runs}` : "-"],
        ["Economy", t.bowl_balls ? runRate(t.bowl_runs, t.bowl_balls).toFixed(2) : "-"],
        ["Catches", String(t.catches + t.stumpings)],
        ["MVP points", String(t.points.total)],
      ]
    : [];

  return (
    <>
      <section className="flex items-center gap-4 rounded-3xl bg-slate-950 p-5 text-white">
        <Avatar name={p.name} src={p.photo_url} size={88} />
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-black">{p.name}</h1>
          <p className="text-sm text-emerald-300">{[p.role, p.city].filter(Boolean).join(" · ")}</p>
          <p className="mt-1 text-xs text-slate-400">{[p.batting_style, p.bowling_style].filter(Boolean).join(" · ")}</p>
        </div>
      </section>

      {t ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {tiles.map(([label, value]) => (
            <Card key={label} className="p-3 text-center">
              <p className="text-xl font-black tabular-nums text-slate-900">{value}</p>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-4 text-center text-sm text-slate-500">Career stats appear here after the first ball-by-ball scored match.</Card>
      )}

      {children}

      <Card className="overflow-hidden">
        <h2 className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">Tournaments</h2>
        <ul className="divide-y divide-slate-100">
          {career.entries.map((e) => (
            <li key={e.player_id}>
              <Link href={`/squads/${e.tournament_id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                <TeamDot color={e.team_color ?? "#cbd5e1"} className="size-3 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-900">{e.tournament}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {e.team ?? (e.status === "unsold" ? "Unsold" : "Not in a team yet")}
                    {e.starts_on && ` · ${new Date(e.starts_on).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}`}
                  </span>
                </span>
                {e.sold_price != null && <span className="text-sm font-semibold tabular-nums text-slate-700">{rupees(e.sold_price)}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      {matches.length > 0 && (
        <Card className="overflow-hidden">
          <h2 className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">Matches</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {matches.map(({ row, perf }) => (
              <li key={row.match_id}>
                <Link href={`/match/${row.match_id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900">v {row.opponent ?? "TBD"}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {tournamentName.get(row.tournament_id)} · Match {row.match_no}
                      {row.scheduled_at && ` · ${new Date(row.scheduled_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block tabular-nums text-slate-700">{perf ? performanceText(perf) : "-"}</span>
                    <span className="text-xs text-slate-400">{perf?.points ?? 0} pts</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
