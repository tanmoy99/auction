"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, KeyRound, MapPin, Pencil, Radio, Trophy } from "lucide-react";
import {
  DEFAULT_SETTINGS,
  ballsToOvers,
  champion,
  playoffTeams,
  sourceLabel,
  standings,
  type FixtureSettings,
  type Match,
  type StandingRow,
} from "@/lib/fixtures";
import { useTournamentStats } from "@/lib/hooks";
import { ballsText as oversText } from "@/lib/scoring";
import type { Team } from "@/lib/types";
import { StatsView } from "./stats";
import { Button, Card, EmptyState, TeamDot, cn } from "./ui";

const IST = "Asia/Kolkata";

export function matchDay(iso: string | null) {
  if (!iso) return "Date to be decided";
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: IST, weekday: "long", day: "numeric", month: "long" });
}

export function matchTime(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit" });
}

// Date and time inputs (IST) <-> ISO timestamp
export function toISTInputs(iso: string | null) {
  if (!iso) return { date: "", time: "" };
  const shifted = new Date(new Date(iso).getTime() + 330 * 60_000).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}

export function fromISTInputs(date: string, time: string) {
  return date ? new Date(`${date}T${time || "09:00"}:00+05:30`).toISOString() : null;
}

export function formatName(s: FixtureSettings | null) {
  if (!s) return "";
  const legs = s.legs === 2 ? "home & away" : "single round";
  if (s.format === "knockout") return "Knockout";
  if (s.format === "groups") return `${s.groups} groups (${legs}), top ${s.qualify} to knockouts`;
  const playoff = { none: "no playoffs", final: "top 2 final", semis: "semi-finals", quarters: "quarter-finals", ipl: "IPL-style playoffs" }[s.playoff];
  return `League (${legs}) + ${playoff}`;
}

function score(runs: number | null, wickets: number | null, balls: number | null, allOut: number) {
  if (runs == null) return null;
  return `${runs}${wickets != null && wickets < allOut ? `/${wickets}` : ""}${balls != null ? ` (${ballsToOvers(balls)})` : ""}`;
}

