"use client";

import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { fromISTInputs, toISTInputs } from "@/components/fixtures";
import { toast } from "@/components/toast";
import { Button, Field, Input, Modal, Select, TeamDot, cn } from "@/components/ui";
import { ballsToOvers, decideResult, oversToBalls, resolveTeams, type FixtureSettings, type Match, type ResultInput } from "@/lib/fixtures";
import { errorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { Team } from "@/lib/types";

type Kind = "played" | "no_result" | "walkover";

const EMPTY_RESULT = {
  status: "scheduled",
  outcome: null,
  winner_team_id: null,
  batting_first: null,
  a_runs: null,
  a_wickets: null,
  a_balls: null,
  b_runs: null,
  b_wickets: null,
  b_balls: null,
  result_text: null,
} as const;

// After a result changes, move winners / table positions into the knockout matches that depend on them
export async function saveAndAdvance(matches: Match[], id: string, patch: Partial<Match>, settings: FixtureSettings) {
  const { error } = await supabase.from("matches").update(patch).eq("id", id);
  if (error) throw error;
  const updated = matches.map((m) => (m.id === id ? { ...m, ...patch } : m));
  const changes = resolveTeams(updated, settings);
  const results = await Promise.all(changes.map((c) => supabase.from("matches").update({ team_a_id: c.team_a_id, team_b_id: c.team_b_id }).eq("id", c.id)));
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
  return changes.length;
}

function Innings({
  team,
  runs,
  wickets,
  overs,
  onChange,
  maxWickets,
  maxOvers,
}: {
  team?: Team;
  runs: string;
  wickets: string;
  overs: string;
  onChange: (patch: { runs?: string; wickets?: string; overs?: string }) => void;
  maxWickets: number;
  maxOvers: number;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <TeamDot color={team?.color ?? "#cbd5e1"} /> {team?.name}
      </p>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Runs">
          <Input type="number" inputMode="numeric" min={0} value={runs} onChange={(e) => onChange({ runs: e.target.value })} />
        </Field>
        <Field label="Wickets">
          <Input type="number" inputMode="numeric" min={0} max={maxWickets} value={wickets} onChange={(e) => onChange({ wickets: e.target.value })} />
        </Field>
        <Field label="Overs">
          <Input inputMode="decimal" value={overs} onChange={(e) => onChange({ overs: e.target.value })} placeholder={String(maxOvers)} />
        </Field>
      </div>
    </div>
  );
}

export function ResultModal({
  match: m,
  matches,
  teams,
  settings,
  onClose,
  onSaved,
}: {
  match: Match;
  matches: Match[];
  teams: Map<string, Team>;
  settings: FixtureSettings;
  onClose: () => void;
  onSaved: () => void;
}) {
  const knockout = m.stage === "knockout";
  const A = teams.get(m.team_a_id!);
  const B = teams.get(m.team_b_id!);
  const [kind, setKind] = useState<Kind>(m.outcome === "no_result" ? "no_result" : m.outcome === "walkover" ? "walkover" : "played");
  const [first, setFirst] = useState<"a" | "b">(m.batting_first ?? "a");
  const [a, setA] = useState({ runs: m.a_runs?.toString() ?? "", wickets: m.a_wickets?.toString() ?? "", overs: ballsToOvers(m.a_balls) || "" });
  const [b, setB] = useState({ runs: m.b_runs?.toString() ?? "", wickets: m.b_wickets?.toString() ?? "", overs: ballsToOvers(m.b_balls) || "" });
  const [winner, setWinner] = useState<string>(m.winner_team_id ?? "");
  const [saving, setSaving] = useState(false);

  const tied = kind === "played" && a.runs !== "" && a.runs === b.runs;
  const needsWinner = kind === "walkover" || (knockout && (kind === "no_result" || tied));
  const name = (id: string | null) => (id ? (teams.get(id)?.name ?? "Team") : "Team");
  const innings = first === "a" ? [["a", A, a, setA] as const, ["b", B, b, setB] as const] : [["b", B, b, setB] as const, ["a", A, a, setA] as const];

  async function save() {
    let input: ResultInput = {
      outcome: kind === "played" ? "win" : kind,
      batting_first: first,
      a_runs: null,
      a_wickets: null,
      a_balls: null,
      b_runs: null,
      b_wickets: null,
      b_balls: null,
      winner_team_id: winner || null,
    };
    if (kind === "played") {
      const parse = (x: typeof a, label: string) => {
        const runs = Number(x.runs);
        const wickets = x.wickets === "" ? 0 : Number(x.wickets);
        const balls = x.overs === "" ? settings.overs * 6 : oversToBalls(x.overs);
        if (x.runs === "" || !Number.isInteger(runs) || runs < 0) throw new Error(`Enter ${label}'s runs`);
        if (!Number.isInteger(wickets) || wickets < 0 || wickets > settings.wickets) throw new Error(`${label}: wickets must be 0 to ${settings.wickets}`);
        if (balls == null) throw new Error(`${label}: overs like 9.4 (balls after the dot are 0 to 5)`);
        if (balls > settings.overs * 6) throw new Error(`${label}: more than ${settings.overs} overs`);
        return { runs, wickets, balls };
      };
      try {
        const pa = parse(a, A?.name ?? "Team A");
        const pb = parse(b, B?.name ?? "Team B");
        input = { ...input, a_runs: pa.runs, a_wickets: pa.wickets, a_balls: pa.balls, b_runs: pb.runs, b_wickets: pb.wickets, b_balls: pb.balls };
        if (!tied) input.winner_team_id = null;
      } catch (err) {
        return toast((err as Error).message, "error");
      }
    }
    if (needsWinner && !input.winner_team_id) return toast(tied ? "Pick who won the super over" : "Pick the team that goes through", "error");

    const result = decideResult(m, input, settings, name);
    setSaving(true);
    try {
      const moved = await saveAndAdvance(
        matches,
        m.id,
        {
          status: "completed",
          outcome: result.outcome,
          winner_team_id: result.winner,
          batting_first: kind === "played" ? first : null,
          a_runs: input.a_runs,
          a_wickets: input.a_wickets,
          a_balls: input.a_balls,
          b_runs: input.b_runs,
          b_wickets: input.b_wickets,
          b_balls: input.b_balls,
          result_text: result.text,
        },
        settings,
      );
      toast(moved ? `${result.text} · next round updated` : result.text, "success");
      onSaved();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (!confirm("Remove this result? The match goes back to upcoming.")) return;
    setSaving(true);
    try {
      await saveAndAdvance(matches, m.id, { ...EMPTY_RESULT }, settings);
      toast("Result removed", "success");
      onSaved();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Match ${m.match_no} · ${A?.name} v ${B?.name}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["played", "Played"],
              ["no_result", "No result"],
              ["walkover", "Walkover"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm font-medium",
                kind === k ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {kind === "played" && (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">
                Batted first: <span className="font-semibold text-slate-900">{(first === "a" ? A : B)?.name}</span>
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setFirst(first === "a" ? "b" : "a")}>
                <ArrowLeftRight className="size-4" /> Swap
              </Button>
            </div>
            {innings.map(([key, team, value, setter], i) => (
              <div key={key}>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{i === 0 ? "1st innings" : "2nd innings"}</p>
                <Innings
                  team={team}
                  {...value}
                  maxWickets={settings.wickets}
                  maxOvers={settings.overs}
                  onChange={(patch) => setter((prev) => ({ ...prev, ...patch }))}
                />
              </div>
            ))}
            <p className="text-xs text-slate-500">Leave overs empty if they batted all {settings.overs} overs. All out = {settings.wickets} wickets.</p>
          </>
        )}

        {needsWinner && (
          <Field label={tied ? "Scores are level. Who won the super over?" : kind === "walkover" ? "Walkover given to" : "Who goes through? (e.g. better seed, toss)"}>
            <Select value={winner} onChange={(e) => setWinner(e.target.value)}>
              <option value="">Choose team</option>
              {[A, B].map((x) => x && <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
        )}
        {tied && !knockout && !needsWinner && (
          <Field label="Scores are level. Super over winner (optional)">
            <Select value={winner} onChange={(e) => setWinner(e.target.value)}>
              <option value="">No super over (tie, points shared)</option>
              {[A, B].map((x) => x && <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
        )}
        {kind === "no_result" && !knockout && <p className="text-sm text-slate-500">Both teams get {settings.points.no_result} point{settings.points.no_result === 1 ? "" : "s"}.</p>}

        <div className="flex items-center justify-between gap-2 pt-2">
          {m.status === "completed" ? (
            <Button type="button" variant="ghost" onClick={clear} disabled={saving} className="text-rose-600 hover:bg-rose-50">
              Remove result
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={save} loading={saving}>
              Save result
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function EditMatchModal({ match: m, teams, onClose, onSaved }: { match: Match; teams: Team[]; onClose: () => void; onSaved: () => void }) {
  const initial = toISTInputs(m.scheduled_at);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [venue, setVenue] = useState(m.venue ?? "");
  const [teamA, setTeamA] = useState(m.team_a_id ?? "");
  const [teamB, setTeamB] = useState(m.team_b_id ?? "");
  const [saving, setSaving] = useState(false);
  const canChangeTeams = m.stage !== "knockout" && m.status !== "completed";

  async function save() {
    if (canChangeTeams && (!teamA || !teamB || teamA === teamB)) return toast("Pick two different teams", "error");
    setSaving(true);
    const { error } = await supabase
      .from("matches")
      .update({
        scheduled_at: fromISTInputs(date, time),
        venue: venue.trim() || null,
        ...(canChangeTeams ? { team_a_id: teamA, team_b_id: teamB } : {}),
      })
      .eq("id", m.id);
    setSaving(false);
    if (error) return toast(errorMessage(error), "error");
    toast("Match updated", "success");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={`Edit match ${m.match_no}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Time (IST)">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <Field label="Ground / venue">
          <Input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Optional" />
        </Field>
        {canChangeTeams && (
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <Field label="Team">
              <Select value={teamA} onChange={(e) => setTeamA(e.target.value)}>
                {teams.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setTeamA(teamB);
                setTeamB(teamA);
              }}
              title="Swap"
            >
              <ArrowLeftRight className="size-4" />
            </Button>
            <Field label="Opponent">
              <Select value={teamB} onChange={(e) => setTeamB(e.target.value)}>
                {teams.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        {m.stage === "knockout" && <p className="text-xs text-slate-500">Knockout teams fill in by themselves from earlier results.</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={save} loading={saving}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
