"use client";

import { useMemo, useState } from "react";
import type { Match } from "@/lib/fixtures";
import type { MatchPlayer } from "@/lib/hooks";
import {
  BREAKS,
  ballsText,
  leadOf,
  matchRules,
  replay,
  runRate,
  type BallMark,
  type InningsState,
  type Lineups,
  type MatchEvent,
  type MatchState,
  type ScoringRules,
} from "@/lib/scoring";
import type { Team, Tournament } from "@/lib/types";
import { Card, TeamDot, cn } from "./ui";

export type Scoreboard = {
  state: MatchState;
  rules: ScoringRules;
  lineups: Lineups;
  name: (id: string | null | undefined) => string;
  label: (id: string | null | undefined) => string; // name with (c) for the captain and † for the keeper
  team: (id: string | null | undefined) => Team | undefined;
};

// Everything a screen needs from the raw rows: rules, playing XIs and the replayed state
export function useScoreboard(
  tournament: Tournament | null,
  teams: Team[],
  players: MatchPlayer[],
  events: MatchEvent[],
  match?: Pick<Match, "match_type" | "days"> | null,
): Scoreboard {
  const matchType = match?.match_type;
  const days = match?.days;
  return useMemo(() => {
    const rules = matchRules(tournament?.fixture_settings, { match_type: matchType, days });
    const lineups: Lineups = {};
    for (const p of players) (lineups[p.team_id] ??= []).push(p.id);
    const byId = new Map(players.map((p) => [p.id, p]));
    const name = (id: string | null | undefined) => (id ? (byId.get(id)?.name ?? "Player") : "");
    const label = (id: string | null | undefined) => {
      const p = id ? byId.get(id) : undefined;
      if (!p) return name(id);
      return `${p.name}${p.is_captain ? " (c)" : ""}${p.is_keeper ? " †" : ""}`;
    };
    const teamMap = new Map(teams.map((t) => [t.id, t]));
    const team = (id: string | null | undefined) => (id ? teamMap.get(id) : undefined);
    const state = replay(events, rules, lineups, name);
    return { state, rules, lineups, name, label, team };
  }, [tournament, teams, players, events, matchType, days]);
}

const ORDINAL = ["1st", "2nd", "3rd", "4th"];

// Between innings: the target (limited overs), or who leads and by how much (Tests)
export function breakText(board: Scoreboard) {
  const { state, team } = board;
  const done = state.current;
  if (!done) return "";
  if (board.rules.format !== "test") return `${team(done.bowling_team)?.name} need ${state.target} to win`;
  const lead = leadOf(state);
  const side = team(done.batting_team)?.name;
  return lead > 0 ? `${side} lead by ${lead}` : lead < 0 ? `${side} trail by ${-lead}` : "Scores level";
}

// Tests: "Day 2 · Lunch", "Stumps, Day 1", lead / trail
export function TestStatus({ board, dark }: { board: Scoreboard; dark?: boolean }) {
  const { state, team } = board;
  const inn = state.current;
  if (board.rules.format !== "test" || !inn) return null;
  const lead = leadOf(state);
  const side = team(inn.batting_team)?.short_name || team(inn.batting_team)?.name;
  const pause = state.stumps ? `Stumps · Day ${state.day - 1}` : state.on_break ? BREAKS.find((b) => b.key === state.on_break)?.label : null;
  const leadText =
    inn.number === 1 ? null : state.target != null ? null : lead > 0 ? `${side} lead by ${lead}` : lead < 0 ? `${side} trail by ${-lead}` : "Scores level";
  const oversLeft = board.rules.overs_per_day ? Math.max(board.rules.overs_per_day - Math.floor(state.day_balls / 6), 0) : null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-xs font-semibold", dark ? "text-white/80" : "text-slate-600")}>
      <span className={cn("rounded px-2 py-0.5", dark ? "bg-white/10" : "bg-slate-100")}>
        Day {state.stumps ? state.day - 1 : state.day} of {board.rules.days}
      </span>
      <span>{ORDINAL[inn.number - 1]} innings</span>
      {inn.follow_on && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">Follow-on</span>}
      {leadText && <span>· {leadText}</span>}
      {pause && <span className="rounded bg-sky-600 px-2 py-0.5 text-white">{pause}</span>}
      {!pause && oversLeft != null && !state.stumps && <span className={dark ? "text-white/50" : "text-slate-400"}>· {oversLeft} overs left today</span>}
    </div>
  );
}

export function OverMarks({ marks, dark, size = "md" }: { marks: BallMark[]; dark?: boolean; size?: "md" | "lg" }) {
  return (
    <span className="flex flex-wrap gap-1">
      {marks.map((b, i) => (
        <span
          key={i}
          className={cn(
            "flex items-center justify-center rounded-full font-bold tabular-nums",
            size === "lg" ? "h-11 min-w-11 px-2 text-lg" : "h-7 min-w-7 px-1.5 text-xs",
            b.kind === "wicket" && "bg-rose-600 text-white",
            b.kind === "four" && "bg-sky-600 text-white",
            b.kind === "six" && "bg-violet-600 text-white",
            b.kind === "extra" && "bg-amber-400 text-amber-950",
            b.kind === "run" && (dark ? "bg-white/15 text-white" : "bg-slate-200 text-slate-800"),
            b.kind === "dot" && (dark ? "bg-white/10 text-white/60" : "bg-slate-100 text-slate-400"),
          )}
        >
          {b.label}
        </span>
      ))}
    </span>
  );
}

