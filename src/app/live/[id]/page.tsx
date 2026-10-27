"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { Gavel, Maximize } from "lucide-react";
import { BidHistory, Countdown, PlayerDetails } from "@/components/auction";
import { Avatar, Spinner, TeamDot, cn } from "@/components/ui";
import { rupees } from "@/lib/format";
import { useAuctionDriver, useServerOffset, useTournamentLive } from "@/lib/hooks";

// Big screen for a projector / TV / YouTube stream. Public, no login.
export default function LiveScreen() {
  const { id } = useParams<{ id: string }>();
  const { tournament: t, teams, players, state, bids, loading } = useTournamentLive(id);
  const offset = useServerOffset();
  useAuctionDriver(t, state, offset);

  const current = players.find((p) => p.id === state?.player_id) ?? null;
  const leader = teams.find((x) => x.id === state?.leading_team_id);
  const soldTeam = teams.find((x) => x.id === current?.team_id);
  const squadCount = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of players) if (p.status === "sold" && p.team_id) c[p.team_id] = (c[p.team_id] ?? 0) + 1;
    return c;
  }, [players]);
  const sold = players.filter((p) => p.status === "sold").length;
  const remaining = players.filter((p) => p.status === "available").length;

  if (loading)
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-950">
        <Spinner />
      </div>
    );
  if (!t) return <div className="flex flex-1 items-center justify-center bg-slate-950 text-white/60">Tournament not found</div>;

  const showPlayer = current && state && state.phase !== "idle";
  const accent = state?.phase === "sold" ? soldTeam?.color : leader?.color;

  return (
    <div className="relative flex min-h-screen flex-1 flex-col overflow-hidden bg-slate-950 text-white">
      <div
        className="pointer-events-none absolute inset-0 opacity-40 transition-colors duration-700"
        style={{ background: `radial-gradient(ellipse at 30% 20%, ${accent ?? "#059669"}55, transparent 60%)` }}
      />

      <header className="relative flex items-center justify-between px-8 py-5">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">Player auction</p>
          <h1 className="text-2xl font-bold lg:text-3xl">{t.name}</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2 rounded-full bg-rose-600 px-3 py-1 text-sm font-bold">
            <span className="size-2 animate-pulse rounded-full bg-white" /> LIVE
          </span>
          <button onClick={() => document.documentElement.requestFullscreen?.()} className="rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white" title="Full screen">
            <Maximize className="size-5" />
          </button>
        </div>
      </header>

      <main className="relative flex flex-1 items-center px-8 pb-6">
        {showPlayer ? (
          <div className="grid w-full items-center gap-10 lg:grid-cols-[auto_1fr_340px]">
            <div className="relative mx-auto">
              <Avatar
                name={current.name}
                src={current.photo_url}
                size={300}
                color="rgba(255,255,255,0.08)"
                className="rounded-3xl! ring-4 ring-white/10"
              />
              {current.category && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-amber-400 px-3 py-1 text-sm font-bold text-slate-900">
                  {current.category}
                </span>
              )}
            </div>

            <div className="min-w-0 text-center lg:text-left">
              <h2 className="text-5xl font-black leading-tight lg:text-7xl">{current.name}</h2>
              <div className="mt-4 flex justify-center lg:justify-start [&_span]:px-4 [&_span]:py-1.5 [&_span]:text-base">
                <PlayerDetails player={current} dark />
              </div>
              <p className="mt-4 text-xl text-white/60">Base price {rupees(current.base_price)}</p>

              <div className="mt-8 flex flex-wrap items-end justify-center gap-8 lg:justify-start">
                <div>
                  <p className="text-sm font-medium uppercase tracking-widest text-white/50">{state.phase === "sold" ? "Sold for" : "Current bid"}</p>
                  <p key={state.current_bid} className="animate-bump text-7xl font-black tabular-nums text-emerald-400 lg:text-8xl">
                    {state.current_bid ? rupees(state.current_bid) : "-"}
                  </p>
                </div>
                {state.phase === "bidding" && (
                  <div className="scale-150 pb-4">
                    <Countdown endsAt={state.ends_at} offset={offset} total={t.bid_timer_seconds} dark />
                  </div>
                )}
              </div>
              <div className="mt-5 flex justify-center lg:justify-start">
                {leader ? (
                  <span className="inline-flex items-center gap-3 rounded-2xl px-5 py-3 text-2xl font-bold" style={{ background: leader.color }}>
                    {leader.name}
                  </span>
                ) : (
                  <span className="text-xl text-white/40">{state.phase === "unsold" ? "No bids" : "Waiting for the first bid..."}</span>
                )}
              </div>
            </div>

            <div className="hidden rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 lg:block">
              <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-white/50">Bids</p>
              <BidHistory bids={bids.slice(0, 8)} teams={teams} dark />
            </div>
          </div>
        ) : (
          <div className="flex w-full flex-col items-center text-center">
            <div className="rounded-full bg-emerald-500/10 p-6 text-emerald-400 ring-1 ring-emerald-500/30">
              <Gavel className="size-14" />
            </div>
            <p className="mt-6 text-4xl font-bold">Next player coming up</p>
            <p className="mt-2 text-xl text-white/50">
              {sold} sold · {remaining} remaining
            </p>
          </div>
        )}

        {t.suspended && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950/90">
            <p className="text-6xl font-black tracking-wide">Auction paused</p>
            <p className="mt-3 text-xl text-white/50">Please wait, it will continue shortly</p>
          </div>
        )}
        {state?.phase === "sold" && current && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <div
              className="animate-stamp rounded-2xl border-[10px] bg-slate-950/80 px-14 py-4 text-9xl font-black tracking-widest"
              style={{ borderColor: soldTeam?.color ?? "#10b981", color: soldTeam?.color ?? "#10b981" }}
            >
              SOLD
            </div>
            {soldTeam && (
              <p className="mt-6 rounded-xl bg-slate-950/80 px-6 py-2 text-4xl font-bold">
                to {soldTeam.name} for {rupees(current.sold_price)}
              </p>
            )}
          </div>
        )}
        {state?.phase === "unsold" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="animate-stamp rounded-2xl border-[10px] border-slate-400 bg-slate-950/80 px-14 py-4 text-9xl font-black tracking-widest text-slate-300">
              UNSOLD
            </div>
          </div>
        )}
      </main>

      <footer className="relative border-t border-white/10 bg-black/30 px-4 py-3">
        <div className="flex gap-3 overflow-x-auto">
          {teams.map((team) => (
            <div
              key={team.id}
              className={cn(
                "flex min-w-44 flex-1 items-center gap-3 rounded-xl px-3 py-2 ring-1 transition",
                team.id === leader?.id && state?.phase === "bidding" ? "bg-white/15 ring-white/40" : "bg-white/5 ring-white/10",
              )}
            >
              <TeamDot color={team.color} className="size-3" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{team.short_name || team.name}</p>
                <p className="text-xs tabular-nums text-white/60">
                  {rupees(team.purse - team.spent)} · {squadCount[team.id] ?? 0}/{t.max_squad}
                </p>
              </div>
            </div>
          ))}
        </div>
      </footer>
    </div>
  );
}
