"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CalendarDays,
  CheckCircle2,
  ChevronsRight,
  Circle,
  ExternalLink,
  Flag,
  Gavel,
  MessageCircle,
  Pause,
  Play,
  RotateCcw,
  Search,
  Share2,
  Shuffle,
  Trophy,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { BidHistory, PlayerStage, TimerHint } from "@/components/auction";
import { UpNext, upNext } from "@/components/player-board";
import { useTournament } from "@/components/tournament-context";
import { toast } from "@/components/toast";
import { Avatar, Button, Card, Input, TeamDot, cn } from "@/components/ui";
import { errorMessage, maxBid, nextBid, rupees } from "@/lib/format";
import { useAuctionDriver, useCountdown, useServerOffset } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import type { Player } from "@/lib/types";

function pickRandom<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)]!;
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={cn("flex items-start gap-3 text-sm text-slate-700", disabled ? "opacity-50" : "cursor-pointer")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked && !disabled}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors", checked && !disabled ? "bg-emerald-600" : "bg-slate-300")}
      >
        <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", checked && !disabled ? "left-4.5" : "left-0.5")} />
      </button>
      <span onClick={() => !disabled && onChange(!checked)}>{label}</span>
    </label>
  );
}

export default function AuctionControlPage() {
  const { tournament: t, teams, players, state, bids, connected, reload } = useTournament();
  const offset = useServerOffset();
  useAuctionDriver(t, state, offset);
  const [busy, setBusy] = useState<string | null>(null);
  const [queueTab, setQueueTab] = useState<"available" | "unsold">("available");
  const [query, setQuery] = useState("");

  const current = players.find((p) => p.id === state?.player_id) ?? null;
  const bidding = state?.phase === "bidding" && !!current;
  const leader = teams.find((x) => x.id === state?.leading_team_id);
  const amount = current ? nextBid(t, state?.current_bid ?? null, current.base_price) : 0;
  const squadCount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of players) if (p.status === "sold" && p.team_id) counts[p.team_id] = (counts[p.team_id] ?? 0) + 1;
    return counts;
  }, [players]);

  const next = upNext(players, state);
  const available = players.filter((p) => p.status === "available");
  const unsold = players.filter((p) => p.status === "unsold");
  const queue = (queueTab === "available" ? available : unsold).filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));

  async function call(key: string, fn: string, args: Record<string, unknown>, success?: string) {
    setBusy(key);
    const { error } = await supabase.rpc(fn, args);
    setBusy(null);
    if (error) toast(errorMessage(error), "error");
    else if (success) toast(success, "success");
    reload(); // don't wait for the live update to show the result of our own action
  }

  const start = (p: Player) => call(`start-${p.id}`, "start_player", { p_tournament: t.id, p_player: p.id });
  const close = () => call("close", "close_player", { p_tournament: t.id });

  function startNext() {
    if (next) return start(next);
    const pool = available.length ? available : unsold;
    if (!pool.length) return toast("No players left in the pool", "info");
    start(pickRandom(pool));
  }

  const setNext = (p: Player | null) =>
    call(p ? `next-${p.id}` : "shuffle", "set_next_player", { p_tournament: t.id, p_player: p?.id ?? null }, p ? `${p.name} is up next` : undefined);

  async function setAuto(values: Partial<Pick<typeof t, "auto_close" | "auto_next">>) {
    const { error } = await supabase.from("tournaments").update(values).eq("id", t.id);
    if (error) toast(errorMessage(error), "error");
    reload();
  }

  // countdown to the next player while the SOLD / UNSOLD result is showing
  const showingResult = state?.phase === "sold" || state?.phase === "unsold";
  const nextAt =
    showingResult && t.auto_next && available.length > 0
      ? new Date(new Date(state!.updated_at).getTime() + t.result_pause_seconds * 1000).toISOString()
      : null;
  const nextIn = useCountdown(nextAt, offset);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <AuctionStatusCard busy={busy} call={call} />
        {t.status === "live" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", connected ? "text-emerald-600" : "text-amber-600")}>
                {connected ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
                {connected ? "Live connection" : "Reconnecting..."}
              </span>
              <TimerHint seconds={t.bid_timer_seconds} />
            </div>

            <PlayerStage
              state={state}
              player={current}
              teams={teams}
              offset={offset}
              timerSeconds={t.bid_timer_seconds}
              idleText="Pick a player from the queue or bring a random one to start bidding"
            />

            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <UpNext players={players} state={state} />
              </div>
              <Button variant="secondary" onClick={() => setNext(null)} loading={busy === "shuffle"} disabled={available.length < 2} title="Pick a different random player">
                <Shuffle className="size-4" />
                <span className="hidden sm:inline">Shuffle</span>
              </Button>
            </div>

            <Card className="p-4">
              {bidding ? (
                <>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Close this player</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button size="lg" onClick={close} loading={busy === "close" && !!leader} disabled={!leader}>
                      <Gavel className="size-5" />
                      {leader ? `SOLD to ${leader.short_name || leader.name} · ${rupees(state!.current_bid)}` : "SOLD (no bids yet)"}
                    </Button>
                    <Button
                      size="lg"
                      variant="dark"
                      onClick={close}
                      loading={busy === "close" && !leader}
                      disabled={!!leader}
                      title={leader ? "There is a bid - sell or cancel instead" : undefined}
                    >
                      <Ban className="size-5" /> UNSOLD
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => call("timer", "reset_timer", { p_tournament: t.id })} loading={busy === "timer"} disabled={t.bid_timer_seconds === 0}>
                      <RotateCcw className="size-4" /> Restart timer
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => confirm("Take this player off the stage without a result? They go back to the pool.") && call("cancel", "cancel_player", { p_tournament: t.id })}
                      loading={busy === "cancel"}
                    >
                      <X className="size-4" /> Cancel player
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="lg" className="flex-1" onClick={startNext} disabled={!available.length && !unsold.length} loading={busy?.startsWith("start")}>
                    <Shuffle className="size-5" />
                    {nextIn != null
                      ? `${next?.name ?? "Next player"} in ${Math.ceil(nextIn)}s · bring now`
                      : next
                        ? `${state?.phase === "idle" ? "Start auction with" : "Bring"} ${next.name}`
                        : state?.phase === "idle"
                          ? "Start auction · random player"
                          : "Next random player"}
                  </Button>
                  {nextIn != null && (
                    <Button size="lg" variant="secondary" onClick={() => setAuto({ auto_next: false })}>
                      <Pause className="size-4" /> Pause
                    </Button>
                  )}
                  <p className="w-full text-center text-xs text-slate-500">
                    {available.length} in pool · {unsold.length} unsold
                    {available.length === 0 && unsold.length > 0 && " · pool finished, bring unsold players back from the Unsold tab"}
                  </p>
                </div>
              )}

              <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                <Toggle
                  checked={t.auto_close}
                  onChange={(v) => setAuto({ auto_close: v })}
                  label={
                    t.bid_timer_seconds > 0
                      ? `When the ${t.bid_timer_seconds}s timer ends: SOLD to the highest bidder, or UNSOLD if no bids`
                      : "Timer is off (set it in Settings) - close each player yourself"
                  }
                  disabled={t.bid_timer_seconds === 0}
                />
                <Toggle
                  checked={t.auto_next}
                  onChange={(v) => setAuto({ auto_next: v })}
                  label={`Bring the "up next" player automatically ${t.result_pause_seconds}s after SOLD / UNSOLD`}
                />
                <p className="text-xs text-slate-400">Automatic steps keep running even if this page is closed, as long as any auction screen is open.</p>
              </div>
            </Card>

            {bidding && (
              <Card className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">Bid on behalf of a team</h3>
                  <span className="text-xs text-slate-500">Next bid {rupees(amount)}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {teams.map((team) => {
                    const squad = squadCount[team.id] ?? 0;
                    const limit = maxBid(t, team, squad);
                    const reason =
                      team.id === leader?.id ? "Leading" : squad >= t.max_squad ? "Squad full" : amount > limit ? `Max ${rupees(limit)}` : null;
                    return (
                      <button
                        key={team.id}
                        disabled={!!reason || busy === `bid-${team.id}`}
                        onClick={() => call(`bid-${team.id}`, "admin_bid", { p_tournament: t.id, p_team: team.id, p_amount: amount })}
                        className="flex flex-col items-start rounded-lg border border-slate-200 px-3 py-2 text-left transition hover:border-emerald-400 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:bg-transparent"
                      >
                        <span className="flex w-full items-center gap-1.5 truncate text-sm font-medium text-slate-800">
                          <TeamDot color={team.color} /> {team.short_name || team.name}
                        </span>
                        <span className="text-xs text-slate-500">{reason ?? `Bid ${rupees(amount)}`}</span>
                      </button>
                    );
                  })}
                </div>
              </Card>
            )}
          </>
        )}
        {t.status !== "completed" && (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
                {(["available", "unsold"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setQueueTab(tab)}
                    className={cn("rounded-md px-3 py-1 font-medium capitalize", queueTab === tab ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}
                  >
                    {tab} <span className="text-slate-400">{tab === "available" ? available.length : unsold.length}</span>
                  </button>
                ))}
              </div>
              <div className="relative w-full sm:w-56">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find player" className="h-9 pl-9" />
              </div>
            </div>
            <ul className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto">
              {queue.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">No players here</li>}
              {queue.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Avatar name={p.name} src={p.photo_url} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{p.name}</p>
                    <p className="truncate text-xs text-slate-500">{[p.role, p.city, p.category].filter(Boolean).join(" · ")}</p>
                  </div>
                  <span className="text-xs text-slate-500">{rupees(p.base_price)}</span>
                  {p.id === next?.id ? (
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">Next</span>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setNext(p)} loading={busy === `next-${p.id}`} title="Make this player up next">
                      <ChevronsRight className="size-3.5" /> Next
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" disabled={bidding} loading={busy === `start-${p.id}`} onClick={() => start(p)}>
                    <Play className="size-3.5" /> Start
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <div className="space-y-4">
        {t.status !== "completed" && (
          <Card>
            <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Bids for this player</h3>
            <div className="max-h-72 overflow-y-auto p-2">
              <BidHistory bids={bids} teams={teams} />
            </div>
          </Card>
        )}

        <Card>
          <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Teams</h3>
          <ul className="divide-y divide-slate-100">
            {teams.map((team) => {
              const squad = squadCount[team.id] ?? 0;
              return (
                <li key={team.id} className={cn("px-4 py-3", team.id === leader?.id && bidding && "bg-emerald-50")}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2 truncate font-medium text-slate-800">
                      <TeamDot color={team.color} /> {team.name}
                    </span>
                    <span className="font-semibold tabular-nums text-slate-900">{rupees(team.purse - team.spent)}</span>
                  </div>
                  <div className="mt-1 flex justify-between text-xs text-slate-500">
                    <span>
                      {squad}/{t.max_squad} players
                    </span>
                    <span>Max bid {rupees(maxBid(t, team, squad))}</span>
                  </div>
                  {!team.owner_user_id && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-amber-600">
                      <Ban className="size-3" /> No owner login - bid for them above
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}

type Call = (key: string, fn: string, args: Record<string, unknown>, success?: string) => Promise<void>;

// Before: readiness checklist + Start. During: Finish. After: summary, what to do next, Reopen.
function AuctionStatusCard({ busy, call }: { busy: string | null; call: Call }) {
  const { tournament: t, teams, players, state } = useTournament();
  const count = (s: string) => players.filter((p) => p.status === s).length;
  const available = count("available");
  const unsold = count("unsold");
  const sold = count("sold");
  const pending = count("pending");
  const setStatus = (status: "live" | "completed", message: string) =>
    call("status", "set_auction_status", { p_tournament: t.id, p_status: status }, message);

  if (t.status === "setup") {
    const noLogin = teams.filter((x) => !x.owner_user_id).length;
    const checks = [
      { ok: teams.length >= 2, warn: false, text: teams.length >= 2 ? `${teams.length} teams ready` : "Add at least 2 teams", href: `/t/${t.id}/teams` },
      { ok: available > 0, warn: false, text: available > 0 ? `${available} players in the pool` : "Add or import players", href: `/t/${t.id}/players` },
      {
        ok: noLogin === 0,
        warn: true,
        text: noLogin === 0 ? "Every team owner has a login" : `${noLogin} team${noLogin > 1 ? "s have" : " has"} no owner login (you can bid for them here)`,
        href: `/t/${t.id}/teams`,
      },
      {
        ok: pending === 0,
        warn: true,
        text: pending === 0 ? "No registrations waiting" : `${pending} registration${pending > 1 ? "s" : ""} waiting for approval (they won't come up)`,
        href: `/t/${t.id}/players`,
      },
    ];
    const ready = checks.every((c) => c.ok || c.warn);
    return (
      <Card className="p-5">
        <h2 className="text-lg font-semibold text-slate-900">Ready to start the auction?</h2>
        <p className="mt-1 text-sm text-slate-500">
          Check these, then press Start. Open the <b>Big screen</b> on a TV or projector first if you have one.
        </p>
        <ul className="mt-4 space-y-2">
          {checks.map((c) => (
            <li key={c.text}>
              <Link href={c.href} className="flex items-start gap-2 text-sm hover:underline">
                {c.ok ? (
                  <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
                ) : c.warn ? (
                  <AlertTriangle className="size-5 shrink-0 text-amber-500" />
                ) : (
                  <Circle className="size-5 shrink-0 text-slate-300" />
                )}
                <span className={c.ok ? "text-slate-600" : "text-slate-800"}>{c.text}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Button size="lg" className="mt-5 w-full" disabled={!ready} loading={busy === "status"} onClick={() => setStatus("live", "Auction started")}>
          <Play className="size-5" /> Start auction
        </Button>
        <p className="mt-2 text-center text-xs text-slate-500">
          {ready ? "After starting, bring players one by one. Owners bid from their phones." : "Finish the steps above to start."}
        </p>
      </Card>
    );
  }

  if (t.status === "live") {
    const bidding = state?.phase === "bidding";
    const allDone = available === 0 && unsold === 0 && !bidding;
    const finish = () => {
      const left = available + unsold;
      const note =
        left > 0 ? `\n\n${left} player${left > 1 ? "s are" : " is"} still without a team (${available} not auctioned, ${unsold} unsold). They stay that way.` : "";
      if (confirm(`Finish the auction?${note}\n\nYou can reopen it later if needed.`)) setStatus("completed", "Auction finished");
    };
    return (
      <Card className={cn("flex flex-wrap items-center gap-3 p-4", allDone && "border-emerald-300 bg-emerald-50")}>
        <span className="flex size-2.5 shrink-0 animate-pulse rounded-full bg-rose-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">{allDone ? "Every player has been auctioned" : "Auction is running"}</p>
          <p className="text-xs text-slate-500">
            {sold} sold · {available} in pool · {unsold} unsold
            {allDone && " · finish the auction to lock the squads"}
          </p>
        </div>
        <Button
          variant={allDone ? "primary" : "secondary"}
          onClick={finish}
          disabled={bidding}
          loading={busy === "status"}
          title={bidding ? "Close the player on stage first" : undefined}
        >
          <Flag className="size-4" /> Finish auction
        </Button>
      </Card>
    );
  }

  const spent = teams.reduce((sum, x) => sum + x.spent, 0);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const squadsLink = `${origin}/squads/${t.id}`;
  const steps = [
    {
      icon: Share2,
      title: "Share the final squads",
      text: "Public page with every team's players. You can download it as Excel there too.",
      action: (
        <div className="flex gap-2">
          <a href={`https://wa.me/?text=${encodeURIComponent(`${t.name} - final squads after the auction: ${squadsLink}`)}`} target="_blank">
            <Button size="sm">
              <MessageCircle className="size-4" /> WhatsApp
            </Button>
          </a>
          <a href={`/squads/${t.id}`} target="_blank">
            <Button size="sm" variant="secondary">
              <ExternalLink className="size-4" /> Open
            </Button>
          </a>
        </div>
      ),
    },
    {
      icon: CalendarDays,
      title: "Make the fixtures",
      text: "Generate league or knockout matches, then share the schedule and points table.",
      action: (
        <Link href={`/t/${t.id}/fixtures`}>
          <Button size="sm" variant="secondary">
            Go to Fixtures <ArrowRight className="size-4" />
          </Button>
        </Link>
      ),
    },
    {
      icon: Gavel,
      title: "Score matches ball by ball",
      text: "In Fixtures, open a match and send the scorer link and PIN to whoever is scoring.",
      action: null,
    },
  ];
  return (
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-br from-emerald-600 to-emerald-800 px-5 py-6 text-white">
        <Trophy className="size-8 text-emerald-200" />
        <h2 className="mt-2 text-xl font-bold">Auction finished</h2>
        <p className="text-sm text-emerald-100">
          {sold} players sold to {teams.length} teams for {rupees(spent)}
          {available + unsold > 0 && ` · ${available + unsold} left without a team`}
        </p>
      </div>
      <div className="p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">What to do next</h3>
        <ol className="mt-3 space-y-3">
          {steps.map((step, i) => (
            <li key={step.title} className="flex flex-wrap items-start gap-3 rounded-lg border border-slate-200 p-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <step.icon className="size-4 text-slate-400" /> {step.title}
                </p>
                <p className="text-xs text-slate-500">{step.text}</p>
              </div>
              {step.action}
            </li>
          ))}
        </ol>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
          <p className="text-xs text-slate-500">Need to auction leftover players? Reopening brings the controls back.</p>
          <Button size="sm" variant="ghost" loading={busy === "status"} onClick={() => confirm("Reopen the auction?") && setStatus("live", "Auction reopened")}>
            <RotateCcw className="size-4" /> Reopen auction
          </Button>
        </div>
      </div>
    </Card>
  );
}