// Big score line plus batters at the crease and the current bowler
export function LiveSummary({ board, dark }: { board: Scoreboard; dark?: boolean }) {
  const { state, rules, label: name, team, lineups } = board;
  const inn = state.current;
  if (!inn) return null;
  const batting = team(inn.batting_team);
  const test = rules.format === "test";
  const chase = inn.number === rules.innings_per_side * 2 && state.target != null;
  const ballsLeft = rules.overs * 6 - inn.legal_balls;
  const wicketsLeft = Math.max(Math.min(rules.wickets, (lineups[inn.batting_team]?.length ?? 11) - 1) - inn.wickets, 0);
  const need = chase ? state.target! - inn.runs : 0;
  const line = (id: string | null) => inn.batters.find((b) => b.id === id);
  const bowler = inn.bowler ? inn.bowlers.find((b) => b.id === inn.bowler) : inn.bowlers.find((b) => b.id === inn.last_over_bowler);
  const thisOver = inn.overs.at(-1)?.length ? inn.overs.at(-1)! : (inn.overs.at(-2) ?? []);
  const muted = dark ? "text-white/60" : "text-slate-500";

  return (
    <div className="space-y-3">
      <TestStatus board={board} dark={dark} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={cn("flex items-center gap-2 text-sm font-semibold", dark ? "text-white/80" : "text-slate-700")}>
            <TeamDot color={batting?.color ?? "#94a3b8"} /> {batting?.name}
            {inn.free_hit && <span className="rounded bg-amber-400 px-1.5 py-0.5 text-[11px] font-bold text-amber-950">FREE HIT</span>}
          </p>
          <p className="text-4xl font-black tabular-nums">
            {inn.runs}/{inn.wickets}
            <span className={cn("ml-2 text-lg font-semibold", muted)}>
              ({ballsText(inn.legal_balls)}
              {rules.overs ? `/${rules.overs}` : " ov"})
            </span>
          </p>
        </div>
        <div className={cn("text-right text-sm tabular-nums", muted)}>
          <p>CRR {runRate(inn.runs, inn.legal_balls).toFixed(2)}</p>
          {chase && !test && !inn.complete && ballsLeft > 0 && <p>Need RR {runRate(need, ballsLeft).toFixed(2)}</p>}
          {inn.partnership.balls > 0 && (
            <p>
              Partnership {inn.partnership.runs} ({inn.partnership.balls})
            </p>
          )}
        </div>
      </div>
      {chase && !inn.complete && (
        <p className={cn("rounded-lg px-3 py-2 text-sm font-semibold", dark ? "bg-white/10" : "bg-emerald-50 text-emerald-800")}>
          {need <= 0
            ? "Scores level"
            : test
              ? `Need ${need} run${need === 1 ? "" : "s"} · ${wicketsLeft} wicket${wicketsLeft === 1 ? "" : "s"} left`
              : `Need ${need} run${need === 1 ? "" : "s"} from ${ballsLeft} ball${ballsLeft === 1 ? "" : "s"}`}{" "}
          · Target {state.target}
        </p>
      )}
      {!inn.complete && (
        <div className={cn("grid gap-2 text-sm sm:grid-cols-2", dark ? "text-white" : "text-slate-800")}>
          <div className="space-y-1">
            {[inn.striker, inn.non_striker].map((id, i) => {
              const b = line(id);
              return (
                <p key={i} className="flex justify-between gap-2">
                  <span className={cn("truncate", i === 0 && "font-semibold")}>
                    {id ? name(id) : "-"}
                    {i === 0 && id && " *"}
                  </span>
                  <span className="tabular-nums">{b ? `${b.runs} (${b.balls})` : ""}</span>
                </p>
              );
            })}
          </div>
          <div className="space-y-1">
            <p className="flex justify-between gap-2">
              <span className="truncate font-semibold">{bowler ? name(bowler.id) : "-"}</span>
              <span className="tabular-nums">{bowler ? `${ballsText(bowler.balls)}-${bowler.maidens}-${bowler.runs}-${bowler.wickets}` : ""}</span>
            </p>
            <OverMarks marks={thisOver} dark={dark} />
          </div>
        </div>
      )}
    </div>
  );
}

