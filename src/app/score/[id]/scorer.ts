"use client";

import { useCallback } from "react";
import { toast } from "@/components/toast";
import type { Scoreboard } from "@/components/scorecard";
import { errorMessage } from "@/lib/format";
import { liveScore, replay, type EventData, type MatchEvent } from "@/lib/scoring";
import { supabase } from "@/lib/supabase";

// A random id for this phone, kept between visits, so "one phone scores at a time" works without accounts
export function deviceId() {
  try {
    let id = localStorage.getItem("cricauction-device");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("cricauction-device", id);
    }
    return id;
  } catch {
    return "no-storage";
  }
}

export type Access = { pin: string; device: string };

// Scoring actions. Each one shows on this phone at once and is then confirmed by the database.
export function useScoringActions(
  matchId: string,
  access: Access,
  board: Scoreboard,
  events: MatchEvent[],
  setEvents: (fn: (rows: MatchEvent[]) => MatchEvent[]) => void,
  reload: () => void,
  onLost: (message: string) => void,
) {
  const fail = useCallback(
    (err: unknown) => {
      const message = errorMessage(err);
      if (/took over/i.test(message)) onLost(message);
      else toast(message, "error");
      reload();
    },
    [onLost, reload],
  );

  const send = useCallback(
    async (data: EventData) => {
      const seq = (events.at(-1)?.seq ?? 0) + 1;
      const event: MatchEvent = { id: `local-${seq}`, match_id: matchId, seq, type: data.type, data, created_at: new Date().toISOString() };
      const next = [...events, event];
      const live = liveScore(replay(next, board.rules, board.lineups), board.rules);
      setEvents(() => next);
      const { error } = await supabase.rpc("scorer_event", {
        p_match: matchId,
        p_pin: access.pin,
        p_device: access.device,
        p_seq: seq,
        p_type: data.type,
        p_data: data,
        p_live: live,
      });
      if (error) fail(error);
    },
    [events, matchId, board.rules, board.lineups, setEvents, access, fail],
  );

  const undo = useCallback(async () => {
    const last = events.at(-1);
    if (!last) return;
    const rest = events.slice(0, -1);
    const live = liveScore(replay(rest, board.rules, board.lineups), board.rules);
    setEvents(() => rest);
    const { error } = await supabase.rpc("scorer_undo", { p_match: matchId, p_pin: access.pin, p_device: access.device, p_seq: last.seq, p_live: live });
    if (error) fail(error);
  }, [events, matchId, board.rules, board.lineups, setEvents, access, fail]);

  const call = useCallback(
    async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc(fn, { p_match: matchId, p_pin: access.pin, p_device: access.device, ...args });
      if (error) {
        fail(error);
        return null;
      }
      return data ?? true;
    },
    [matchId, access, fail],
  );

  return { send, undo, call };
}
