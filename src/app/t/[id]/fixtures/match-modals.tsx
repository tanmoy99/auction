"use client";

import { useState } from "react";
import { ArrowLeftRight, RotateCcw } from "lucide-react";
import { fromISTInputs, toISTInputs } from "@/components/fixtures";
import { toast } from "@/components/toast";
import { Button, Field, Input, Modal, Select, TeamDot, cn } from "@/components/ui";
import {
  ballsToOvers,
  decideResult,
  handMadeMatch,
  handMadeProblem,
  oversToBalls,
  resolveTeams,
  type FixtureSettings,
  type Match,
  type ResultInput,
} from "@/lib/fixtures";
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

// Later matches that take a team from this match's result ("winner of match 4")
function dependents(m: Match, matches: Match[]) {
  const uses = (src: Match["a_source"]) => (src?.type === "winner" || src?.type === "loser") && src.match === m.match_no;
  return matches.filter((d) => d.id !== m.id && (uses(d.a_source) || uses(d.b_source)));
}

export function EditMatchModal({
  match: m,
  teams,
  matches,
  settings,
  onClose,
  onSaved,
}: {
  match: Match;
  teams: Team[];
  matches: Match[];
  settings: FixtureSettings;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initial = toISTInputs(m.scheduled_at);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [venue, setVenue] = useState(m.venue ?? "");
  const [teamA, setTeamA] = useState(m.team_a_id ?? "");
  const [teamB, setTeamB] = useState(m.team_b_id ?? "");
  const [days, setDays] = useState(m.days ?? 5);
  const [saving, setSaving] = useState(false);
  // a hand-made knockout keeps its own teams; other knockouts fill in from earlier results
  const handMadeKnockout = m.stage === "knockout" && m.a_source?.type === "team" && m.b_source?.type === "team";
  const canChangeTeams = (m.stage !== "knockout" || handMadeKnockout) && m.status !== "completed";
  const test = m.match_type === "test";
  const started = m.status !== "scheduled";
  const label = test ? m.round_name : `match ${m.match_no}`;

  async function remove() {
    const users = dependents(m, matches);
    if (users.length) return toast(`Match ${users[0]!.match_no} takes a team from this match. Delete or change that match first`, "error");
    if (!confirm(`Delete ${label}?${started ? " Its score, balls and stats are deleted too." : ""} This can't be undone.`)) return;
    setSaving(true);
    const { error } = await supabase.from("matches").delete().eq("id", m.id);
    setSaving(false);
    if (error) return toast(errorMessage(error), "error");
    toast(test ? "Test deleted" : "Match deleted", "success");
    onSaved();
  }

  // back to "not started": toss, balls, result and stats go; the playing XIs stay
  async function restart() {
    const typed = prompt(
      `Restart ${label}? The toss, every ball, the result and the player stats of this match are deleted, and it goes back to "not started". The playing XIs are kept. Type RESTART to confirm.`,
    );
    if (typed?.trim().toUpperCase() !== "RESTART") return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("restart_match", { p_match: m.id });
      if (error) throw error;
      // knockout places decided by the points table may change too
      const updated = matches.map((x) => (x.id === m.id ? { ...x, ...EMPTY_RESULT } : x));
      const changes = resolveTeams(updated, settings);
      await Promise.all(changes.map((c) => supabase.from("matches").update({ team_a_id: c.team_a_id, team_b_id: c.team_b_id }).eq("id", c.id)));
      toast(`${test ? m.round_name : `Match ${m.match_no}`} restarted. Score it again from the start.`, "success");
      onSaved();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    const problem = canChangeTeams ? handMadeProblem(teamA, teamB) : null;
    if (problem) return toast(problem, "error");
    setSaving(true);
    const teamsPatch = !canChangeTeams
      ? {}
      : { team_a_id: teamA, team_b_id: teamB, ...(handMadeKnockout ? { a_source: { type: "team", team_id: teamA }, b_source: { type: "team", team_id: teamB } } : {}) };
    const { error } = await supabase
      .from("matches")
      .update({
        scheduled_at: fromISTInputs(date, time),
        venue: venue.trim() || null,
        ...teamsPatch,
        ...(test && m.status === "scheduled" ? { days } : {}),
      })
      .eq("id", m.id);
    setSaving(false);
    if (error) return toast(errorMessage(error), "error");
    toast("Match updated", "success");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={test ? `Edit ${m.round_name}` : `Edit match ${m.match_no}`}>
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
        {test && m.status === "scheduled" && (
          <Field label="Days">
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} day{n > 1 ? "s" : ""}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {m.stage === "knockout" && !handMadeKnockout && <p className="text-xs text-slate-500">Knockout teams fill in by themselves from earlier results.</p>}
        {started && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-900">Started by mistake, or wrong toss / batting side?</p>
            <p className="mt-0.5 text-xs text-amber-800">
              Restart this match: the toss, balls, result and stats are cleared and it goes back to &quot;not started&quot;. The playing XIs are kept.
            </p>
            <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={restart} disabled={saving}>
              <RotateCcw className="size-4" /> Restart match
            </Button>
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-2">
          <Button type="button" variant="ghost" className="text-rose-600 hover:bg-rose-50" onClick={remove} disabled={saving}>
            {test ? "Delete Test" : "Delete match"}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={save} loading={saving}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// One extra match, made by hand (any fixture format)
export function AddMatchModal({
  tournamentId,
  teams,
  matches,
  defaults,
  onClose,
  onSaved,
}: {
  tournamentId: string;
  teams: Team[];
  matches: Match[];
  defaults: { date: string; venue: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const nextNo = Math.max(0, ...matches.map((x) => x.match_no)) + 1;
  const [teamA, setTeamA] = useState(teams[0]?.id ?? "");
  const [teamB, setTeamB] = useState(teams[1]?.id ?? "");
  const [date, setDate] = useState(defaults.date);
  const [time, setTime] = useState("09:00");
  const [venue, setVenue] = useState(defaults.venue);
  const [name, setName] = useState("");
  const [knockout, setKnockout] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    const problem = handMadeProblem(teamA, teamB);
    if (problem) return toast(problem, "error");
    setSaving(true);
    const { error } = await supabase.from("matches").insert({
      ...handMadeMatch(nextNo, teamA, teamB, name, knockout),
      tournament_id: tournamentId,
      scheduled_at: fromISTInputs(date, time),
      venue: venue.trim() || null,
    });
    setSaving(false);
    if (error) return toast(errorMessage(error), "error");
    toast(`Match ${nextNo} added`, "success");
    onSaved();
  }

  const teamSelect = (value: string, onChange: (v: string) => void) => (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {teams.map((x) => (
        <option key={x.id} value={x.id}>
          {x.name}
        </option>
      ))}
    </Select>
  );

  return (
    <Modal open onClose={onClose} title={`Add match ${nextNo}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Team">{teamSelect(teamA, setTeamA)}</Field>
          <Field label="Opponent">{teamSelect(teamB, setTeamB)}</Field>
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
        <Field label="Match name" hint={`Optional, e.g. Final, Semi-final 1. Empty = "Match ${nextNo}"`}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </Field>
        <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
          <input type="checkbox" checked={knockout} onChange={(e) => setKnockout(e.target.checked)} className="mt-0.5 size-4 accent-emerald-600" />
          <span className="text-sm">
            <span className="font-medium text-slate-800">Knockout match</span>
            <span className="block text-xs text-slate-500">Not counted in the points table (for a final, semi-final or playoff)</span>
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={save} loading={saving}>
            Add match
          </Button>
        </div>
      </div>
    </Modal>
  );
}
