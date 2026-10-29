"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { rupees } from "@/lib/format";
import type { AuctionState, Player, Team } from "@/lib/types";
import { Avatar, Input, RoleBadges, TeamDot, cn } from "./ui";

type Filter = "remaining" | "sold" | "unsold" | "all";

// The player that comes on stage after the current one, if it can still be auctioned
export function upNext(players: Player[], state: AuctionState | null) {
  const p = players.find((x) => x.id === state?.next_player_id);
  return p && (p.status === "available" || p.status === "unsold") && p.id !== state?.player_id ? p : null;
}

// One-line "Up next" strip for under the stage
export function UpNext({ players, state, dark }: { players: Player[]; state: AuctionState | null; dark?: boolean }) {
  const next = upNext(players, state);
  const left = players.filter((p) => p.status === "available" && p.id !== state?.player_id).length;
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2.5",
        dark ? "bg-white/5 ring-1 ring-white/10" : "border border-slate-200 bg-white",
      )}
    >
      <span className={cn("text-xs font-semibold uppercase tracking-wide", dark ? "text-white/50" : "text-slate-500")}>Up next</span>
      {next ? (
        <>
          <Avatar name={next.name} src={next.photo_url} size={32} />
          <div className="min-w-0 flex-1">
            <p className={cn("truncate text-sm font-semibold", dark ? "text-white" : "text-slate-900")}>{next.name}</p>
            <p className={cn("truncate text-xs", dark ? "text-white/50" : "text-slate-500")}>
              {[next.role, next.city].filter(Boolean).join(" · ") || "Player"} · base {rupees(next.base_price)}
            </p>
          </div>
        </>
      ) : (
        <p className={cn("flex-1 text-sm", dark ? "text-white/60" : "text-slate-500")}>{left ? "Random pick from the pool" : "No players left"}</p>
      )}
      <span className={cn("shrink-0 text-xs", dark ? "text-white/40" : "text-slate-400")}>{left} left</span>
    </div>
  );
}

// Every approved player with where they stand in the auction
export function PlayerBoard({ players, teams, state, myTeamId }: { players: Player[]; teams: Team[]; state: AuctionState | null; myTeamId?: string }) {
  const [filter, setFilter] = useState<Filter>("remaining");
  const [query, setQuery] = useState("");
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  const pool = players.filter((p) => p.status !== "pending");
  const onStage = state && state.phase !== "idle" ? state.player_id : null;
  const nextId = upNext(players, state)?.id;
  const remaining = pool.filter((p) => p.status === "available");
  const sold = pool.filter((p) => p.status === "sold");
  const unsold = pool.filter((p) => p.status === "unsold");

  const lists: Record<Filter, Player[]> = { remaining, sold, unsold, all: pool };
  const rank = (p: Player) => (p.id === onStage ? 0 : p.id === nextId ? 1 : 2);
  const q = query.trim().toLowerCase();
  const rows = lists[filter]
    .filter((p) => !q || [p.name, p.role, p.city, p.category].some((v) => v?.toLowerCase().includes(q)))
    .sort((a, b) => rank(a) - rank(b) || (filter === "sold" ? (b.sold_price ?? 0) - (a.sold_price ?? 0) : a.name.localeCompare(b.name)));

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: "remaining", label: "Remaining", count: remaining.length },
    { key: "sold", label: "Sold", count: sold.length },
    { key: "unsold", label: "Unsold", count: unsold.length },
    { key: "all", label: "All", count: pool.length },
  ];

  return (
    <div>
      <div className="space-y-2 p-2">
        <div className="grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1">
          {tabs.map((x) => (
            <button
              key={x.key}
              onClick={() => setFilter(x.key)}
              className={cn(
                "rounded-md px-1 py-1.5 text-xs font-medium transition",
                filter === x.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
              )}
            >
              {x.label}
              <span className="block text-sm font-bold tabular-nums">{x.count}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search player, role or town" className="h-9 pl-9" />
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">No players here</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((p) => {
            const team = p.team_id ? teamById.get(p.team_id) : undefined;
            const mine = !!myTeamId && p.team_id === myTeamId;
            return (
              <li key={p.id} className={cn("flex items-center gap-3 px-3 py-2", mine && "bg-emerald-50/60")}>
                <Avatar name={p.name} src={p.photo_url} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-900">
                    <span className="truncate">{p.name}</span>
                    {p.status === "sold" && <RoleBadges player={p} />}
                    {p.category && <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">{p.category}</span>}
                  </p>
                  <p className="truncate text-xs text-slate-500">{[p.role, p.city].filter(Boolean).join(" · ") || "Player"}</p>
                </div>
                <PlayerStatus player={p} team={team} mine={mine} onStage={p.id === onStage} next={p.id === nextId} state={state} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PlayerStatus({
  player,
  team,
  mine,
  onStage,
  next,
  state,
}: {
  player: Player;
  team?: Team;
  mine: boolean;
  onStage: boolean;
  next: boolean;
  state: AuctionState | null;
}) {
  if (onStage && state?.phase === "bidding")
    return (
      <span className="flex shrink-0 flex-col items-end">
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white">
          <span className="size-1.5 animate-pulse rounded-full bg-white" /> On stage
        </span>
        <span className="mt-0.5 text-xs font-semibold tabular-nums text-slate-700">
          {state.current_bid ? rupees(state.current_bid) : `Base ${rupees(player.base_price)}`}
        </span>
      </span>
    );
  if (player.status === "sold")
    return (
      <span className="flex shrink-0 flex-col items-end">
        <span className="text-sm font-semibold tabular-nums text-slate-900">{rupees(player.sold_price)}</span>
        <span className={cn("flex items-center gap-1 text-xs", mine ? "font-semibold text-emerald-700" : "text-slate-500")}>
          <TeamDot color={team?.color ?? "#94a3b8"} /> {mine ? "Your team" : team?.short_name || team?.name || "Sold"}
        </span>
      </span>
    );
  if (player.status === "unsold") return <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Unsold</span>;
  return (
    <span className="flex shrink-0 flex-col items-end">
      {next && (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
          Next <ChevronRight className="size-3" />
        </span>
      )}
      <span className="text-xs text-slate-500">Base {rupees(player.base_price)}</span>
    </span>
  );
}
