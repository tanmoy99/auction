"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, MapPin } from "lucide-react";
import { Logo } from "@/components/app-header";
import { PlayerFields, emptyPlayerForm, playerFormData, type PlayerFormValues } from "@/components/player-fields";
import { Avatar, Button, PageLoader } from "@/components/ui";
import { errorMessage } from "@/lib/format";
import { compressImage } from "@/lib/image";
import { supabase } from "@/lib/supabase";

// From public.team_link_info()
type Info = {
  team: string;
  short_name: string | null;
  color: string;
  logo_url: string | null;
  tournament: string;
  venue: string | null;
  open: boolean;
  full: boolean;
};

// Team join link: a team owner shares this on WhatsApp, players fill it and go straight into that squad
export default function JoinTeamPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<Info | null | undefined>(undefined);
  const [values, setValues] = useState<PlayerFormValues>(emptyPlayerForm);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.rpc("team_link_info", { p_token: token }).then(({ data }) => setInfo((data as Info) ?? null));
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (values.phone.replace(/\D/g, "").length < 10) return setError("Please enter a valid 10-digit mobile number");
    setSaving(true);
    try {
      const res = await fetch(`/api/join/${token}`, { method: "POST", body: playerFormData(values, photo && (await compressImage(photo))) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  let content: React.ReactNode;
  if (info === undefined) content = <PageLoader />;
  else if (info === null) content = <p className="py-10 text-center text-slate-600">This team link is not valid. Ask the team owner for a new one.</p>;
  else if (done)
    content = (
      <div className="flex flex-col items-center py-10 text-center">
        <CheckCircle2 className="size-14 text-emerald-600" />
        <h2 className="mt-4 text-lg font-semibold text-slate-900">Welcome to {info.team}, {values.name.split(" ")[0]}!</h2>
        <p className="mt-1 text-slate-600">You have been added to the squad.</p>
      </div>
    );
  else if (!info.open) content = <p className="py-10 text-center text-slate-600">Adding players to {info.team} is closed right now.</p>;
  else if (info.full) content = <p className="py-10 text-center text-slate-600">{info.team}&apos;s squad is already full.</p>;
  else
    content = (
      <form onSubmit={onSubmit} className="space-y-5">
        <PlayerFields
          values={values}
          onChange={setValues}
          photoPreview={preview}
          onPhoto={(file) => {
            setPhoto(file);
            setPreview(URL.createObjectURL(file));
          }}
        />
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={saving}>
          Join {info.team}
        </Button>
      </form>
    );

  return (
    <main className="flex flex-1 flex-col items-center px-4 py-8">
      <Logo />
      <div className="mt-6 w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {info && (
          <div className="flex items-center gap-4 px-6 py-6 text-white" style={{ background: info.color }}>
            <Avatar name={info.short_name || info.team} src={info.logo_url} size={56} color={info.color} className="ring-2 ring-white/50" />
            <div className="min-w-0">
              <p className="text-sm text-white/80">Join the team · {info.tournament}</p>
              <h1 className="truncate text-2xl font-bold">{info.team}</h1>
              {info.venue && (
                <p className="mt-1 flex items-center gap-1 text-sm text-white/80">
                  <MapPin className="size-4" /> {info.venue}
                </p>
              )}
            </div>
          </div>
        )}
        <div className="p-6">{content}</div>
      </div>
    </main>
  );
}
