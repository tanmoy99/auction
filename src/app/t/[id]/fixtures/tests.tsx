"use client";

import { useMemo, useState } from "react";
import { Link2, Plus, SlidersHorizontal, Swords } from "lucide-react";
import { MatchDays, TestTable, fromISTInputs } from "@/components/fixtures";
import { toast } from "@/components/toast";
import { Button, Card, EmptyState, Field, Input, Modal, Select } from "@/components/ui";
import { TEST_POINTS, testSeries, type FixtureSettings, type Match } from "@/lib/fixtures";
import { errorMessage } from "@/lib/format";
import { followOnLead, matchRules } from "@/lib/scoring";
import { supabase } from "@/lib/supabase";
import type { Team, Tournament } from "@/lib/types";

// Organiser: multi-day Test matches, kept apart from the one-day fixtures and points table
export function TestMatches({
  tournament: t,
  teams,
  matches,
  settings,
  reload,
  reloadTournament,
  onEdit,
  onScorer,
}: {
  tournament: Tournament;
  teams: Team[];
  matches: Match[];
  settings: FixtureSettings;
  reload: () => void;
  reloadTournament: () => void;
  onEdit: (m: Match) => void;
  onScorer: (m: Match) => void;
}) {
  const tests = useMemo(() => matches.filter((m) => m.match_type === "test"), [matches]);
  const teamMap = useMemo(() => new Map(teams.map((x) => [x.id, x])), [teams]);
  const byNo = useMemo(() => new Map(matches.map((m) => [m.match_no, m])), [matches]);
  const [adding, setAdding] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [resultFor, setResultFor] = useState<Match | null>(null);
  const played = tests.filter((m) => m.status === "completed").length;

  async function copyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/fixtures/${t.id}`).catch(() => {});
    toast("Public fixtures link copied. Share it on WhatsApp.", "success");
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="font-semibold text-slate-900">Test matches</p>
          <p className="text-sm text-slate-500">
            {tests.length ? `${tests.length} Tests · ${played} played · ` : ""}2 innings a side, 1 to 5 days, declarations, follow-on and draws
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add Test / series
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setRulesOpen(true)}>
            <SlidersHorizontal className="size-4" /> Test rules
          </Button>
          {tests.length > 0 && (
            <Button variant="secondary" size="sm" onClick={copyLink}>
              <Link2 className="size-4" /> Share link
            </Button>
          )}
        </div>
      </Card>

      {tests.length === 0 ? (
        <EmptyState
          icon={<Swords className="size-6" />}
          title="No Test matches yet"
          text="Add a single Test or a series between two teams. Score them ball by ball, day by day, just like one-day matches."
          action={
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Add Test / series
            </Button>
          }
        />
      ) : (
        <>
          <TestTable matches={tests} teams={teamMap} />
          <MatchDays matches={tests} teams={teamMap} byNo={byNo} settings={settings} onResult={setResultFor} onEdit={onEdit} onScorer={onScorer} />
        </>
      )}

      {adding && (
        <AddTestModal
          tournament={t}
          teams={teams}
          nextNo={Math.max(0, ...matches.map((m) => m.match_no)) + 1}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
      {rulesOpen && (
        <TestRulesModal
          tournament={t}
          settings={settings}
          onClose={() => setRulesOpen(false)}
          onSaved={() => {
            setRulesOpen(false);
            reloadTournament();
          }}
        />
      )}
      {resultFor && (
        <TestResultModal
          key={resultFor.id}
          match={resultFor}
          teams={teamMap}
          onClose={() => setResultFor(null)}
          onSaved={() => {
            setResultFor(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function AddTestModal({ tournament: t, teams, nextNo, onClose, onSaved }: { tournament: Tournament; teams: Team[]; nextNo: number; onClose: () => void; onSaved: () => void }) {
  const [teamA, setTeamA] = useState(teams[0]?.id ?? "");
  const [teamB, setTeamB] = useState(teams[1]?.id ?? "");
  const [count, setCount] = useState(1);
  const [days, setDays] = useState(5);
  const [date, setDate] = useState(t.starts_on ?? "");
  const [time, setTime] = useState("09:30");
  const [venue, setVenue] = useState(t.venue ?? "");
  const [alternate, setAlternate] = useState(true);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!teamA || !teamB || teamA === teamB) return toast("Pick two different teams", "error");
    setSaving(true);
    const rows = testSeries({ teamA, teamB, count, days, start: fromISTInputs(date, time), venue: venue.trim() || null, firstNo: nextNo, alternateHome: alternate }).map(
      (m) => ({ ...m, tournament_id: t.id }),
    );
    const { error } = await supabase.from("matches").insert(rows);
    setSaving(false);
    if (error) return toast(errorMessage(error), "error");
    toast(count > 1 ? `${count}-Test series added` : "Test match added", "success");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title="Add Test match or series">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Team">
            <Select value={teamA} onChange={(e) => setTeamA(e.target.value)}>
              {teams.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Opponent">
            <Select value={teamB} onChange={(e) => setTeamB(e.target.value)}>
              {teams.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Number of Tests" hint="More than 1 makes a series">
            <Select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "1 (single Test)" : `${n}-match series`}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Days per Test" hint={`Follow-on at a ${followOnLead(days)}-run lead`}>
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} day{n > 1 ? "s" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="First day">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Start time (IST)">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <Field label="Ground / venue">
          <Input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Optional" />
        </Field>
        {count > 1 && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={alternate} onChange={(e) => setAlternate(e.target.checked)} className="size-4 accent-emerald-600" />
            Swap home and away in every other Test
          </label>
        )}
        <p className="text-xs text-slate-500">Each Test in a series starts the day after the previous one is due to finish.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Add {count > 1 ? "series" : "Test"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function TestRulesModal({ tournament, settings, onClose, onSaved }: { tournament: Tournament; settings: FixtureSettings; onClose: () => void; onSaved: () => void }) {
  const base = matchRules(settings, { match_type: "test", days: 5 });
  const [wickets, setWickets] = useState(base.wickets);
  const [perDay, setPerDay] = useState(base.overs_per_day);
  const [wide, setWide] = useState(base.wide_runs);
  const [noball, setNoball] = useState(base.noball_runs);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const test = { wickets, overs_per_day: perDay, wide_runs: wide, noball_runs: noball };
    const { error } = await supabase.from("tournaments").update({ fixture_settings: { ...settings, test } }).eq("id", tournament.id);
    setSaving(false);
    if (error) return toast(errorMessage(error), "error");
    toast("Test rules saved", "success");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title="Test match rules">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="All out at (wickets)">
            <Input type="number" min={1} max={20} value={wickets} onChange={(e) => setWickets(Number(e.target.value))} />
          </Field>
          <Field label="Overs per day" hint="0 = don't count">
            <Input type="number" min={0} max={120} value={perDay} onChange={(e) => setPerDay(Number(e.target.value))} />
          </Field>
          <Field label="Runs for a wide">
            <Input type="number" min={0} max={5} value={wide} onChange={(e) => setWide(Number(e.target.value))} />
          </Field>
          <Field label="Runs for a no-ball">
            <Input type="number" min={0} max={5} value={noball} onChange={(e) => setNoball(Number(e.target.value))} />
          </Field>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500">
          <li>Two innings a side with no overs limit and no limit on overs per bowler. No free hits.</li>
          <li>Declare, stumps, lunch / tea / drinks and &quot;end as a draw&quot; are in the scorer&apos;s menu.</li>
          <li>Follow-on lead: 200 runs (5 days), 150 (3-4 days), 100 (2 days), 75 (1 day).</li>
          <li>
            Test table points: win {TEST_POINTS.win}, tie {TEST_POINTS.tie}, draw {TEST_POINTS.draw}.
          </li>
        </ul>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Save rules
          </Button>
        </div>
      </div>
    </Modal>
  );
}

type TestOutcome = "win" | "draw" | "tie" | "no_result" | "walkover";

// Enter a Test result by hand (when it wasn't scored ball by ball)
function TestResultModal({ match: m, teams, onClose, onSaved }: { match: Match; teams: Map<string, Team>; onClose: () => void; onSaved: () => void }) {
  const A = teams.get(m.team_a_id!);
  const B = teams.get(m.team_b_id!);
  const [outcome, setOutcome] = useState<TestOutcome>((m.outcome as TestOutcome) ?? "win");
  const [winner, setWinner] = useState(m.winner_team_id ?? m.team_a_id ?? "");
  const [margin, setMargin] = useState("");
  const [saving, setSaving] = useState(false);
  const name = (id: string) => teams.get(id)?.name ?? "Team";
  const needsWinner = outcome === "win" || outcome === "walkover";
  const text =
    outcome === "draw"
      ? "Match drawn"
      : outcome === "tie"
        ? "Match tied"
        : outcome === "no_result"
          ? "No result"
          : outcome === "walkover"
            ? `${name(winner)} won by walkover`
            : `${name(winner)} won${margin.trim() ? ` ${margin.trim().replace(/^won\s+/i, "")}` : ""}`;

  async function save(clear = false) {
    if (!clear && needsWinner && !winner) return toast("Pick the winner", "error");
    setSaving(true);
    const patch = clear
      ? { status: "scheduled", outcome: null, winner_team_id: null, result_text: null, innings: null, live_score: null }
      : { status: "completed", outcome, winner_team_id: needsWinner ? winner : null, result_text: text, live_score: null };
    const { error } = await supabase.from("matches").update(patch).eq("id", m.id);
    setSaving(false);
    if (error) return toast(errorMessage(error), "error");
    toast(clear ? "Result removed" : text, "success");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={`${m.round_name} · ${A?.name} v ${B?.name}`}>
      <div className="space-y-4">
        <Field label="Result">
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value as TestOutcome)}>
            <option value="win">Won</option>
            <option value="draw">Drawn</option>
            <option value="tie">Tied</option>
            <option value="no_result">No result (abandoned)</option>
            <option value="walkover">Walkover</option>
          </Select>
        </Field>
        {needsWinner && (
          <Field label="Winner">
            <Select value={winner} onChange={(e) => setWinner(e.target.value)}>
              {[m.team_a_id, m.team_b_id].map((id) => (
                <option key={id} value={id!}>
                  {name(id!)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {outcome === "win" && (
          <Field label="Margin (optional)" hint='e.g. "by an innings and 20 runs", "by 6 wickets"'>
            <Input value={margin} onChange={(e) => setMargin(e.target.value)} placeholder="by 45 runs" />
          </Field>
        )}
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800">{text}</p>
        <div className="flex flex-wrap justify-between gap-2">
          {m.status === "completed" ? (
            <Button variant="ghost" className="text-rose-600 hover:bg-rose-50" onClick={() => confirm("Remove this result?") && save(true)} disabled={saving}>
              Remove result
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => save()} loading={saving}>
              Save result
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
