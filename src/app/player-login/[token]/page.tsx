"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { Button, Field, Input, PageLoader } from "@/components/ui";
import { playerEmail } from "@/lib/config";
import { supabase } from "@/lib/supabase";

type Info = { name: string; tournament: string; mobile: string; existing: boolean };

// Opened from the organiser's WhatsApp link: the player sets a password, then logs in with their mobile number
export default function PlayerLoginSetup() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [info, setInfo] = useState<Info | null>(null);
  const [problem, setProblem] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/player-login/${token}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (r.ok) setInfo(body as Info);
        else setProblem(body.error ?? "This login link is not valid");
      })
      .catch(() => setProblem("Couldn't open the link. Check your connection and try again."));
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 6) return setError("Password must be at least 6 characters");
    if (password !== again) return setError("The two passwords don't match");
    setSaving(true);
    const r = await fetch(`/api/player-login/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) }).catch(() => null);
    const body = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) {
      setSaving(false);
      return setError(body.error ?? "Couldn't save. Check your connection and try again.");
    }
    const { error } = await supabase.auth.signInWithPassword({ email: playerEmail(body.mobile), password });
    if (error) {
      setSaving(false);
      return router.push("/login");
    }
    router.replace("/my");
  }

  if (!info && !problem) return <PageLoader />;
  if (problem)
    return (
      <AuthCard title="Player login" subtitle={problem} footer={<Link href="/login" className="font-medium text-emerald-700 hover:underline">Go to login</Link>}>
        <p className="text-sm text-slate-600">Ask your tournament organiser to send you a new player login link on WhatsApp.</p>
      </AuthCard>
    );
  return (
    <AuthCard
      title={info!.existing ? `Welcome back, ${info!.name.split(" ")[0]}` : `Hi ${info!.name.split(" ")[0]}!`}
      subtitle={`${info!.existing ? "Set a new password" : "Create your player login"} for ${info!.tournament}. You'll log in with your mobile number ${info!.mobile}.`}
      footer={
        <>
          Already have a password?{" "}
          <Link href="/login" className="font-medium text-emerald-700 hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Choose a password" hint="At least 6 characters">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
        </Field>
        <Field label="Type it again">
          <Input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
        </Field>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <Button type="submit" className="w-full" loading={saving}>
          {info!.existing ? "Save and log in" : "Create login"}
        </Button>
      </form>
    </AuthCard>
  );
}
