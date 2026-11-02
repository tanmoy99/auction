"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { Button, Field, Input } from "@/components/ui";
import { loginToEmail, mobileKey, playerEmail } from "@/lib/config";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    // a mobile number is a player login; if that fails it may still be a team login ID made of digits
    const mobile = mobileKey(identifier);
    let result = await supabase.auth.signInWithPassword({ email: mobile ? playerEmail(mobile) : loginToEmail(identifier), password });
    if (result.error && mobile) result = await supabase.auth.signInWithPassword({ email: loginToEmail(identifier), password });
    setLoading(false);
    const { data, error } = result;
    if (error) return setError(error.message === "Invalid login credentials" ? "Wrong login details or password" : error.message);
    const role = data.user?.app_metadata?.role;
    router.push(role === "owner" ? "/owner" : role === "player" ? "/my" : "/dashboard");
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Organisers use their email. Team owners use their login ID. Players use their mobile number."
      footer={
        <>
          Organising a tournament?{" "}
          <Link href="/signup" className="font-medium text-emerald-700 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email, team login ID or mobile number">
          <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoCapitalize="none" autoComplete="username" required />
        </Field>
        <Field label="Password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <Button type="submit" className="w-full" loading={loading}>
          Log in
        </Button>
      </form>
      <Link href="/forgot-password" className="mt-4 block text-sm text-emerald-700 hover:underline">Forgot your password?</Link>
    </AuthCard>
  );
}
