"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { uploadPhoto } from "@/lib/image";
import { Avatar, Button, Card, Field, Input } from "./ui";
type Sponsor = { id: string; name: string; logo_url: string | null };
export function Sponsors({ tournamentId, manage = false }: { tournamentId: string; manage?: boolean }) {
  const [rows, setRows] = useState<Sponsor[]>([]),
    [name, setName] = useState(""),
    [photo, setPhoto] = useState<File | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    supabase
      .from("sponsors")
      .select("id,name,logo_url")
      .eq("tournament_id", tournamentId)
      .order("created_at")
      .then(({ data }) => {
        if (active) setRows(data ?? []);
      });
    return () => {
      active = false;
    };
  }, [tournamentId]);
  if (!manage && !rows.length) return null;
  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-semibold text-slate-500">Tournament sponsors</h2>
      <div className="flex flex-wrap gap-4">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-2 text-sm">
            <Avatar name={row.name} src={row.logo_url} size={32} />
            <span className="max-w-48 break-words">{row.name}</span>
            {manage && (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const { error } = await supabase.from("sponsors").delete().eq("id", row.id);
                  if (error) setMessage("Could not remove sponsor");
                  else setRows(rows.filter((r) => r.id !== row.id));
                }}
              >
                Remove
              </Button>
            )}
          </div>
        ))}
      </div>
      {manage && (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage("");
            try {
              const logo = photo ? await uploadPhoto(tournamentId, photo) : null;
              const { data, error } = await supabase
                .from("sponsors")
                .insert({ tournament_id: tournamentId, name: name.trim(), logo_url: logo })
                .select("id,name,logo_url")
                .single();
              if (error) throw error;
              setRows([...rows, data]);
              setName("");
              setPhoto(null);
            } catch {
              setMessage("Could not save sponsor. Please retry.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Sponsor name">
            <Input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Logo (optional)">
            <Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          </Field>
          <Button loading={busy}>Add sponsor</Button>
        </form>
      )}
      {message && (
        <p role="alert" className="text-sm text-rose-700">
          {message}
        </p>
      )}
    </Card>
  );
}