function InningsCard({ inn, board, xi }: { inn: InningsState; board: Scoreboard; xi: string[] }) {
  const { label: name, team } = board;
  const test = board.rules.format === "test";
  const batted = new Set(inn.batters.map((b) => b.id));
  const yetToBat = xi.filter((id) => !batted.has(id));
  const extras = inn.extras.wd + inn.extras.nb + inn.extras.b + inn.extras.lb;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Batter</th>
              <th className="px-2 py-2 text-right font-semibold text-slate-700">R</th>
              <th className="px-2 py-2 text-right font-medium">B</th>
              <th className="px-2 py-2 text-right font-medium">4s</th>
              <th className="px-2 py-2 text-right font-medium">6s</th>
              <th className="px-3 py-2 text-right font-medium">SR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {inn.batters.map((b) => {
              const atCrease = b.id === inn.striker || b.id === inn.non_striker;
              return (
                <tr key={b.id}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-slate-900">
                      {name(b.id)}
                      {b.id === inn.striker && " *"}
                    </p>
                    <p className="text-xs text-slate-500">{b.how ?? (atCrease ? "batting" : "not out")}</p>
                  </td>
                  <td className="px-2 py-2 text-right font-bold tabular-nums text-slate-900">{b.runs}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-600">{b.balls}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-600">{b.fours}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-600">{b.sixes}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{b.balls ? ((b.runs * 100) / b.balls).toFixed(1) : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="space-y-1 px-3 text-sm text-slate-600">
        <p>
          <span className="font-medium text-slate-800">Extras {extras}</span> (wd {inn.extras.wd}, nb {inn.extras.nb}, b {inn.extras.b}, lb {inn.extras.lb})
        </p>
        <p className="font-semibold text-slate-900">
          Total {inn.runs}/{inn.wickets}
          {inn.end_reason === "declared" && test ? " declared" : ""} ({ballsText(inn.legal_balls)} ov) · RR {runRate(inn.runs, inn.legal_balls).toFixed(2)}
          {inn.follow_on && " · following on"}
        </p>
        {yetToBat.length > 0 && (
          <p>
            <span className="font-medium text-slate-800">Yet to bat:</span> {yetToBat.map(name).join(", ")}
          </p>
        )}
        {inn.fow.length > 0 && (
          <p>
            <span className="font-medium text-slate-800">Fall of wickets:</span>{" "}
            {inn.fow.map((f) => `${f.runs}-${f.wicket} (${name(f.player)}, ${ballsText(f.balls)})`).join(", ")}
          </p>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">
                Bowler <span className="font-normal">({team(inn.bowling_team)?.short_name || team(inn.bowling_team)?.name})</span>
              </th>
              <th className="px-2 py-2 text-right font-medium">O</th>
              <th className="px-2 py-2 text-right font-medium">M</th>
              <th className="px-2 py-2 text-right font-medium">R</th>
              <th className="px-2 py-2 text-right font-semibold text-slate-700">W</th>
              <th className="px-2 py-2 text-right font-medium">Econ</th>
              <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Wd/Nb</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {inn.bowlers.map((b) => (
              <tr key={b.id}>
                <td className="px-3 py-2 font-medium text-slate-900">{name(b.id)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-slate-600">{ballsText(b.balls)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-slate-600">{b.maidens}</td>
                <td className="px-2 py-2 text-right tabular-nums text-slate-600">{b.runs}</td>
                <td className="px-2 py-2 text-right font-bold tabular-nums text-slate-900">{b.wickets}</td>
                <td className="px-2 py-2 text-right tabular-nums text-slate-600">{runRate(b.runs, b.balls).toFixed(2)}</td>
                <td className="hidden px-3 py-2 text-right tabular-nums text-slate-600 sm:table-cell">
                  {b.wides}/{b.noballs}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Overs</p>
        <div className="space-y-1.5">
          {inn.overs.map((o, i) =>
            o.length ? (
              <div key={i} className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-xs tabular-nums text-slate-400">Ov {i + 1}</span>
                <OverMarks marks={o} />
              </div>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}

// Full scorecard with a tab per innings
export function FullScorecard({ board }: { board: Scoreboard }) {
  const { state, team, lineups } = board;
  const [tab, setTab] = useState<number | null>(null);
  const shown = tab ?? Math.max(0, state.innings.length - 1);
  if (!state.innings.length) return <p className="py-6 text-center text-sm text-slate-400">The scorecard appears once the first ball is bowled.</p>;
  const inn = state.innings[shown]!;
  return (
    <Card className="overflow-hidden">
      <div className="flex border-b border-slate-100">
        {state.innings.map((x, i) => {
          const t = team(x.batting_team);
          return (
            <button
              key={i}
              onClick={() => setTab(i)}
              className={cn("flex-1 px-3 py-3 text-sm font-medium", shown === i ? "border-b-2 border-emerald-600 text-emerald-700" : "text-slate-500")}
            >
              {t?.short_name || t?.name} {x.runs}/{x.wickets}
              {x.end_reason === "declared" && board.rules.format === "test" ? "d" : ""}
              {board.rules.format === "test" && <span className="block text-[11px] font-normal text-slate-400">{ORDINAL[i]} inns</span>}
            </button>
          );
        })}
      </div>
      <div className="py-3">
        <InningsCard inn={inn} board={board} xi={lineups[inn.batting_team] ?? []} />
      </div>
    </Card>
  );
}
