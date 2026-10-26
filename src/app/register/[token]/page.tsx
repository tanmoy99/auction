"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, MapPin } from "lucide-react";
import { Logo } from "@/components/app-header";
import { PlayerFields, emptyPlayerForm, type PlayerFormValues } from "@/components/player-fields";
import { Button, PageLoader } from "@/components/ui";
import { errorMessage } from "@/lib/format";
import { compressImage } from "@/lib/image";
import { supabase } from "@/lib/supabase";

type Info = { name: string; venue: string | null; registration_open: boolean };

export default function RegisterPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<Info | null | undefined>(undefined);
  const [values, setValues] = useState<PlayerFormValues>(emptyPlayerForm);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from("tournaments")
      .select("name, venue, registration_open")
      .eq("registration_token", token)
      .maybeSingle()
      .then(({ data }) => setInfo((data as Info) ?? null));
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (values.phone.replace(/\D/g, "").length < 10) return setError("Please enter a valid 10-digit mobile number");
    setSaving(true);
    try {
      const body = new FormData();
      body.set("Name", values.name);
      body.set("Phone", values.phone);
      body.set("Role", values.role);
      body.set("Batting style", values.batting_style);
      body.set("Bowling style", values.bowling_style);
      body.set("Age", values.age);
      body.set("City", values.city);
      if (photo) body.set("photo", await compressImage(photo), "photo.jpg");
      const res = await fetch(`/api/register/${token}`, { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setDone(json.duplicate ? "You are already registered for this tournament." : "Registration received! The organiser will review it shortly.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  let content: React.ReactNode;
  if (info === undefined) content = <PageLoader />;
  else if (info === null) content = <p className="py-10 text-center text-slate-600">This registration link is not valid.</p>;
  else if (!info.registration_open) content = <p className="py-10 text-center text-slate-600">Registration for {info.name} is closed.</p>;
  else if (done)
    content = (
      <div className="flex flex-col items-center py-10 text-center">
        <CheckCircle2 className="size-14 text-emerald-600" />
        <h2 className="mt-4 text-lg font-semibold text-slate-900">Thank you, {values.name.split(" ")[0]}!</h2>
        <p className="mt-1 text-slate-600">{done}</p>
      </div>
    );
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
          Register
        </Button>
      </form>
    );

  return (
    <main className="flex flex-1 flex-col items-center px-4 py-8">
      <Logo />
      <div className="mt-6 w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {info && (
          <div className="bg-gradient-to-br from-emerald-600 to-emerald-800 px-6 py-6 text-white">
            <p className="text-sm text-emerald-100">Player registration</p>
            <h1 className="text-2xl font-bold">{info.name}</h1>
            {info.venue && (
              <p className="mt-1 flex items-center gap-1 text-sm text-emerald-100">
                <MapPin className="size-4" /> {info.venue}
              </p>
            )}
          </div>
        )}
        <div className="p-6">{content}</div>
      </div>
    </main>
  );
}
