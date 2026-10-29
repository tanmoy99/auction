"use client";

import { useParams } from "next/navigation";
import { MonitorPlay, Trophy } from "lucide-react";
import { Logo } from "@/components/app-header";
import { matchDay, matchTime } from "@/components/fixtures";
import { FullScorecard, LiveSummary, breakText, useScoreboard } from "@/components/scorecard";
import { Button, Card, EmptyState, PageLoader, TeamDot } from "@/components/ui";
import { useMatchLive } from "@/lib/hooks";

// Public live scorecard, ball by ball. Share this link on WhatsApp.
export default function MatchPage() {
  const { id } = useParams<{ id: string }>();
  const live = useMatchLive(id);
  const board = useScoreboard(live.tournament, live.teams, live.players, live.events, live.match);

  if (live.loading) return <PageLoader />;
  if (!live.match || !live.tournament) return <EmptyState icon={<Trophy className="size-6" />} title="Match not found" />;
  const m = live.match;
  const a = board.team(m.team_a_id);
  const b = board.team(m.team_b_id);
  const { state } = board;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <Logo />
        <div className="flex gap-2">
          <a href={`/match/${m.id}/screen`} target="_blank">
            <Button variant="secondary" size="sm" title="Big screen">
              <MonitorPlay className="size-4" />
            </Button>
          </a>
          <a href={`/fixtures/${m.tournament_id}`}>
            <Button variant="secondary" size="sm">
              Fixtures
            </Button>
          </a>
        </div>
      </div>

      <div>
        <p className="text-sm text-slate-500">
          {live.tournament.name} · Match {m.match_no}
          {(m.stage !== "league" || m.match_type === "test") && ` · ${m.round_name}`}
          {m.match_type === "test" && ` · ${m.days}-day Test`}
        </p>
        <h1 className="mt-1 flex flex-wrap items-center gap-x-2 text-2xl font-bold text-slate-900">
          <span className="flex items-center gap-2">
            <TeamDot color={a?.color ?? "#cbd5e1"} /> {a?.name ?? "TBD"}
          </span>
          <span className="text-slate-400">v</span>
          <span className="flex items-center gap-2">
            <TeamDot color={b?.color ?? "#cbd5e1"} /> {b?.name ?? "TBD"}
          </span>
        </h1>
        <p className="text-sm text-slate-500">
          {matchDay(m.scheduled_at)} {matchTime(m.scheduled_at) && `· ${matchTime(m.scheduled_at)}`}
          {m.venue && ` · ${m.venue}`}
        </p>
      </div>

      {m.status === "live" && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-3 py-1 text-xs font-bold text-white">
          <span className="size-1.5 animate-pulse rounded-full bg-white" /> LIVE
        </span>
      )}

      {m.status === "completed" && m.result_text && (
        <div className="flex items-center gap-3 rounded-xl bg-emerald-50 p-4 text-emerald-900 ring-1 ring-emerald-200">
          <Trophy className="size-6 shrink-0" />
          <p className="font-semibold">{m.result_text}</p>
        </div>
      )}

      {state.toss && (
        <p className="text-sm text-slate-600">
          {board.team(state.toss.winner)?.name} won the toss and chose to {state.toss.decision}
        </p>
      )}

      {state.current && !state.current.complete && (
        <Card className="p-4">
          <LiveSummary board={board} />
        </Card>
      )}
      {state.next === "innings_break" && (
        <Card className="p-4 text-center text-sm font-medium text-slate-700">
          Innings break · {breakText(board)}
        </Card>
      )}

      {state.innings.length > 0 ? (
        <FullScorecard board={board} />
      ) : m.status === "completed" ? null : (
        <EmptyState icon={<Trophy className="size-6" />} title="Not started yet" text="The live score will appear here ball by ball once the match starts." />
      )}
    </main>
  );
}
