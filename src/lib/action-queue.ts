export type QueueEntry = {
  id: string;
  revision: number;
  kind: "event" | "undo";
  seq: number;
  data: unknown;
  live: unknown;
  events: unknown[];
};
export type QueueSnapshot = { entries: QueueEntry[]; status: "Saved" | "Saving" | "Offline" | "Review required"; error: string | null };

// Persist before sending. Failed/ambiguous writes retain the original identifier and payload.
export class ActionQueue {
  snapshot: QueueSnapshot;
  private running = false;
  private paused = false;
  private idleWaiters: (() => void)[] = [];
  private listeners = new Set<() => void>();
  private persist: (entries: QueueEntry[]) => void;
  private execute: (entry: QueueEntry) => Promise<void>;
  constructor(entries: QueueEntry[], persist: (entries: QueueEntry[]) => void, execute: (entry: QueueEntry) => Promise<void>) {
    this.snapshot = {
      entries,
      status: entries.length ? "Review required" : "Saved",
      error: entries.length ? "Recovered unsaved actions. Retry to verify them against the server, or export for review." : null,
    };
    this.persist = persist;
    this.execute = execute;
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.snapshot;
  resume() {
    this.paused = false;
  }
  pause(): Promise<void> {
    this.paused = true;
    return this.running ? new Promise((resolve) => this.idleWaiters.push(resolve)) : Promise.resolve();
  }
  restore(entries: QueueEntry[]) {
    if (this.running) throw new Error("Cannot restore a running queue");
    this.publish({
      entries,
      status: entries.length ? "Review required" : "Saved",
      error: entries.length ? "Recovered pending actions. Retry to verify them against the server, or export for review." : null,
    });
  }
  private publish(change: Partial<QueueSnapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((fn) => fn());
  }
  enqueue(entry: QueueEntry) {
    const entries = [...this.snapshot.entries, entry];
    this.persist(entries); // Storage failure must prevent optimistic success.
    this.publish({ entries });
  }
  async flush(online = true) {
    if (this.running || this.paused) return;
    if (!online) {
      this.publish({ status: "Offline" });
      return;
    }
    this.running = true;
    this.publish({ status: "Saving", error: null });
    try {
      while (this.snapshot.entries.length && !this.paused) {
        const entry = this.snapshot.entries[0];
        await this.execute(entry);
        const entries = this.snapshot.entries.slice(1);
        this.persist(entries);
        this.publish({ entries });
      }
      this.publish({ status: this.snapshot.entries.length ? "Review required" : "Saved" });
    } catch (error) {
      this.publish({
        status: "Review required",
        error: error instanceof Error ? error.message : "Save failed. Retry or export pending actions.",
      });
    } finally {
      this.running = false;
      this.idleWaiters.splice(0).forEach((resolve) => resolve());
    }
  }
  discard() {
    if (this.running) throw new Error("Wait for the current save before reviewing pending actions");
    this.persist([]);
    this.publish({ entries: [], status: "Saved", error: null });
  }
}
