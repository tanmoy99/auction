"use client";
import { useEffect, useState } from "react";
import { useTournament } from "@/components/tournament-context";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui";
type Entry = {
  id: number;
  at: string;
  actor: string | null;
  actor_kind: string;
  action: string;
  before_value: unknown;
  after_value: unknown;
};
export default function History() {
  const { tournament } = useTournament();
  const [rows, setRows] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    supabase
      .from("audit_history")
      .select("id,at,actor,actor_kind,action,before_value,after_value")
      .eq("tournament_id", tournament.id)
      .order("id", { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        setRows(data ?? []);
        setError(error ? "History could not be loaded. Refresh to retry." : "");
      });
  }, [tournament.id]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Audit history</h1>
      <p className="text-sm text-slate-500">
        Latest 100 recorded changes. PIN scorers are identified by their recorded device name, not a verified account.
      </p>
      {error && <p role="alert">{error}</p>}
      {!rows.length && !error && <p>No recorded changes yet.</p>}
      {rows.map((row) => (
        <Card key={row.id} className="space-y-2 p-4">
          <p className="font-semibold">{row.action}</p>
          <p className="break-all text-xs text-slate-500">
            {new Date(row.at).toLocaleString()} · {row.actor ?? row.actor_kind}
          </p>
          <details>
            <summary className="cursor-pointer text-sm">Before and after</summary>
            <pre className="overflow-auto whitespace-pre-wrap break-all text-xs">
              {JSON.stringify({ before: row.before_value, after: row.after_value }, null, 2)}
            </pre>
          </details>
        </Card>
      ))}
    </div>
  );
}