export function MatchCard({
  match: m,
  teams,
  byNo,
  settings,
  onResult,
  onEdit,
  onScorer,
}: {
  match: Match;
  teams: Map<string, Team>;
  byNo: Map<number, Match>;
  settings: FixtureSettings;
  onResult?: (m: Match) => void;
  onEdit?: (m: Match) => void;
  onScorer?: (m: Match) => void;
}) {
  const done = m.status === "completed";
  const live = m.status === "live" ? m.live_score : null;
  const sides = [
    { id: m.team_a_id, src: m.a_source, runs: m.a_runs, wickets: m.a_wickets, balls: m.a_balls },
    { id: m.team_b_id, src: m.b_source, runs: m.b_runs, wickets: m.b_wickets, balls: m.b_balls },
  ];
  const ready = !!m.team_a_id && !!m.team_b_id;
  const knockout = m.stage === "knockout";

  return (
    <Card className={cn("p-3", knockout && "border-amber-200")}>
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-slate-500">
        <span className="min-w-0 truncate">
          <span className="font-semibold text-slate-700">Match {m.match_no}</span>
          {m.stage !== "league" && (
            <span className={cn("ml-1.5 rounded px-1.5 py-0.5 font-medium", knockout ? "bg-amber-100 text-amber-800" : "bg-sky-50 text-sky-700")}>
              {m.round_name}
            </span>
          )}
        </span>
        {m.status === "live" ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white">
            <span className="size-1.5 animate-pulse rounded-full bg-white" /> LIVE
          </span>
        ) : (
          <span className="shrink-0">
            {matchTime(m.scheduled_at)}
            {m.venue && ` · ${m.venue}`}
          </span>
        )}
      </div>
      <div className="space-y-1">
        {sides.map((side, i) => {
          const team = side.id ? teams.get(side.id) : undefined;
          const won = done && m.winner_team_id && m.winner_team_id === side.id;
          const lost = done && m.winner_team_id && m.winner_team_id !== side.id;
          const text =
            live && live.team === side.id
              ? `${live.runs}/${live.wickets} (${oversText(live.balls)})`
              : score(side.runs, side.wickets, side.balls, settings.wickets);
          return (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className={cn("flex min-w-0 items-center gap-2 text-sm", won ? "font-bold text-slate-900" : lost ? "text-slate-500" : "font-medium text-slate-800")}>
                <TeamDot color={team?.color ?? "#cbd5e1"} className="size-2.5 shrink-0" />
                <span className={cn("truncate", !team && "italic text-slate-400")}>{team?.name ?? sourceLabel(side.src, byNo)}</span>
                {won && <Trophy className="size-3.5 shrink-0 text-amber-500" />}
              </span>
              {text && <span className={cn("shrink-0 text-sm tabular-nums", won ? "font-bold text-slate-900" : "text-slate-600")}>{text}</span>}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
        <p className={cn("min-w-0 truncate text-xs", done ? "font-medium text-emerald-700" : live ? "font-medium text-rose-700" : "text-slate-400")}>
          {done
            ? m.result_text
            : live
              ? live.target
                ? `Need ${Math.max(live.target - live.runs, 0)} from ${live.overs * 6 - live.balls} balls`
                : "1st innings in progress"
              : m.status === "live"
                ? "Toss done, starting soon"
                : ready
                  ? "Upcoming"
                  : "Teams decided by earlier results"}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {(m.status !== "scheduled" || done) && (
            <Link href={`/match/${m.id}`} className="rounded-md px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50">
              Scorecard
            </Link>
          )}
          {onScorer && ready && !done && (
            <>
              <button onClick={() => onScorer(m)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Scorer PIN link">
                <KeyRound className="size-3.5" />
              </button>
              <Link href={`/score/${m.id}`} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700">
                <Radio className="size-3.5" /> Score
              </Link>
            </>
          )}
        </div>
        {(onResult || onEdit) && (
          <div className="flex shrink-0 gap-1">
            {onEdit && (
              <button onClick={() => onEdit(m)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit date, time, venue">
                <Pencil className="size-3.5" />
              </button>
            )}
            {onResult && (
              <Button size="sm" variant={done ? "ghost" : "secondary"} disabled={!ready} onClick={() => onResult(m)}>
                {done ? "Edit result" : "Enter result"}
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

export function PointsTable({
  title,
  rows,
  teams,
  qualify,
}: {
  title?: string;
  rows: StandingRow[];
  teams: Map<string, Team>;
  qualify: number;
}) {
  return (
    <Card className="overflow-hidden">
      {title && <h3 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900">{title}</h3>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-2 py-2 text-left font-medium">Team</th>
              <th className="px-2 py-2 text-center font-medium">P</th>
              <th className="px-2 py-2 text-center font-medium">W</th>
              <th className="px-2 py-2 text-center font-medium">L</th>
              <th className="hidden px-2 py-2 text-center font-medium sm:table-cell">T</th>
              <th className="hidden px-2 py-2 text-center font-medium sm:table-cell">NR</th>
              <th className="px-2 py-2 text-center font-semibold text-slate-700">Pts</th>
              <th className="px-2 py-2 text-right font-medium">NRR</th>
              <th className="hidden px-3 py-2 text-left font-medium md:table-cell">Form</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => {
              const team = teams.get(r.team_id);
              return (
                <tr key={r.team_id} className={cn(i < qualify && "bg-emerald-50/50")}>
                  <td className={cn("px-3 py-2 tabular-nums", i < qualify ? "font-semibold text-emerald-700" : "text-slate-400")}>{i + 1}</td>
                  <td className="px-2 py-2">
                    <span className="flex items-center gap-2 font-medium text-slate-800">
                      <TeamDot color={team?.color ?? "#cbd5e1"} className="size-2.5 shrink-0" />
                      <span className="max-w-40 truncate">{team?.name ?? "Team"}</span>
                    </span>
                  </td>
                  <td className="px-2 py-2 text-center tabular-nums">{r.played}</td>
                  <td className="px-2 py-2 text-center tabular-nums">{r.won}</td>
                  <td className="px-2 py-2 text-center tabular-nums">{r.lost}</td>
                  <td className="hidden px-2 py-2 text-center tabular-nums sm:table-cell">{r.tied}</td>
                  <td className="hidden px-2 py-2 text-center tabular-nums sm:table-cell">{r.no_result}</td>
                  <td className="px-2 py-2 text-center font-bold tabular-nums text-slate-900">{r.points}</td>
                  <td className={cn("px-2 py-2 text-right tabular-nums", r.nrr > 0 ? "text-emerald-700" : r.nrr < 0 ? "text-rose-600" : "text-slate-500")}>
                    {r.nrr > 0 ? "+" : ""}
                    {r.nrr.toFixed(3)}
                  </td>
                  <td className="hidden px-3 py-2 md:table-cell">
                    <span className="flex gap-1">
                      {r.form.map((f, j) => (
                        <span
                          key={j}
                          className={cn(
                            "flex size-5 items-center justify-center rounded text-[10px] font-bold text-white",
                            f === "W" ? "bg-emerald-500" : f === "L" ? "bg-rose-500" : "bg-slate-400",
                          )}
                        >
                          {f}
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {qualify > 0 && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Top {qualify} (green) go through. Ties on points are split by wins, then net run rate.</p>}
    </Card>
  );
}

// Knockout rounds side by side, earliest on the left
export function Bracket({ matches, teams, byNo, settings }: { matches: Match[]; teams: Map<string, Team>; byNo: Map<number, Match>; settings: FixtureSettings }) {
  const rounds = useMemo(() => {
    const map = new Map<number, Match[]>();
    for (const m of matches.filter((x) => x.stage === "knockout")) map.set(m.round, [...(map.get(m.round) ?? []), m]);
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list);
  }, [matches]);
  if (!rounds.length) return <EmptyState icon={<Trophy className="size-6" />} title="No knockout stage" text="This format finishes with the points table." />;

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2">
      <div className="flex min-w-max gap-4">
        {rounds.map((list, i) => (
          <div key={i} className="flex w-64 flex-col">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{list[0]!.round_name.replace(/ \d+$/, "")}</p>
            <div className="flex flex-1 flex-col justify-around gap-3">
              {list.map((m) => (
                <MatchCard key={m.id} match={m} teams={teams} byNo={byNo} settings={settings} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type View = "matches" | "table" | "knockout" | "stats";

// Matches by day, points table(s) and bracket, with a champion banner at the end
export function FixturesView({
  matches,
  teams: teamList,
  settings: saved,
  onResult,
  onEdit,
  onScorer,
}: {
  matches: Match[];
  teams: Team[];
  settings: FixtureSettings | null;
  onResult?: (m: Match) => void;
  onEdit?: (m: Match) => void;
  onScorer?: (m: Match) => void;
}) {
  const statRows = useTournamentStats(matches[0]?.tournament_id);
  const settings = saved ?? DEFAULT_SETTINGS;
  const hasTable = matches.some((m) => m.stage !== "knockout");
  const hasKnockout = matches.some((m) => m.stage === "knockout");
  const [view, setView] = useState<View>("matches");
  const [filter, setFilter] = useState<"all" | "upcoming" | "results">("all");

  const teams = useMemo(() => new Map(teamList.map((t) => [t.id, t])), [teamList]);
  const byNo = useMemo(() => new Map(matches.map((m) => [m.match_no, m])), [matches]);
  const tables = useMemo(() => standings(matches, settings), [matches, settings]);
  const winner = champion(matches, settings);
  const done = matches.filter((m) => m.status === "completed").length;

  const shown = matches.filter((m) => (filter === "upcoming" ? m.status !== "completed" : filter === "results" ? m.status === "completed" : true));
  const days: { day: string; list: Match[] }[] = [];
  for (const m of shown) {
    const day = matchDay(m.scheduled_at);
    if (days.at(-1)?.day === day) days.at(-1)!.list.push(m);
    else days.push({ day, list: [m] });
  }

  const qualify = settings.format === "groups" ? settings.qualify : settings.format === "league" ? playoffTeams(settings.playoff) : 0;
  const views: { key: View; label: string }[] = [
    { key: "matches", label: `Matches (${done}/${matches.length})` },
    ...(hasTable ? [{ key: "table" as const, label: "Points table" }] : []),
    ...(hasKnockout ? [{ key: "knockout" as const, label: "Knockouts" }] : []),
    { key: "stats" as const, label: "Stats" },
  ];

  return (
    <div className="space-y-4">
      {winner && (
        <div className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-amber-400 to-amber-300 p-4 text-amber-950 shadow-sm">
          <Trophy className="size-8 shrink-0" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide">Champions</p>
            <p className="text-xl font-black">{teams.get(winner)?.name}</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {views.map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition", view === v.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}
            >
              {v.label}
            </button>
          ))}
        </nav>
        {view === "matches" && (
          <nav className="ml-auto flex gap-1 text-xs">
            {(["all", "upcoming", "results"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn("rounded-full px-3 py-1 font-medium capitalize", filter === f ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200")}
              >
                {f}
              </button>
            ))}
          </nav>
        )}
      </div>

      {view === "matches" &&
        (days.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No matches here</p>
        ) : (
          days.map(({ day, list }) => (
            <section key={day + list[0]!.match_no}>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                <CalendarDays className="size-4 text-slate-400" /> {day}
                {list[0]!.venue && (
                  <span className="flex items-center gap-1 font-normal text-slate-400">
                    · <MapPin className="size-3.5" /> {list[0]!.venue}
                  </span>
                )}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {list.map((m) => (
                  <MatchCard key={m.id} match={m} teams={teams} byNo={byNo} settings={settings} onResult={onResult} onEdit={onEdit} onScorer={onScorer} />
                ))}
              </div>
            </section>
          ))
        ))}

      {view === "table" && (
        <div className="space-y-4">
          {[...tables.entries()].map(([group, rows]) => (
            <PointsTable key={String(group)} title={group ? `Group ${group}` : undefined} rows={rows} teams={teams} qualify={qualify} />
          ))}
        </div>
      )}

      {view === "knockout" && <Bracket matches={matches} teams={teams} byNo={byNo} settings={settings} />}

      {view === "stats" && <StatsView rows={statRows} teams={teams} />}
    </div>
  );
}
