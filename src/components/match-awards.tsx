"use client";

import { Award } from "lucide-react";
import { performanceText, rankMatch } from "@/lib/mvp";
import { matchStats } from "@/lib/scoring";
import type { Scoreboard } from "./scorecard";
import { Card, TeamDot } from "./ui";

// Player of the Match from the points formula in lib/mvp.ts, plus the next best performers
export function PlayerOfTheMatch({ board, winner }: { board: Scoreboard; winner: string | null }) {
  const ranked = rankMatch(matchStats(board.state, board.lineups), (l) => l.match_player_id, winner);
  const [best, ...rest] = ranked;
  if (!best) return null;
  const team = board.team(best.team_id);
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-4 bg-linear-to-r from-amber-400 to-yellow-300 p-4 text-amber-950">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-white/60">
          <Award className="size-6" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-900/80">Player of the Match</p>
          <p className="truncate text-xl font-black">{board.name(best.id)}</p>
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <TeamDot color={team?.color ?? "#94a3b8"} className="size-2.5" /> {team?.name} · {performanceText(best)}
          </p>
        </div>
        <p className="ml-auto text-right">
          <span className="block text-2xl font-black tabular-nums">{best.points}</span>
          <span className="text-xs font-semibold">pts</span>
        </p>
      </div>
      {rest.length > 0 && (
        <ul className="divide-y divide-slate-100 text-sm">
          {rest.slice(0, 3).map((p, i) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-2">
              <span className="w-4 text-xs font-bold text-slate-400">{i + 2}</span>
              <TeamDot color={board.team(p.team_id)?.color ?? "#cbd5e1"} className="size-2.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{board.name(p.id)}</span>
              <span className="hidden text-slate-500 sm:inline">{performanceText(p)}</span>
              <span className="w-12 text-right font-semibold tabular-nums text-slate-700">{p.points}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
        Points: 1 per run, +1 per four, +2 per six, 20 per wicket, 10 per maiden, 8 per catch, 10 per stumping or run out, plus milestone bonuses.
      </p>
    </Card>
  );
}
