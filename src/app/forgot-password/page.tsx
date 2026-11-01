"use client";
import { useState } from "react";
import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { Button, Field, Input } from "@/components/ui";
import { supabase } from "@/lib/supabase";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <AuthCard
      title="Reset your password"
      subtitle="Organisers can request an email link. Team owners should ask their organiser to reset their login password."
      footer={<Link href="/login">Back to login</Link>}
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
              redirectTo: `${window.location.origin}/auth/callback`,
            });
            setMessage(
              error
                ? "Could not send the recovery email. Wait a moment and retry."
                : "If this email has an organiser account, a recovery link will arrive shortly.",
            );
          } catch {
            setMessage("Could not connect. Please retry.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Organiser email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Button loading={busy} type="submit">
          Send recovery link
        </Button>
        <p role="status" className="text-sm text-slate-600">
          {message}
        </p>
      </form>
    </AuthCard>
  );
}
