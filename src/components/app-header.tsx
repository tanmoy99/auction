"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, ShieldCheck } from "lucide-react";
import { APP_NAME } from "@/lib/config";
import { useAccess, useUser } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { Button } from "./ui";

/** Three stumps whose bails curve into an "m", with a ball at the foot. Same shape as src/app/icon.svg. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <rect x="2" y="2" width="96" height="96" rx="24" fill="#059669" />
      <path d="M22 78V40Q32 24 42 40V78M42 40Q52 24 62 40V78" fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="79" cy="72" r="9" fill="#c8102e" />
      <path d="M74 66Q80 72 74 78" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ dark }: { dark?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label={APP_NAME}>
      <LogoMark className="size-8" />
      <span className="text-lg font-extrabold tracking-tight">
        <span className={dark ? "text-white" : "text-slate-900"}>Cric</span>
        <span className={dark ? "text-emerald-400" : "text-emerald-600"}>Mate</span>
      </span>
    </Link>
  );
}

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const { user, isOwner } = useUser();
  const access = useAccess(isOwner ? null : user);
  const router = useRouter();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
        <Logo />
        <div className="flex items-center gap-2">
          {children}
          {user ? (
            <>
              {access?.is_admin && (
                <Link href="/admin" className="flex items-center gap-1 text-sm font-medium text-violet-700 hover:text-violet-900">
                  <ShieldCheck className="size-4" /> Admin
                </Link>
              )}
              <Link href={isOwner ? "/owner" : "/dashboard"} className="hidden text-sm font-medium text-slate-600 hover:text-slate-900 sm:block">
                {isOwner ? "My team" : "My tournaments"}
              </Link>
              <Button variant="ghost" size="sm" onClick={signOut} title="Sign out">
                <LogOut className="size-4" />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </>
          ) : (
            <>
              <Link href="/login" className="text-sm font-medium text-slate-600 hover:text-slate-900">
                Log in
              </Link>
              <Link href="/signup">
                <Button size="sm">Get started</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
