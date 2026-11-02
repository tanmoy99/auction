"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Match } from "./fixtures";
import type { MatchEvent, PlayerMatchStats } from "./scoring";
import type { Access, AuctionState, Bid, Player, Team, Tournament } from "./types";

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  const isOwner = user?.app_metadata?.role === "owner";
  const isPlayer = user?.app_metadata?.role === "player";
  return { user, loading, isOwner, isPlayer };
}

const OPEN_ACCESS: Access = { is_admin: false, active: true, suspended: false, suspended_reason: null, access_until: null };

// Admin flag and paused state of the signed-in user (null while loading)
export function useAccess(user: User | null) {
  const [access, setAccess] = useState<{ userId: string; value: Access } | null>(null);
  useEffect(() => {
    if (!user) return;
    supabase.rpc("my_access").then(({ data, error }) => {
      // before migration 004 the function does not exist: treat everyone as active, nobody as admin
      setAccess({ userId: user.id, value: error || !data ? OPEN_ACCESS : (data as Access) });
    });
  }, [user]);
  return user && access?.userId === user.id ? access.value : null;
}

// Sends visitors to /login (team owners to /owner, players to /my) unless they are a signed-in organiser
export function useRequireOrganiser() {
  const { user, loading, isOwner, isPlayer } = useUser();
  const access = useAccess(isOwner || isPlayer ? null : user);
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (isOwner) router.replace("/owner");
    else if (isPlayer) router.replace("/my");
  }, [loading, user, isOwner, isPlayer, router]);
  return { user, access, ready: !loading && !!user && !isOwner && !isPlayer && !!access };
}

// Difference between the database clock and this device, so every phone shows the same countdown
export function useServerOffset() {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const t0 = Date.now();
      const { data } = await supabase.rpc("server_now");
      const t1 = Date.now();
      if (data && !cancelled) setOffset(new Date(data as string).getTime() - (t0 + t1) / 2);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return offset;
}

// Seconds left until endsAt (null when there is no timer)
export function useCountdown(endsAt: string | null, offset: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [endsAt]);
  if (!endsAt) return null;
  return Math.max(0, (new Date(endsAt).getTime() - (now + offset)) / 1000);
}

