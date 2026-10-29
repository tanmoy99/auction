"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CalendarDays, Gavel, LogOut, UserPlus, Wifi, WifiOff } from "lucide-react";
import { BidHistory, PlayerStage } from "@/components/auction";
import { PlayerBoard, UpNext } from "@/components/player-board";
import { toast } from "@/components/toast";
import { Avatar, Card, EmptyState, PageLoader, TeamDot, cn } from "@/components/ui";
import { bidStep, errorMessage, maxBid, nextBid, rupees } from "@/lib/format";
import { useAuctionDriver, useCountdown, useServerOffset, useTournamentLive, useUser } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";

export default function BidPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const { tournament: t, teams, players, state, bids, loading, connected, reload } = useTournamentLive(id);
  const offset = useServerOffset();
  useAuctionDriver(t, state, offset);
  const [placing, setPlacing] = useState(false);
  const [tab, setTab] = useState<"bids" | "players" | "squad">("bids");

  useEffect(() => {
    if (!userLoading && !user) router.replace("/login");
  }, [userLoading, user, router]);

  const myTeam = teams.find((x) => x.owner_user_id === user?.id) ?? null;
  const current = players.find((p) => p.id === state?.player_id) ?? null;
  const bidding = state?.phase === "bidding" && !!current;
  const left = useCountdown(bidding ? state!.ends_at : null, offset);
  const mySquad = useMemo(() => players.filter((p) => p.team_id === myTeam?.id && p.status === "sold"), [players, myTeam]);
  const leading = !!myTeam && state?.leading_team_id === myTeam.id;

  // Buzz the phone when someone outbids us
  const wasLeading = useRef(false);
  useEffect(() => {
    if (wasLeading.current && !leading && bidding) navigator.vibrate?.([120, 60, 120]);
    wasLeading.current = leading;
  }, [leading, bidding]);

  if (loading || userLoading) return <PageLoader />;
  if (!t || !myTeam)
    return (
      <main className="mx-auto max-w-lg flex-1 px-4 py-10">
        <EmptyState icon={<Gavel className="size-6" />} title="You don't own a team in this tournament" text="Log in with the team owner ID the organiser gave you." />
      </main>
    );

  const limit = maxBid(t, myTeam, mySquad.length);
  const amount = current ? nextBid(t, state?.current_bid ?? null, current.base_price) : 0;
  const jump = amount + bidStep(t.increment_slabs, amount);
  const squadFull = mySquad.length >= t.max_squad;
  const timeUp = left != null && left <= 0;

  let blocked: string | null = null;
  if (t.suspended) blocked = "Auction paused by the admin";
  else if (!bidding) blocked = "Waiting for next player";
  else if (leading) blocked = "You are the highest bidder";
  else if (squadFull) blocked = "Your squad is full";
  else if (timeUp) blocked = "Time is up";
  else if (amount > limit) blocked = `Not enough purse (max ${rupees(limit)})`;

  async function bid(value: number) {
    setPlacing(true);
    const { error } = await supabase.rpc("place_bid", { p_tournament: t!.id, p_amount: value });
    setPlacing(false);
    if (error) toast(errorMessage(error), "error");
    reload();
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div className="flex flex-1 flex-col pb-40">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          <Avatar name={myTeam.short_name || myTeam.name} src={myTeam.logo_url} color={myTeam.color} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-slate-900">{myTeam.name}</p>
            <p className="flex items-center gap-1 truncate text-xs text-slate-500">
              {connected ? <Wifi className="size-3 text-emerald-600" /> : <WifiOff className="size-3 text-amber-600" />}
              {t.name}
            </p>
          </div>
          <Link href={`/bid/${t.id}/squad`} className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100" title="Add players to my team">
            <UserPlus className="size-4" /> Players
          </Link>
          <a href={`/fixtures/${t.id}`} className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100" title="Fixtures and points table">
            <CalendarDays className="size-4" /> Fixtures
          </a>
          <button onClick={signOut} className="rounded-md p-2 text-slate-400 hover:bg-slate-100" title="Sign out">
            <LogOut className="size-4" />
          </button>
        </div>
        <div className="mx-auto grid max-w-xl grid-cols-3 border-t border-slate-100 text-center">
          <Stat label="Purse left" value={rupees(myTeam.purse - myTeam.spent)} />
          <Stat label="Max bid" value={rupees(limit)} />
          <Stat label="Squad" value={`${mySquad.length}/${t.max_squad}`} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl space-y-4 px-4 py-4">
        {t.suspended && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center text-sm font-medium text-amber-900">
            This auction is paused by the site admin. Bidding will open again when it is resumed.
          </div>
        )}
        <PlayerStage state={state} player={current} teams={teams} offset={offset} timerSeconds={t.bid_timer_seconds} />
        <UpNext players={players} state={state} />

        <Card>
          <div className="flex border-b border-slate-100 text-sm">
            {(["bids", "players", "squad"] as const).map((x) => (
              <button
                key={x}
                onClick={() => setTab(x)}
                className={cn("flex-1 py-2.5 font-medium", tab === x ? "border-b-2 border-emerald-600 text-emerald-700" : "text-slate-500")}
              >
                {x === "bids" ? "Live bids" : x === "players" ? "Players" : `My squad (${mySquad.length})`}
              </button>
            ))}
          </div>
          <div className={cn("overflow-y-auto", tab === "players" ? "max-h-[32rem]" : "max-h-80 p-2")}>
            {tab === "players" ? (
              <PlayerBoard players={players} teams={teams} state={state} myTeamId={myTeam.id} />
            ) : tab === "bids" ? (
              <BidHistory bids={bids} teams={teams} />
            ) : mySquad.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">
                No players yet ·{" "}
                <Link href={`/bid/${t.id}/squad`} className="font-medium text-emerald-700 hover:underline">
                  Add your own players
                </Link>
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {mySquad.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-2 py-2">
                    <Avatar name={p.name} src={p.photo_url} size={32} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{p.name}</span>
                    <span className="text-xs text-slate-500">{p.role}</span>
                    <span className="text-sm font-semibold tabular-nums text-slate-900">{rupees(p.sold_price)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          {leading && bidding ? (
            <div className="flex h-16 items-center justify-center gap-2 rounded-2xl bg-emerald-50 text-lg font-semibold text-emerald-700">
              <TeamDot color={myTeam.color} className="size-3" /> You lead with {rupees(state!.current_bid)}
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => bid(amount)}
                disabled={!!blocked || placing}
                className="flex h-16 flex-1 flex-col items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/30 transition active:scale-[0.98] disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
              >
                {blocked ? (
                  <span className="text-base font-semibold">{blocked}</span>
                ) : (
                  <>
                    <span className="text-xs font-medium uppercase tracking-wide text-emerald-100">Tap to bid</span>
                    <span className="text-2xl font-extrabold tabular-nums">{rupees(amount)}</span>
                  </>
                )}
              </button>
              {!blocked && jump <= limit && (
                <button
                  onClick={() => bid(jump)}
                  disabled={placing}
                  className="flex h-16 w-28 flex-col items-center justify-center rounded-2xl border border-emerald-200 bg-white text-emerald-700 active:scale-[0.98]"
                >
                  <span className="text-[10px] font-medium uppercase tracking-wide">Jump</span>
                  <span className="text-base font-bold tabular-nums">{rupees(jump)}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-2 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-bold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}
