"use client";

import { useState } from "react";
import type { CommentaryLine } from "@/lib/scoring";
import type { Scoreboard } from "./scorecard";
import { Card, cn } from "./ui";

const CHIP: Record<CommentaryLine["kind"], string> = {
  wicket: "bg-rose-600 text-white",
  four: "bg-sky-600 text-white",
  six: "bg-violet-600 text-white",
  extra: "bg-amber-400 text-amber-950",
  run: "bg-slate-200 text-slate-800",
  dot: "bg-slate-100 text-slate-500",
  over: "",
};

// Ball-by-ball text commentary, newest first, with a tab per innings
export function Commentary({ board, initial = 18 }: { board: Scoreboard; initial?: number }) {
  const { state, team } = board;
  const [tab, setTab] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  if (!state.innings.some((i) => i.commentary.length)) return null;
  const shown = tab ?? state.innings.length - 1;
  const inn = state.innings[shown]!;
  const lines = [...inn.commentary].reverse();
  const visible = all ? lines : lines.slice(0, initial);
  const side = team(inn.batting_team);
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <h2 className="font-semibold text-slate-900">Commentary</h2>
        {state.innings.length > 1 && (
          <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 text-xs">
            {state.innings.map((x, i) => (
              <button
                key={i}
                onClick={() => setTab(i)}
                className={cn("rounded-md px-2.5 py-1 font-medium", shown === i ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}
              >
                {team(x.batting_team)?.short_name || team(x.batting_team)?.name}
                {board.rules.format === "test" ? ` (${i + 1})` : ""}
              </button>
            ))}
          </div>
        )}
      </div>
      {visible.length ? (
        <ol className="divide-y divide-slate-100 text-sm">
          {visible.map((l, i) =>
            l.kind === "over" ? (
              <li key={i} className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
                <span>{l.text}</span>
                <span className="tabular-nums text-slate-900">
                  {side?.short_name || side?.name} {l.score}
                </span>
              </li>
            ) : (
              <li key={i} className="flex gap-3 px-4 py-2.5">
                <span className="w-8 shrink-0 pt-0.5 text-xs tabular-nums text-slate-400">{l.ball}</span>
                <span className={cn("flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-bold", CHIP[l.kind])}>
                  {l.kind === "wicket" ? "W" : l.kind === "four" ? "4" : l.kind === "six" ? "6" : l.kind === "dot" ? "•" : l.kind === "extra" ? "+" : l.text.match(/(\d) run/)?.[1] ?? ""}
                </span>
                <span className={cn("min-w-0 text-slate-700", (l.kind === "wicket" || l.kind === "four" || l.kind === "six") && "font-semibold text-slate-900")}>
                  {l.text}
                </span>
              </li>
            ),
          )}
        </ol>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-slate-400">No balls bowled yet in this innings.</p>
      )}
      {!all && lines.length > initial && (
        <button onClick={() => setAll(true)} className="w-full border-t border-slate-100 py-2.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50">
          Show all {lines.length} lines
        </button>
      )}
    </Card>
  );
}
