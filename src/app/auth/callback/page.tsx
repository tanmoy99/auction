"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function RecoveryCallback() {
  const [message, setMessage] = useState("Checking recovery link…");
  useEffect(() => {
    let cancelled = false;
    const finish = () => {
      if (!cancelled) window.location.replace("/reset-password");
    };
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") finish();
    });
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.slice(1));
    if (hash.has("error") || url.searchParams.has("error")) {
      Promise.resolve().then(() => {
        if (!cancelled) setMessage("This recovery link is invalid or expired. Request a new one.");
      });
    } else {
      // The installed Supabase client processes implicit AND PKCE callbacks during
      // initialization. Wait for it instead of exchanging a one-use code twice.
      // This also handles a recovery event emitted before React subscribed.
      supabase.auth.getSession().then(({ data: sessionData, error }) => {
        if (cancelled) return;
        if (!error && sessionData.session) finish();
        else setMessage("This recovery link is invalid or expired. Request a new one.");
      });
    }
    const timer = setTimeout(() => {
      if (!cancelled) setMessage("The recovery link could not be verified. Request a new one.");
    }, 15000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      data.subscription.unsubscribe();
    };
  }, []);
  return (
    <main className="mx-auto max-w-lg space-y-4 p-8">
      <h1 className="text-xl font-bold">Password recovery</h1>
      <p role="status">{message}</p>
      <Link className="text-emerald-700 underline" href="/forgot-password">
        Request a new link
      </Link>
    </main>
  );
}
