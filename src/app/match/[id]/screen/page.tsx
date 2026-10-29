"use client";

import { useParams } from "next/navigation";
import { Maximize } from "lucide-react";
import { OverMarks, TestStatus, breakText, useScoreboard } from "@/components/scorecard";
import { Spinner, TeamDot } from "@/components/ui";
import { useMatchLive } from "@/lib/hooks";
import { ballsText, runRate } from "@/lib/scoring";

// Big screen for the ground: projector / TV. Updates ball by ball.
export default function MatchScreen() {
  const { id } = useParams<{ id: string }>();
  const live = useMatchLive(id);
  const board = useScoreboard(live.tournament, live.teams, live.players, live.events, live.match);

  if (live.loading)
    return (
      <div className="flex min-h-screen flex-1 items-center justify-center bg-slate-950">
        <Spinner />
      </div>
    );
  const m = live.match;
  if (!m) return <div className="flex min-h-screen flex-1 items-center justify-center bg-slate-950 text-white/60">Match not found</div>;

  const { state, rules, label: name, team } = board;
  const test = rules.format === "test";
  const inn = state.current;
  const batting = team(inn?.batting_team);
  const bowlingTeam = team(inn?.bowling_team);
  const chase = inn?.number === rules.innings_per_side * 2 && state.target != null;
  const ballsLeft = inn ? rules.overs * 6 - inn.legal_balls : 0;
  const need = chase && inn ? state.target! - inn.runs : 0;
  const thisOver = inn ? (inn.overs.at(-1)?.length ? inn.overs.at(-1)! : (inn.overs.at(-2) ?? [])) : [];
  const bowler = inn ? inn.bowlers.find((b) => b.id === (inn.bowler ?? inn.last_over_bowler)) : undefined;

  return (
    <div className="relative flex min-h-screen flex-1 flex-col overflow-hidden bg-slate-950 text-white">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{ background: `radial-gradient(ellipse at 20% 10%, ${batting?.color ?? "#059669"}66, transparent 60%)` }}
      />
      <header className="relative flex items-center justify-between px-8 py-5">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">
            {live.tournament?.name} · Match {m.match_no}
            {(m.stage !== "league" || test) && ` · ${m.round_name}`}
          </p>
          <h1 className="text-2xl font-bold lg:text-3xl">
            {team(m.team_a_id)?.name} v {team(m.team_b_id)?.name}
          </h1>
        </div>
        <div className="flex items-center gap-4">
          {m.status === "live" && (
            <span className="flex items-center gap-2 rounded-full bg-rose-600 px-3 py-1 text-sm font-bold">
              <span className="size-2 animate-pulse rounded-full bg-white" /> LIVE
            </span>
          )}
          <button onClick={() => document.documentElement.requestFullscreen?.()} className="rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white" title="Full screen">
            <Maximize className="size-5" />
          </button>
        </div>
      </header>

      <main className="relative flex flex-1 flex-col justify-center gap-8 px-8 pb-8">
        {m.status === "completed" ? (
          <div className="text-center">
            <p className="text-2xl font-semibold uppercase tracking-widest text-white/50">Result</p>
            <p className="mt-4 text-6xl font-black lg:text-7xl">{m.result_text}</p>
          </div>
        ) : !inn ? (
          <div className="text-center">
            <p className="text-5xl font-black">Match starting soon</p>
            {state.toss && (
              <p className="mt-4 text-2xl text-white/60">
                {team(state.toss.winner)?.name} won the toss and chose to {state.toss.decision}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                {test && (
                  <div className="mb-2 text-xl">
                    <TestStatus board={board} dark />
                  </div>
                )}
                <p className="flex items-center gap-3 text-3xl font-bold">
                  <TeamDot color={batting?.color ?? "#94a3b8"} className="size-4" /> {batting?.name}
                  {inn.free_hit && <span className="rounded-lg bg-amber-400 px-3 py-1 text-xl font-black text-amber-950">FREE HIT</span>}
                </p>
                <p className="text-[9rem] font-black leading-none tabular-nums">
                  {inn.runs}/{inn.wickets}
                </p>
                <p className="text-3xl font-semibold text-white/60 tabular-nums">
                  {ballsText(inn.legal_balls)}
                  {rules.overs ? ` / ${rules.overs}` : ""} overs · CRR {runRate(inn.runs, inn.legal_balls).toFixed(2)}
                </p>
              </div>
              {chase && !inn.complete && (
                <div className="rounded-3xl bg-white/10 px-8 py-6 text-right ring-1 ring-white/15">
                  <p className="text-xl uppercase tracking-widest text-white/50">Target {state.target}</p>
                  <p className="text-5xl font-black">
                    Need {Math.max(need, 0)} {!test && <span className="text-3xl font-semibold text-white/60">from {ballsLeft}</span>}
                  </p>
                  {!test && <p className="text-xl text-white/60">Required RR {runRate(need, ballsLeft).toFixed(2)}</p>}
                </div>
              )}
            </div>

            {!inn.complete && (
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-3xl bg-white/5 p-6 ring-1 ring-white/10">
                  <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-white/50">Batting</p>
                  {[inn.striker, inn.non_striker].map((pid, i) => {
                    const b = inn.batters.find((x) => x.id === pid);
                    return (
                      <p key={i} className="flex justify-between text-3xl">
                        <span className={i === 0 ? "font-bold" : "text-white/80"}>
                          {pid ? name(pid) : "-"}
                          {i === 0 && pid ? " *" : ""}
                        </span>
                        <span className="tabular-nums">
                          {b ? b.runs : ""} <span className="text-xl text-white/50">{b ? `(${b.balls})` : ""}</span>
                        </span>
                      </p>
                    );
                  })}
                  <p className="mt-3 text-lg text-white/50">
                    Partnership {inn.partnership.runs} ({inn.partnership.balls})
                  </p>
                </div>
                <div className="rounded-3xl bg-white/5 p-6 ring-1 ring-white/10">
                  <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-white/50">Bowling · {bowlingTeam?.name}</p>
                  <p className="flex justify-between text-3xl">
                    <span className="font-bold">{bowler ? name(bowler.id) : "-"}</span>
                    <span className="tabular-nums">{bowler ? `${bowler.wickets}-${bowler.runs}` : ""}</span>
                  </p>
                  <p className="mb-4 text-xl text-white/50">{bowler ? `${ballsText(bowler.balls)} overs` : ""}</p>
                  <OverMarks marks={thisOver} dark size="lg" />
                </div>
              </div>
            )}
            {inn.complete && state.next === "innings_break" && (
              <p className="text-center text-4xl font-bold">
                Innings break · {breakText(board)}
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
