"use client";
import { useState } from "react";
import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { Button, Field, Input } from "@/components/ui";
import { supabase } from "@/lib/supabase";
export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <AuthCard
      title="Choose a new password"
      subtitle="Use at least 8 characters."
      footer={<Link href="/forgot-password">Request a new recovery link</Link>}
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (password !== confirm) return setMessage("Passwords must match");
          setBusy(true);
          try {
            const { data } = await supabase.auth.getUser();
            if (!data.user || data.user.app_metadata?.role === "owner") {
              setMessage("Request a new recovery link. Team owners should contact their organiser.");
              return;
            }
            const { error } = await supabase.auth.updateUser({ password });
            if (error) setMessage("Password could not be changed. Try a stronger password or request a new link.");
            else {
              await supabase.auth.signOut();
              window.location.replace("/login");
            }
          } catch {
            setMessage("Could not connect. Please retry.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="New password">
          <Input
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Confirm password">
          <Input
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        <Button loading={busy} type="submit">
          Save password
        </Button>
        <p role="alert" className="text-sm text-slate-600">
          {message}
        </p>
      </form>
    </AuthCard>
  );
}
