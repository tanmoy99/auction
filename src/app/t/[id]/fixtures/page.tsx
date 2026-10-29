"use client";

import { useMemo, useState } from "react";
import { Link2, RotateCcw, SlidersHorizontal, Users } from "lucide-react";
import { FixturesView, formatName } from "@/components/fixtures";
import { useTournament } from "@/components/tournament-context";
import { toast } from "@/components/toast";
import { Button, Card, EmptyState, PageLoader, cn } from "@/components/ui";
import { DEFAULT_SETTINGS, OVERS_PRESETS, isTest, type Match } from "@/lib/fixtures";
import { errorMessage } from "@/lib/format";
import { useMatches } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { FixtureGenerator } from "./generator";
import { EditMatchModal, ResultModal } from "./match-modals";
import { GuestRequests, RulesModal, ScorerLinkModal } from "./scoring-admin";
import { TestMatches } from "./tests";

type Section = "oneday" | "test";

export default function FixturesPage() {
  const { tournament: t, teams, reload: reloadTournament } = useTournament();
  const { matches: all, loading, reload } = useMatches(t.id);
  const [resultFor, setResultFor] = useState<Match | null>(null);
  const [editing, setEditing] = useState<Match | null>(null);
  const [scorerFor, setScorerFor] = useState<Match | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [picked, setSection] = useState<Section | null>(null);
  const teamMap = useMemo(() => new Map(teams.map((x) => [x.id, x])), [teams]);
  const settings = t.fixture_settings ?? DEFAULT_SETTINGS;
  const matches = useMemo(() => all.filter((m) => !isTest(m)), [all]);
  const tests = all.length - matches.length;
  const section: Section = picked ?? (!matches.length && tests ? "test" : "oneday");

  if (loading) return <PageLoader />;
  if (teams.length < 2)
    return <EmptyState icon={<Users className="size-6" />} title="Add teams first" text="You need at least 2 teams to make fixtures." />;

  const played = matches.filter((m) => m.status === "completed").length;
  const preset = OVERS_PRESETS.find((p) => p.overs === settings.overs)?.label;

  async function startOver() {
    const warning = played
      ? `This deletes all ${matches.length} one-day matches and ${played} result(s). Test matches stay. Type DELETE to confirm.`
      : `Delete all ${matches.length} one-day matches and make new fixtures? Test matches stay. Type DELETE to confirm.`;
    if (prompt(warning) !== "DELETE") return;
    const { error } = await supabase.from("matches").delete().eq("tournament_id", t.id).eq("match_type", "limited");
    if (error) return toast(errorMessage(error), "error");
    toast("Fixtures deleted", "success");
    reload();
  }

  async function copyLink() {
    const url = `${window.location.origin}/fixtures/${t.id}`;
    await navigator.clipboard.writeText(url).catch(() => {});
    toast("Public fixtures link copied. Share it on WhatsApp.", "success");
  }

  const tabs: { key: Section; label: string; hint: string }[] = [
    { key: "oneday", label: "One-day", hint: "T10 · T20 · 50 overs" },
    { key: "test", label: "Test matches", hint: "Multi-day, 2 innings" },
  ];

  return (
    <div className="space-y-4">
      <nav className="grid grid-cols-2 gap-2 sm:inline-grid sm:grid-cols-[auto_auto]">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSection(tab.key)}
            className={cn(
              "rounded-xl border px-4 py-2 text-left transition",
              section === tab.key ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500" : "border-slate-200 bg-white hover:bg-slate-50",
            )}
          >
            <span className={cn("block text-sm font-semibold", section === tab.key ? "text-emerald-800" : "text-slate-800")}>
              {tab.label}
              <span className="ml-1.5 font-normal text-slate-400">{tab.key === "oneday" ? matches.length : tests}</span>
            </span>
            <span className="block text-xs text-slate-500">{tab.hint}</span>
          </button>
        ))}
      </nav>

      <GuestRequests tournamentId={t.id} teams={teamMap} />

      {section === "test" ? (
        <TestMatches
          tournament={t}
          teams={teams}
          matches={all}
          settings={settings}
          reload={reload}
          reloadTournament={reloadTournament}
          onEdit={setEditing}
          onScorer={setScorerFor}
        />
      ) : !matches.length ? (
        <FixtureGenerator
          tournament={t}
          teams={teams}
          onCreated={() => {
            reload();
            reloadTournament();
          }}
        />
      ) : (
        <>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-semibold text-slate-900">{formatName(t.fixture_settings)}</p>
              <p className="text-sm text-slate-500">
                {matches.length} matches · {played} played · {preset ? `${preset} · ` : ""}
                {settings.overs} overs a side
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

          <FixturesView matches={matches} teams={teams} settings={t.fixture_settings} onResult={setResultFor} onEdit={setEditing} onScorer={setScorerFor} />
        </>
      )}

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