// Moves the auction along on time: when the timer runs out (sold / unsold) and, after the result
// pause, the next player. Every open screen runs this; the server applies each step only once.
export function useAuctionDriver(t: Tournament | null, state: AuctionState | null, offset: number) {
  const tournamentId = t?.id;
  const autoClose = t?.auto_close;
  const autoNext = t?.auto_next;
  const pause = t?.result_pause_seconds ?? 6;
  const phase = state?.phase;
  const endsAt = state?.ends_at;
  const updatedAt = state?.updated_at;

  useEffect(() => {
    if (!tournamentId || !phase) return;
    let due: number | null = null;
    if (phase === "bidding" && autoClose && endsAt) due = new Date(endsAt).getTime();
    else if ((phase === "sold" || phase === "unsold") && autoNext && updatedAt) due = new Date(updatedAt).getTime() + pause * 1000;
    if (due == null) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const fire = async () => {
      if (stopped) return;
      await supabase.rpc("auction_tick", { p_tournament: tournamentId });
      if (!stopped) timer = setTimeout(fire, 1500); // keep nudging until the new state arrives
    };
    // small random delay so dozens of phones don't all call at the same millisecond
    timer = setTimeout(fire, Math.max(0, due - (Date.now() + offset)) + 300 + Math.random() * 500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [tournamentId, autoClose, autoNext, pause, phase, endsAt, updatedAt, offset]);
}

// Everything about one tournament, kept live with Supabase Realtime
export function useTournamentLive(id: string | undefined) {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [state, setState] = useState<AuctionState | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const currentPlayer = useRef<string | null>(null);
  const lastUpdate = useRef<string | null>(null);
  useEffect(() => {
    lastUpdate.current = state?.updated_at ?? null;
  }, [state]);

  const loadBids = useCallback(
    async (playerId: string | null) => {
      currentPlayer.current = playerId;
      if (!id || !playerId) return setBids([]);
      const { data } = await supabase
        .from("bids")
        .select("*")
        .eq("tournament_id", id)
        .eq("player_id", playerId)
        .order("created_at", { ascending: false })
        .limit(20)
        .abortSignal(AbortSignal.timeout(12000));
      if (currentPlayer.current === playerId) setBids((data as Bid[]) ?? []);
    },
    [id],
  );

  const generation = useRef(0);
  const inFlight = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!id) return;
    const request = ++generation.current;
    inFlight.current = request;
    try {
      const [t, tm, p, s] = await Promise.all([
        supabase.from("tournament_display").select("*").eq("id", id).abortSignal(AbortSignal.timeout(12000)).maybeSingle(),
        supabase.from("team_display").select("*").eq("tournament_id", id).order("created_at").abortSignal(AbortSignal.timeout(12000)),
        supabase.from("players").select("*").eq("tournament_id", id).order("created_at").abortSignal(AbortSignal.timeout(12000)),
        supabase.from("auction_state").select("*").eq("tournament_id", id).abortSignal(AbortSignal.timeout(12000)).maybeSingle(),
      ]);
      if (request !== generation.current) return;
      const failed = [t, tm, p, s].some((result) => result.error);
      setError(failed ? "Could not refresh tournament. Check your connection and retry." : null);
      setLoading(false);
      if (failed) return;
      setTournament((t.data as Tournament) ?? null);
      setTeams((tm.data as Team[]) ?? []);
      setPlayers((p.data as Player[]) ?? []);
      setState((s.data as AuctionState) ?? null);
      setLoading(false);
      await loadBids((s.data as AuctionState | null)?.player_id ?? null);
    } finally {
      if (inFlight.current === request) inFlight.current = 0;
    }
  }, [id, loadBids]);

  useEffect(() => {
    if (!id) return;
    const filter = `tournament_id=eq.${id}`;
    // Unique topic per mount: supabase.channel() hands back an existing channel with the same name,
    // and reusing one that is still being removed (React re-mounts) leaves it silently dead.
    const initial = setTimeout(() => void load(), 0);
    const epoch = generation;
    const refresh = setInterval(() => {
      if (document.visibilityState === "visible" && !inFlight.current) void load();
    }, 10000);
    const onOnline = () => {
      void load();
    };
    window.addEventListener("online", onOnline);
    const channel = supabase
      .channel(`tournament-${id}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "auction_state", filter }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "teams", filter }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "bids", filter }, () => void load())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tournaments", filter: `id=eq.${id}` }, () => void load())
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
        // (re)load after every (re)connect so nothing is missed while a phone was asleep
        if (status === "SUBSCRIBED") load();
      });

    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      ++epoch.current;
      clearTimeout(initial);
      clearInterval(refresh);
      window.removeEventListener("online", onOnline);
      supabase.removeChannel(channel);
    };
  }, [id, load, loadBids]);

  // Safety net: refresh the auction stage every few seconds in case a live update is missed
  // (flaky mobile data, phone screen lock). Cheap: one small row.
  useEffect(() => {
    if (!id) return;
    const timer = setInterval(
      async () => {
        if (document.visibilityState !== "visible") return;
        const { data } = await supabase
          .from("auction_state")
          .select("updated_at")
          .eq("tournament_id", id)
          .abortSignal(AbortSignal.timeout(12000)).maybeSingle();
        if (data && data.updated_at !== lastUpdate.current && !inFlight.current) load();
      },
      connected ? 8000 : 2500,
    );
    return () => clearInterval(timer);
  }, [id, connected, load]);

  return {
    tournament,
    teams,
    players,
    state,
    bids,
    loading: loading || (!!tournament && tournament.id !== id && !error),
    connected,
    error,
    reload: load,
  };
}

// All matches of a tournament, kept up to date live
export function useMatches(tournamentId: string | undefined) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  const generation = useRef(0);
  const inFlight = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!tournamentId) return;
    const request = ++generation.current;
    inFlight.current = request;
    try {
      const { data, error } = await supabase
        .from("matches")
        .select("*")
        .eq("tournament_id", tournamentId)
        .order("match_no")
        .abortSignal(AbortSignal.timeout(12000));
      if (request !== generation.current) return;
      setError(error ? "Could not refresh fixtures. Retry when connected." : null);
      setLoading(false);
      if (error) return;
      setMatches((data as Match[]) ?? []);
      setLoading(false);
    } finally {
      if (inFlight.current === request) inFlight.current = 0;
    }
  }, [tournamentId]);

  useEffect(() => {
    if (!tournamentId) return;
    const initial = setTimeout(() => void load(), 0);
    const epoch = generation;
    const refresh = setInterval(() => {
      if (document.visibilityState === "visible" && !inFlight.current) void load();
    }, 10000);
    const onOnline = () => {
      void load();
    };
    window.addEventListener("online", onOnline);
    const channel = supabase
      .channel(`matches-${tournamentId}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter: `tournament_id=eq.${tournamentId}` },
        () => void load(),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") load();
      });
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      ++epoch.current;
      clearTimeout(initial);
      clearInterval(refresh);
      window.removeEventListener("online", onOnline);
      supabase.removeChannel(channel);
    };
  }, [tournamentId, load]);

  return { matches, loading, error, reload: load };
}

