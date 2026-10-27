"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { ArrowLeft, ExternalLink, MonitorPlay, PauseCircle, ShieldCheck } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { TournamentContext } from "@/components/tournament-context";
import { EmptyState, PageLoader, cn } from "@/components/ui";
import { useRequireOrganiser, useTournamentLive } from "@/lib/hooks";

export function TournamentShell({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const { user, access, ready } = useRequireOrganiser();
  const live = useTournamentLive(ready ? id : undefined);
  const { tournament, players } = live;

  const pending = players.filter((p) => p.status === "pending").length;
  const tabs = [
    { href: `/t/${id}`, label: "Overview" },
    { href: `/t/${id}/players`, label: "Players", badge: pending },
    { href: `/t/${id}/teams`, label: "Teams" },
    { href: `/t/${id}/auction`, label: "Live auction" },
    { href: `/t/${id}/registration`, label: "Registration" },
    { href: `/t/${id}/settings`, label: "Settings" },
  ];

  let body: React.ReactNode;
  if (!ready || live.loading) body = <PageLoader />;
  else if (!tournament || (tournament.organiser_id !== user?.id && !access?.is_admin))
    body = (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <EmptyState icon={<ArrowLeft className="size-6" />} title="Tournament not found" text="It may have been deleted, or it belongs to another organiser." />
      </div>
    );
  else if (!access?.is_admin && (!access?.active || tournament.suspended))
    body = (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <EmptyState
          icon={<PauseCircle className="size-6" />}
          title={tournament.suspended ? "This tournament is paused" : "Your account is paused"}
          text={`${(tournament.suspended ? tournament.suspended_reason : access?.suspended_reason) || "The site admin has paused access."} Please contact the site admin to continue.`}
          action={
            <Link href="/dashboard" className="text-sm font-medium text-emerald-700 hover:underline">
              Back to my tournaments
            </Link>
          }
        />
      </div>
    );
  else
    body = (
      <TournamentContext.Provider value={{ ...live, tournament }}>
        <div className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 pt-5">
            <Link
              href={tournament.organiser_id === user?.id ? "/dashboard" : "/admin"}
              className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
            >
              <ArrowLeft className="size-4" /> {tournament.organiser_id === user?.id ? "All tournaments" : "Admin dashboard"}
            </Link>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-900">{tournament.name}</h1>
                {tournament.organiser_id !== user?.id && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                    <ShieldCheck className="size-3.5" /> Admin view
                  </span>
                )}
                {tournament.suspended && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    <PauseCircle className="size-3.5" /> Paused
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <a
                  href={`/live/${id}`}
                  target="_blank"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800"
                >
                  <MonitorPlay className="size-4" /> Big screen
                </a>
                <a
                  href={`/squads/${id}`}
                  target="_blank"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <ExternalLink className="size-4" /> Squads
                </a>
              </div>
            </div>
            <nav className="-mb-px mt-4 flex gap-1 overflow-x-auto">
              {tabs.map((tab) => {
                const active = pathname === tab.href;
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                      active ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-800",
                    )}
                  >
                    {tab.label}
                    {!!tab.badge && <span className="rounded-full bg-amber-100 px-1.5 text-xs text-amber-700">{tab.badge}</span>}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      </TournamentContext.Provider>
    );

  return (
    <>
      <AppHeader />
      {body}
    </>
  );
}
