"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { OverMarks, breakText, useScoreboard } from "@/components/scorecard";
import { useMatchLive } from "@/lib/hooks";
import { ballsText, runRate } from "@/lib/scoring";
import { APP_NAME } from "@/lib/config";

// Score banner for live streams: add this page as a "Browser source" in OBS / Streamlabs (1920×1080).
// The background is transparent, so only the banner sits on top of the video. ?position=top moves it up.
export default function StreamOverlay() {
  const { id } = useParams<{ id: string }>();
  const top = useSearchParams().get("position") === "top";
  const live = useMatchLive(id);
  const board = useScoreboard(live.tournament, live.teams, live.players, live.events, live.match);
  const [flash, setFlash] = useState<{ key: string; text: string; color: string } | null>(null);

  useEffect(() => {
    const html = document.documentElement;
    const before = [html.style.background, document.body.style.background];
    html.style.background = document.body.style.background = "transparent";
    return () => {
      [html.style.background, document.body.style.background] = before;
    };
  }, []);

  // FOUR / SIX / WICKET pop-up for a few seconds after the ball
  const last = board.state.current?.commentary.findLast((l) => l.kind !== "over");
  const lastKey = last && `${board.state.innings.length}:${last.ball}:${board.state.current?.commentary.length}`;
  useEffect(() => {
    if (!last || !lastKey || !["four", "six", "wicket"].includes(last.kind)) return;
    const show = setTimeout(
      () =>
        setFlash({
          key: lastKey,
          text: last.kind === "four" ? "FOUR!" : last.kind === "six" ? "SIX!" : "WICKET!",
          color: last.kind === "four" ? "#0284c7" : last.kind === "six" ? "#7c3aed" : "#e11d48",
        }),
      0,
    );
    const hide = setTimeout(() => setFlash((f) => (f?.key === lastKey ? null : f)), 4500);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
    // only when a new delivery arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastKey]);

  const m = live.match;
  if (live.loading || !m) return null;
  const { state, rules, label: name, team } = board;
  const inn = state.current;
  const batting = team(inn?.batting_team);
  const bowling = team(inn?.bowling_team);
  const short = (t: ReturnType<typeof team>) => t?.short_name || t?.name?.slice(0, 4).toUpperCase() || "TBD";
  const chase = inn && inn.number === rules.innings_per_side * 2 && state.target != null && rules.format !== "test";
  const ballsLeft = inn ? rules.overs * 6 - inn.legal_balls : 0;
  const need = chase && inn ? state.target! - inn.runs : 0;
  const bat = (pid: string | null) => inn?.batters.find((b) => b.id === pid);
  const bowler = inn?.bowlers.find((b) => b.id === (inn.bowler ?? inn.last_over_bowler));
  const thisOver = inn ? (inn.overs.at(-1)?.length ? inn.overs.at(-1)! : (inn.overs.at(-2) ?? [])) : [];

  let status: string;
  if (m.status === "completed") status = m.result_text ?? "Match finished";
  else if (!inn) status = state.toss ? `${team(state.toss.winner)?.name} won the toss and chose to ${state.toss.decision}` : "Match starting soon";
  else if (state.next === "innings_break") status = `Innings break · ${breakText(board)}`;
  else if (chase) status = need <= 0 ? "Scores level" : `Need ${need} from ${ballsLeft} ball${ballsLeft === 1 ? "" : "s"}`;
  else status = `CRR ${runRate(inn.runs, inn.legal_balls).toFixed(2)}`;

  return (
    <div className={`pointer-events-none fixed inset-x-0 flex flex-col items-center gap-3 px-6 font-sans ${top ? "top-6" : "bottom-8"}`}>
      {flash && (
        <div
          key={flash.key}
          className="animate-stamp rounded-2xl px-10 py-3 text-5xl font-black tracking-wider text-white shadow-2xl"
          style={{ background: flash.color, order: top ? 2 : 0 }}
        >
          {flash.text}
        </div>
      )}
      <div className="flex w-full max-w-[1500px] items-stretch overflow-hidden rounded-2xl bg-slate-950/90 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur">
        <div className="flex items-center gap-3 px-5 py-3" style={{ background: batting?.color ?? "#059669" }}>
          <span className="text-2xl font-black tracking-wide">{short(batting ?? team(m.team_a_id))}</span>
          <span className="text-sm font-semibold opacity-80">v {short(bowling ?? team(m.team_b_id))}</span>
        </div>
        <div className="flex items-center gap-3 border-r border-white/10 px-5 py-3">
          <span className="text-4xl font-black tabular-nums">{inn ? `${inn.runs}-${inn.wickets}` : "0-0"}</span>
          <span className="text-lg tabular-nums text-white/70">
            {inn ? ballsText(inn.legal_balls) : "0"}
            {rules.overs ? ` / ${rules.overs}` : " ov"}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 border-r border-white/10 px-5 py-2 text-lg">
          {inn && !inn.complete ? (
            [inn.striker, inn.non_striker].map((pid, i) => (
              <p key={i} className="flex justify-between gap-4">
                <span className={`truncate ${i === 0 ? "font-bold" : "text-white/80"}`}>
                  {pid ? name(pid) : "-"}
                  {i === 0 && pid && <span className="text-emerald-400"> ●</span>}
                </span>
                <span className="tabular-nums">{bat(pid) ? `${bat(pid)!.runs} (${bat(pid)!.balls})` : ""}</span>
              </p>
            ))
          ) : (
            <p className="truncate text-white/80">{status}</p>
          )}
        </div>
        {inn && !inn.complete && bowler && (
          <div className="flex flex-col justify-center gap-1 border-r border-white/10 px-5 py-2">
            <p className="flex justify-between gap-4 text-lg">
              <span className="max-w-56 truncate font-semibold">{name(bowler.id)}</span>
              <span className="tabular-nums">
                {bowler.wickets}-{bowler.runs} ({ballsText(bowler.balls)})
              </span>
            </p>
            <OverMarks marks={thisOver} dark />
          </div>
        )}
        <div className="flex w-64 shrink-0 flex-col justify-center bg-white/5 px-5 py-2 text-right">
          <p className="text-base font-bold leading-tight">{inn && !inn.complete ? status : m.status === "live" ? "LIVE" : ""}</p>
          <p className="truncate text-xs text-white/50">
            {live.tournament?.name} · {APP_NAME}
          </p>
        </div>
      </div>
    </div>
  );
}