export type MatchPlayer = {
  id: string;
  match_id: string;
  tournament_id: string;
  team_id: string;
  player_id: string | null;
  guest_id: string | null;
  name: string;
  role: string | null;
  sort: number;
  is_captain?: boolean; // missing before migration 010
  is_keeper?: boolean;
};

export type GuestPlayer = {
  id: string;
  tournament_id: string;
  team_id: string;
  match_id: string | null;
  name: string;
  role: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

// One match with its playing XIs, scoring events and guest requests, kept up to date live
export function useMatchLive(matchId: string | undefined) {
  const [match, setMatch] = useState<Match | null>(null);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<MatchPlayer[]>([]);
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [guests, setGuests] = useState<GuestPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);

  const generation = useRef(0);
  const inFlight = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!matchId) return;
    const request = ++generation.current;
    inFlight.current = request;
    try {
      const { data: m, error: matchError } = await supabase
        .from("matches")
        .select("*")
        .eq("id", matchId)
        .abortSignal(AbortSignal.timeout(12000)).maybeSingle();
      if (request !== generation.current) return;
      setError(matchError ? "Could not refresh this match. Check your connection and retry." : null);
      if (matchError) {
        setLoading(false);
        return;
      }
      if (!m) {
        setMatch(null);
        setLoading(false);
        return;
      }
      const [t, tm, mp, ev, g] = await Promise.all([
        supabase.from("tournament_display").select("*").eq("id", m.tournament_id).abortSignal(AbortSignal.timeout(12000)).maybeSingle(),
        supabase
          .from("team_display")
          .select("*")
          .eq("tournament_id", m.tournament_id)
          .order("created_at")
          .abortSignal(AbortSignal.timeout(12000)),
        supabase.from("match_players").select("*").eq("match_id", matchId).order("sort").abortSignal(AbortSignal.timeout(12000)),
        supabase.from("match_events").select("*").eq("match_id", matchId).order("seq").abortSignal(AbortSignal.timeout(12000)),
        supabase
          .from("guest_players")
          .select("*")
          .eq("tournament_id", m.tournament_id)
          .in("team_id", [m.team_a_id, m.team_b_id].filter(Boolean))
          .abortSignal(AbortSignal.timeout(12000)),
      ]);
      if (request !== generation.current) return;
      const failed = [t, tm, mp, ev, g].some((result) => result.error);
      setError(failed ? "Could not refresh all match data. Retry when connected." : null);
      setLoading(false);
      if (failed) return;
      setMatch(m as Match);
      setTournament((t.data as Tournament) ?? null);
      setTeams((tm.data as Team[]) ?? []);
      setPlayers((mp.data as MatchPlayer[]) ?? []);
      setEvents((ev.data as MatchEvent[]) ?? []);
      setGuests((g.data as GuestPlayer[]) ?? []);
      setLoading(false);
    } finally {
      if (inFlight.current === request) inFlight.current = 0;
    }
  }, [matchId]);

  useEffect(() => {
    if (!matchId) return;
    const byMatch = `match_id=eq.${matchId}`;
    const initial = setTimeout(() => void load(), 0);
    const epoch = generation;
    const refresh = setInterval(() => {
      if (document.visibilityState === "visible" && !inFlight.current) void load();
    }, 10000);
    const onOnline = () => {
      void load();
    };
    window.addEventListener("online", onOnline);
    const channel = supabase
      .channel(`match-${matchId}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "matches", filter: `id=eq.${matchId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "match_events", filter: byMatch }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "match_players", filter: byMatch }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "guest_players" }, () => void load())
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") load();
      });
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      ++epoch.current;
      clearTimeout(initial);
      clearInterval(refresh);
      window.removeEventListener("online", onOnline);
      supabase.removeChannel(channel);
    };
  }, [matchId, load]);

  // Safety net for a missed live update: compare the newest event number every few seconds
  const lastSeq = events.at(-1)?.seq ?? 0;
  useEffect(() => {
    if (!matchId) return;
    const timer = setInterval(
      async () => {
        if (document.visibilityState !== "visible") return;
        const { data } = await supabase
          .from("match_events")
          .select("seq")
          .eq("match_id", matchId)
          .order("seq", { ascending: false })
          .limit(1)
          .abortSignal(AbortSignal.timeout(12000));
        if ((data?.[0]?.seq ?? 0) !== lastSeq && !inFlight.current) load();
      },
      connected ? 8000 : 3000,
    );
    return () => clearInterval(timer);
  }, [matchId, connected, lastSeq, load]);

  return {
    match,
    tournament,
    teams,
    players,
    events,
    guests,
    loading: loading || (!!match && match.id !== matchId && !error),
    connected,
    error,
    reload: load,
    setEvents,
  };
}

