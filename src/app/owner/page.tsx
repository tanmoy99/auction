"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Shield } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { Avatar, Card, EmptyState, PageLoader } from "@/components/ui";
import { rupees } from "@/lib/format";
import { useUser } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import type { Team, Tournament } from "@/lib/types";

type Row = Team & { tournaments: Pick<Tournament, "id" | "name" | "status"> };

export default function OwnerHome() {
  const { user, loading } = useUser();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) return router.replace("/login");
    supabase
      .from("teams")
      .select("*, tournaments(id, name, status)")
      .eq("owner_user_id", user.id)
      .then(({ data }) => {
        const list = (data as Row[]) ?? [];
        if (list.length === 1) router.replace(`/bid/${list[0]!.tournament_id}`);
        else setRows(list);
      });
  }, [loading, user, router]);

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
        <h1 className="mb-4 text-xl font-bold text-slate-900">My teams</h1>
        {!rows ? (
          <PageLoader />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Shield className="size-6" />} title="No team linked to this login" text="Ask the organiser to create your team owner login." />
        ) : (
          <div className="space-y-3">
            {rows.map((team) => (
              <Link key={team.id} href={`/bid/${team.tournament_id}`}>
                <Card className="flex items-center gap-3 p-4 hover:border-emerald-300">
                  <Avatar name={team.short_name || team.name} src={team.logo_url} color={team.color} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900">{team.name}</p>
                    <p className="truncate text-sm text-slate-500">
                      {team.tournaments.name} · {rupees(team.purse - team.spent)} left
                    </p>
                  </div>
                  <ChevronRight className="size-5 text-slate-400" />
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
