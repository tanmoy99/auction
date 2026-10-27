"use client";

import { useMemo, useState } from "react";
import { Link2, RotateCcw, SlidersHorizontal, Users } from "lucide-react";
import { FixturesView, formatName } from "@/components/fixtures";
import { useTournament } from "@/components/tournament-context";
import { toast } from "@/components/toast";
import { Button, Card, EmptyState, PageLoader } from "@/components/ui";
import { DEFAULT_SETTINGS, type Match } from "@/lib/fixtures";
import { errorMessage } from "@/lib/format";
import { useMatches } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { FixtureGenerator } from "./generator";
import { EditMatchModal, ResultModal } from "./match-modals";
import { GuestRequests, RulesModal, ScorerLinkModal } from "./scoring-admin";

export default function FixturesPage() {
  const { tournament: t, teams, reload: reloadTournament } = useTournament();
  const { matches, loading, reload } = useMatches(t.id);
  const [resultFor, setResultFor] = useState<Match | null>(null);
  const [editing, setEditing] = useState<Match | null>(null);
  const [scorerFor, setScorerFor] = useState<Match | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const teamMap = useMemo(() => new Map(teams.map((x) => [x.id, x])), [teams]);
  const settings = t.fixture_settings ?? DEFAULT_SETTINGS;

  if (loading) return <PageLoader />;
  if (teams.length < 2)
    return <EmptyState icon={<Users className="size-6" />} title="Add teams first" text="You need at least 2 teams to make fixtures." />;
  if (!matches.length)
    return (
      <FixtureGenerator
        tournament={t}
        teams={teams}
        onCreated={() => {
          reload();
          reloadTournament();
        }}
      />
    );

  const played = matches.filter((m) => m.status === "completed").length;

  async function startOver() {
    const warning = played
      ? `This deletes all ${matches.length} matches and ${played} result(s). Type DELETE to confirm.`
      : `Delete all ${matches.length} matches and make new fixtures? Type DELETE to confirm.`;
    if (prompt(warning) !== "DELETE") return;
    const { error } = await supabase.from("matches").delete().eq("tournament_id", t.id);
    if (error) return toast(errorMessage(error), "error");
    toast("Fixtures deleted", "success");
    reload();
  }

  async function copyLink() {
    const url = `${window.location.origin}/fixtures/${t.id}`;
    await navigator.clipboard.writeText(url).catch(() => {});
    toast("Public fixtures link copied. Share it on WhatsApp.", "success");
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="font-semibold text-slate-900">{formatName(t.fixture_settings)}</p>
          <p className="text-sm text-slate-500">
            {matches.length} matches · {played} played · {settings.overs} overs a side
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setRulesOpen(true)}>
            <SlidersHorizontal className="size-4" /> Match rules
          </Button>
          <Button variant="secondary" size="sm" onClick={copyLink}>
            <Link2 className="size-4" /> Share link
          </Button>
          <a href={`/fixtures/${t.id}`} target="_blank">
            <Button variant="secondary" size="sm">
              Public page
            </Button>
          </a>
          <Button variant="ghost" size="sm" onClick={startOver} className="text-rose-600 hover:bg-rose-50">
            <RotateCcw className="size-4" /> Start over
          </Button>
        </div>
      </Card>

      <GuestRequests tournamentId={t.id} teams={teamMap} />

      <FixturesView matches={matches} teams={teams} settings={t.fixture_settings} onResult={setResultFor} onEdit={setEditing} onScorer={setScorerFor} />
      {rulesOpen && (
        <RulesModal
          tournament={t}
          onClose={() => setRulesOpen(false)}
          onSaved={() => {
            setRulesOpen(false);
            reloadTournament();
          }}
        />
      )}
      {scorerFor && <ScorerLinkModal key={scorerFor.id} match={scorerFor} teams={teamMap} onClose={() => setScorerFor(null)} />}

      {resultFor && (
        <ResultModal
          key={resultFor.id}
          match={resultFor}
          matches={matches}
          teams={teamMap}
          settings={settings}
          onClose={() => setResultFor(null)}
          onSaved={() => {
            setResultFor(null);
            reload();
          }}
        />
      )}
      {editing && (
        <EditMatchModal
          key={editing.id}
          match={editing}
          teams={teams}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