// Per-player numbers from every finished match of a tournament
export function useTournamentStats(tournamentId: string | undefined) {
  const [rows, setRows] = useState<PlayerStatRow[]>([]);
  const generation = useRef(0);
  const inFlight = useRef(0);
  const load = useCallback(async () => {
    if (!tournamentId) return;
    const request = ++generation.current;
    inFlight.current = request;
    try {
      const { data, error } = await supabase
        .from("player_match_stats")
        .select("*")
        .eq("tournament_id", tournamentId)
        .abortSignal(AbortSignal.timeout(12000));
      if (request !== generation.current || error) return;
      setRows((data as PlayerStatRow[]) ?? []);
    } finally {
      if (inFlight.current === request) inFlight.current = 0;
    }
  }, [tournamentId]);
  useEffect(() => {
    if (!tournamentId) return;
    const initial = setTimeout(() => void load(), 0);
    const epoch = generation;
    const refresh = setInterval(() => {
      if (document.visibilityState === "visible" && !inFlight.current) void load();
    }, 10000);
    const onOnline = () => {
      void load();
    };
    window.addEventListener("online", onOnline);
    const channel = supabase
      .channel(`stats-${tournamentId}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "player_match_stats", filter: `tournament_id=eq.${tournamentId}` },
        () => load(),
      )
      .subscribe((status) => status === "SUBSCRIBED" && load());
    return () => {
      ++epoch.current;
      clearTimeout(initial);
      clearInterval(refresh);
      window.removeEventListener("online", onOnline);
      supabase.removeChannel(channel);
    };
  }, [tournamentId, load]);
  return rows;
}

export type PlayerStatRow = PlayerMatchStats & {
  match_id: string;
  tournament_id: string;
  player_id: string | null;
  guest_id: string | null;
  name: string;
};
