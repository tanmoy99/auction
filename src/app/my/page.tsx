"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ExternalLink, UserRound } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { CareerView, type Career } from "@/components/player-career";
import { ResourceError } from "@/components/resource-error";
import { Card, EmptyState, PageLoader } from "@/components/ui";
import { useUser } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";

type Upcoming = {
  match_id: string;
  tournament: string;
  match_no: number;
  round_name: string | null;
  scheduled_at: string | null;
  venue: string | null;
  status: "scheduled" | "live";
  team_a: string | null;
  team_b: string | null;
};

// "My CricMitra": a logged-in player's own stats, tournaments and next matches (migration 020)
export default function MyCricket() {
  const { user, loading, isPlayer } = useUser();
  const router = useRouter();
  const [career, setCareer] = useState<(Career & { upcoming: Upcoming[] }) | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error } = await supabase.rpc("my_player_career");
    if (error) return setError("Your stats couldn't be loaded. Check your connection and try again.");
    setCareer((data as (Career & { upcoming: Upcoming[] }) | null) ?? null);
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) return router.replace("/login");
    if (!isPlayer) return router.replace(user.app_metadata?.role === "owner" ? "/owner" : "/dashboard");
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [loading, user, isPlayer, router, load]);

  if (error) return <ResourceError message={error} retry={load} />;
  if (career === undefined) return <PageLoader />;
  return (
    <>
      <AppHeader />
      {career ? (
        <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-6">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600">My CricMitra</p>
            <Link href={`/player/${career.profile.id}`} className="flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-emerald-700">
              Public profile <ExternalLink className="size-3.5" />
            </Link>
          </div>
          <CareerView career={career}>
            <Card className="overflow-hidden">
              <h2 className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">
                <CalendarDays className="size-4 text-emerald-600" /> My next matches
              </h2>
              {career.upcoming.length ? (
                <ul className="divide-y divide-slate-100 text-sm">
                  {career.upcoming.map((m) => (
                    <li key={m.match_id}>
                      <Link href={`/match/${m.match_id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-slate-900">
                            {m.team_a ?? "TBD"} v {m.team_b ?? "TBD"}
                          </span>
                          <span className="block truncate text-xs text-slate-500">
                            {m.tournament} · Match {m.match_no}
                            {m.scheduled_at &&
                              ` · ${new Date(m.scheduled_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`}
                            {m.venue && ` · ${m.venue}`}
                          </span>
                        </span>
                        {m.status === "live" && <span className="rounded-full bg-rose-600 px-2 py-0.5 text-xs font-bold text-white">LIVE</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-5 text-center text-sm text-slate-500">No upcoming matches for your teams yet. Fixtures appear here once the organiser makes them.</p>
              )}
            </Card>
          </CareerView>
        </main>
      ) : (
        <EmptyState
          icon={<UserRound className="size-6" />}
          title="No tournaments to show"
          text="Your player login works, but none of your tournaments are active right now. Ask your organiser if you think this is wrong."
        />
      )}
    </>
  );
}
