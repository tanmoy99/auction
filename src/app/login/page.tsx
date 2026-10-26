"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { Button, Field, Input } from "@/components/ui";
import { loginToEmail } from "@/lib/config";
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
    const { data, error } = await supabase.auth.signInWithPassword({ email: loginToEmail(identifier), password });
    setLoading(false);
    if (error) return setError(error.message === "Invalid login credentials" ? "Wrong login ID / email or password" : error.message);
    router.push(data.user?.app_metadata?.role === "owner" ? "/owner" : "/dashboard");
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Organisers use their email. Team owners use the login ID given by the organiser."
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
        <Field label="Email or team login ID">
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
    </AuthCard>
  );
}
