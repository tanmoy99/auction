"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Gavel, LogOut } from "lucide-react";
import { APP_NAME } from "@/lib/config";
import { useUser } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { Button, cn } from "./ui";

export function Logo({ dark }: { dark?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
        <Gavel className="size-4.5" />
      </span>
      <span className={cn("text-lg font-bold tracking-tight", dark ? "text-white" : "text-slate-900")}>{APP_NAME}</span>
    </Link>
  );
}

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const { user, isOwner } = useUser();
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
