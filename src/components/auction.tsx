"use client";

import { Gavel, Timer } from "lucide-react";
import { useCountdown } from "@/lib/hooks";
import { rupees } from "@/lib/format";
import type { AuctionState, Bid, Player, Team } from "@/lib/types";
import { Avatar, TeamDot, cn } from "./ui";

export function Countdown({ endsAt, offset, total, dark }: { endsAt: string | null; offset: number; total: number; dark?: boolean }) {
  const left = useCountdown(endsAt, offset);
  if (left == null || total <= 0) return null;
  const secs = Math.ceil(left);
  const pct = Math.max(0, Math.min(1, left / total));
  const urgent = secs <= 5;
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-16 shrink-0" aria-label={`${secs} seconds left`}>
      <svg viewBox="0 0 64 64" className="size-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className={dark ? "stroke-white/10" : "stroke-slate-100"} />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className={cn("transition-[stroke-dashoffset] duration-300", urgent ? "stroke-rose-500" : "stroke-emerald-500")}
        />
      </svg>
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center text-lg font-bold tabular-nums",
          urgent ? "text-rose-500" : dark ? "text-white" : "text-slate-900",
        )}
      >
        {secs}
      </span>
    </div>
  );
}

export function PlayerDetails({ player, dark }: { player: Player; dark?: boolean }) {
  const chips = [player.role, player.batting_style, player.bowling_style, player.age ? `${player.age} yrs` : null, player.city].filter(Boolean);
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span key={c} className={cn("rounded-full px-2.5 py-1 text-xs font-medium", dark ? "bg-white/10 text-white/80" : "bg-slate-100 text-slate-600")}>
          {c}
        </span>
      ))}
    </div>
  );
}

// The main card: player on the block, current bid, leading team, timer and SOLD / UNSOLD stamp
export function PlayerStage({
  state,
  player,
  teams,
  offset,
  timerSeconds,
  idleText = "Waiting for the auctioneer to bring the next player",
}: {
  state: AuctionState | null;
  player: Player | null;
  teams: Team[];
  offset: number;
  timerSeconds: number;
  idleText?: string;
}) {
  if (!state || !player || state.phase === "idle") {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
        <div className="rounded-full bg-emerald-50 p-4 text-emerald-600">
          <Gavel className="size-8" />
        </div>
        <p className="mt-4 font-medium text-slate-700">{idleText}</p>
      </div>
    );
  }

  const leader = teams.find((t) => t.id === state.leading_team_id);
  const soldTeam = teams.find((t) => t.id === player.team_id);
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="h-1.5" style={{ background: leader?.color ?? "#e2e8f0" }} />
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
        <Avatar name={player.name} src={player.photo_url} size={112} className="mx-auto sm:mx-0" />
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="flex items-center justify-center gap-2 sm:justify-start">
            <h2 className="truncate text-2xl font-bold text-slate-900">{player.name}</h2>
            {player.category && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500">{player.category}</span>}
          </div>
          <div className="mt-2 flex justify-center sm:justify-start">
            <PlayerDetails player={player} />
          </div>
          <p className="mt-2 text-sm text-slate-500">Base price {rupees(player.base_price)}</p>
        </div>
        {state.phase === "bidding" && <Countdown endsAt={state.ends_at} offset={offset} total={timerSeconds} />}
      </div>

      <div className="grid grid-cols-2 border-t border-slate-100">
        <div className="p-4 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Current bid</p>
          <p key={state.current_bid} className="animate-bump mt-1 text-3xl font-extrabold tabular-nums text-slate-900">
            {state.current_bid ? rupees(state.current_bid) : "-"}
          </p>
        </div>
        <div className="border-l border-slate-100 p-4 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Highest bidder</p>
          <p className="mt-1.5 flex items-center justify-center gap-2 truncate text-lg font-semibold text-slate-900">
            {leader ? (
              <>
                <TeamDot color={leader.color} className="size-3" /> {leader.name}
              </>
            ) : (
              <span className="text-slate-400">No bids yet</span>
            )}
          </p>
        </div>
      </div>

      {state.phase === "sold" && (
        <ResultStamp text="SOLD" sub={soldTeam ? `${soldTeam.name} · ${rupees(player.sold_price)}` : undefined} color={soldTeam?.color ?? "#059669"} />
      )}
      {state.phase === "unsold" && <ResultStamp text="UNSOLD" color="#64748b" />}
    </div>
  );
}

export function ResultStamp({ text, sub, color, big }: { text: string; sub?: string; color: string; big?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-white/70 backdrop-blur-[2px]">
      <div
        className={cn("animate-stamp rounded-xl border-[6px] px-8 py-2 font-black tracking-widest", big ? "text-8xl" : "text-5xl")}
        style={{ borderColor: color, color }}
      >
        {text}
      </div>
      {sub && <p className={cn("mt-4 font-semibold text-slate-800", big ? "text-3xl" : "text-lg")}>{sub}</p>}
    </div>
  );
}

export function BidHistory({ bids, teams, dark }: { bids: Bid[]; teams: Team[]; dark?: boolean }) {
  if (bids.length === 0) return <p className={cn("py-4 text-center text-sm", dark ? "text-white/50" : "text-slate-400")}>No bids yet</p>;
  return (
    <ul className="space-y-1.5">
      {bids.map((b, i) => {
        const team = teams.find((t) => t.id === b.team_id);
        return (
          <li
            key={b.id}
            className={cn(
              "flex items-center justify-between rounded-lg px-3 py-2 text-sm",
              i === 0 ? (dark ? "bg-white/10" : "bg-emerald-50") : "",
              dark ? "text-white/90" : "text-slate-700",
            )}
          >
            <span className="flex items-center gap-2 truncate">
              <TeamDot color={team?.color ?? "#94a3b8"} /> {team?.name ?? "Team"}
            </span>
            <span className="font-semibold tabular-nums">{rupees(b.amount)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function TimerHint({ seconds }: { seconds: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
      <Timer className="size-3.5" /> {seconds > 0 ? `${seconds}s timer, resets on every bid` : "No timer"}
    </span>
  );
}
