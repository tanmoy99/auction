"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "@/components/toast";
import type { Scoreboard } from "@/components/scorecard";
import { liveScore, replay, type EventData, type MatchEvent } from "@/lib/scoring";
import { supabase } from "@/lib/supabase";
import { ActionQueue, type QueueEntry } from "@/lib/action-queue";

let memoryDevice: string | null = null;
export function deviceId() {
  try {
    let id = localStorage.getItem("cricauction-device");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("cricauction-device", id);
    }
    return id;
  } catch {
    return (memoryDevice ??= crypto.randomUUID());
  }
}
export type Access = { pin: string; device: string };

export function useScoringActions(
  matchId: string,
  access: Access,
  board: Scoreboard,
  events: MatchEvent[],
  revision: number,
  reload: () => Promise<void>,
) {
  const key = `cricmate-pending:${matchId}:${access.device}`;
  const [writerReady, setWriterReady] = useState(false);
  const [queue] = useState(() => {
    let entries: QueueEntry[] = [];
    let damaged = false;
    try {
      entries = JSON.parse(localStorage.getItem(key) ?? "[]");
      if (
        !Array.isArray(entries) ||
        entries.some((e) => !e || typeof e.id !== "string" || !Number.isInteger(e.revision) || !Array.isArray(e.events))
      )
        throw new Error("Invalid pending data");
    } catch {
      damaged = true;
      entries = [];
    }
    const queue = new ActionQueue(
      entries,
      (rows) => {
        if (damaged) throw new Error("Pending data is unreadable. Preserve browser storage and contact the organiser.");
        localStorage.setItem(key, JSON.stringify(rows));
      },
      async (entry) => {
        const send = (revision: number) =>
          supabase.rpc("scorer_action", {
            p_match: matchId,
            p_pin: access.pin,
            p_device: access.device,
            p_action: entry.id,
            p_revision: revision,
            p_kind: entry.kind,
            p_seq: entry.seq,
            p_data: entry.data,
            p_live: entry.live,
          });
        let { error } = await send(entry.revision);
        // The revision also moves for things that don't change the balls (a phone taking over, lineup edits).
        // If the server's balls are exactly the ones this action was scored on, send it again on the new revision.
        if (error && /score changed/i.test(error.message)) {
          const rebased = await currentRevisionIfSameBalls(matchId, entry);
          if (rebased != null) ({ error } = await send(rebased));
        }
        if (error) throw new Error(error.message);
      },
    );
    if (damaged)
      queue.snapshot = {
        entries: [],
        status: "Review required",
        error: "Pending data is unreadable. Export it before clearing this browser storage.",
      };
    return queue;
  });
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  // What this phone has scored, shown until the server has caught up with it (target = score revision after the last action)
  const [projection, setProjection] = useState<Projection | null>(() => projectionOf(queue.snapshot.entries));
  useEffect(() => {
    const controller = new AbortController();
    let release: () => void = () => {};
    if (!navigator.locks) return;
    void navigator.locks
      .request(key, { signal: controller.signal }, async () => {
        if (controller.signal.aborted) return;
        queue.resume();
        try {
          const stored = localStorage.getItem(key) ?? "[]";
          if (stored !== JSON.stringify(queue.snapshot.entries)) {
            const recovered = JSON.parse(stored) as QueueEntry[];
            if (
              !Array.isArray(recovered) ||
              recovered.some((e) => !e || typeof e.id !== "string" || !Number.isInteger(e.revision) || !Array.isArray(e.events))
            )
              return;
            queue.restore(recovered);
            setProjection(projectionOf(recovered));
          }
          setWriterReady(true);
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        } catch {
          /* Preserve unreadable storage and keep scoring locked. */
        }
      })
      .catch(() => {
        /* A queued lock request is cancelled on unmount. */
      });
    return () => {
      controller.abort();
      void queue.pause().then(() => release());
    };
  }, [key, queue]);
  const current = useRef(events);
  const nextRevision = useRef(revision);
  useEffect(() => {
    if (!queue.snapshot.entries.length && queue.snapshot.status === "Saved" && revision >= nextRevision.current) {
      current.current = events;
      nextRevision.current = revision;
    }
  }, [events, revision, queue]);
  const flush = useCallback(async () => {
    if (!writerReady) return;
    await queue.flush(navigator.onLine);
    // the projection stays on screen until the reloaded score includes every action (see "events" below)
    if (!queue.snapshot.entries.length) await reload();
  }, [queue, reload, writerReady]);
  useEffect(() => {
    const online = () => {
      if (queue.snapshot.status === "Offline") void flush();
    };
    const offline = () => {
      void queue.flush(false);
    };
    const warn = (event: BeforeUnloadEvent) => {
      if (queue.snapshot.entries.length) event.preventDefault();
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("beforeunload", warn);
    };
  }, [queue, flush]);
  const append = useCallback(
    (data: EventData | null) => {
      if (!writerReady)
        return toast(
          "Close other scoring tabs and reload this page. This browser must support secure local storage and Web Locks.",
          "error",
        );
      if (queue.snapshot.status === "Review required") return toast("Review unsaved actions before continuing", "error");
      const pending = queue.snapshot.entries;
      const previous = pending.at(-1);
      const base = previous ? (previous.events as MatchEvent[]) : current.current;
      const seq = data ? (base.at(-1)?.seq ?? 0) + 1 : base.at(-1)?.seq;
      if (!seq) return;
      const id = crypto.randomUUID();
      const next = data
        ? [...base, { id, match_id: matchId, seq, type: data.type, data, created_at: new Date().toISOString() }]
        : base.slice(0, -1);
      const expected = previous ? previous.revision + 1 : nextRevision.current;
      try {
        queue.enqueue({
          id,
          revision: expected,
          kind: data ? "event" : "undo",
          seq,
          data: data ?? {},
          live: liveScore(replay(next, board.rules, board.lineups), board.rules),
          events: next,
        });
        current.current = next;
        nextRevision.current = expected + 1;
        setProjection({ events: next, target: expected + 1 });
        void flush();
      } catch {
        toast("Cannot save pending actions on this device. Free browser storage before scoring.", "error");
      }
    },
    [queue, matchId, board.rules, board.lineups, flush, writerReady],
  );
  const call = useCallback(
    async (fn: string, args: Record<string, unknown>) => {
      if (!writerReady || queue.snapshot.entries.length || !navigator.onLine) {
        toast("Save pending actions and reconnect before changing the lineup or finishing the match", "error");
        return null;
      }
      const { data, error } = await supabase.rpc(fn, { p_match: matchId, p_pin: access.pin, p_device: access.device, ...args });
      if (error) {
        toast(error.message, "error");
        return null;
      }
      await reload();
      return data ?? true;
    },
    [queue, matchId, access, reload, writerReady],
  );
  const exportPending = () => {
    const url = URL.createObjectURL(
      new Blob([localStorage.getItem(key) ?? JSON.stringify(queue.snapshot.entries, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `pending-${matchId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const discard = async () => {
    if (!writerReady) return;
    if (!confirm("Have you exported and reviewed these actions against the public score? Discard pending input from this device?")) return;
    try {
      queue.discard();
      await reload();
      setProjection(null);
    } catch (e) {
      toast(String(e), "error");
    }
  };
  return {
    send: async (data: EventData) => append(data),
    undo: async () => append(null),
    call,
    events: projection && !caughtUp(projection, events, revision, snapshot) ? projection.events : events,
    status: writerReady ? snapshot.status : "Scoring locked in another tab or unsupported browser",
    pending: snapshot.entries.length,
    error: snapshot.error,
    retry: flush,
    exportPending,
    discard,
  };
}

type Projection = { events: MatchEvent[]; target: number };

function projectionOf(entries: QueueEntry[]): Projection | null {
  const last = entries.at(-1);
  return last ? { events: last.events as MatchEvent[], target: last.revision + 1 } : null;
}

// Has the server score caught up with what this phone scored? Until then, keep showing this phone's version,
// so the screen never jumps back to an older score (e.g. the pad reappearing when a new bowler is needed).
function caughtUp(p: Projection, server: MatchEvent[], revision: number, snapshot: { entries: unknown[]; status: string }) {
  if (snapshot.entries.length || snapshot.status !== "Saved") return false;
  if (revision > p.target) return true; // changed elsewhere since (another phone, lineup): the server wins
  return revision === p.target && server.length === p.events.length && server.at(-1)?.seq === p.events.at(-1)?.seq;
}

// The server's current revision, if its balls are exactly the ones this action was scored on; otherwise null (a real conflict)
async function currentRevisionIfSameBalls(matchId: string, entry: QueueEntry) {
  const [m, ev] = await Promise.all([
    supabase.from("matches").select("score_revision").eq("id", matchId).maybeSingle(),
    supabase.from("match_events").select("seq").eq("match_id", matchId).order("seq"),
  ]);
  if (m.error || ev.error || !m.data) return null;
  const server = (ev.data ?? []).map((e) => e.seq as number);
  const after = (entry.events as MatchEvent[]).map((e) => e.seq);
  // an event was scored on top of "after minus its own ball"; an undo removed the ball after "after"
  const base = entry.kind === "event" ? after.slice(0, -1) : after;
  const same = entry.kind === "event" ? server.length === base.length && server.every((seq, i) => seq === base[i]) : server.length === base.length + 1 && base.every((seq, i) => seq === server[i]);
  return same ? (m.data.score_revision as number) : null;
}
