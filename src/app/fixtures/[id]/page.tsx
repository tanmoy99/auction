"use client";

import { ResourceError } from "@/components/resource-error";
import { QrShare } from "@/components/qr-share";
import { useParams } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { Logo } from "@/components/app-header";
import { FixturesView, formatName } from "@/components/fixtures";
import { Button, EmptyState, PageLoader } from "@/components/ui";
import { useMatches, useTournamentLive } from "@/lib/hooks";

// Public page: schedule, results, points table and knockouts. Updates live.
export default function PublicFixturesPage() {
  const { id } = useParams<{ id: string }>();
  const { tournament: t, teams, loading, error, reload } = useTournamentLive(id);
  const { matches, loading: matchesLoading, error: matchError, reload: reloadMatches } = useMatches(id);

  if (loading || matchesLoading) return <PageLoader />;
  if (error || matchError) return <ResourceError message={error || matchError!} retry={() => { void reload(); void reloadMatches(); }} />;
  if (!t) return <ResourceError message="Tournament not found. Check the link with the organiser." />;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Logo />
          <h1 className="mt-4 text-2xl font-bold text-slate-900">{t.name} · Fixtures</h1>
          <p className="text-sm text-slate-500">{matches.length ? `${formatName(t.fixture_settings)} · updates live` : "Updates live"}</p>
        </div>
        <a href={`/squads/${t.id}`}>
          <Button variant="secondary">Squads</Button>
        </a>
      </div>
      <div className="mb-4"><QrShare path={`/fixtures/${t.id}`} /></div>
      {matches.length ? (
        <FixturesView matches={matches} teams={teams} settings={t.fixture_settings} />
      ) : (
        <EmptyState icon={<CalendarDays className="size-6" />} title="Fixtures coming soon" text="The organiser hasn't published the match schedule yet." />
      )}
    </main>
  );
}
