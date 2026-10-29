"use client";

import { useState } from "react";
import { ArrowLeftRight, Flag, Undo2 } from "lucide-react";
import { breakText, type Scoreboard } from "@/components/scorecard";
import { toast } from "@/components/toast";
import { Button, Card, Field, Modal, Select, TeamDot, cn } from "@/components/ui";
import { decideResult, resolveTeams, type FixtureSettings, type Match } from "@/lib/fixtures";
import { supabase } from "@/lib/supabase";
import {
  WICKET_KINDS,
  availableBatters,
  availableBowlers,
  ballsText,
  canEnforceFollowOn,
  inningsSummary,
  matchStats,
  nextBattingTeam,
  resultScores,
  testResult,
  type EventData,
  type Extra,
  type WicketKind,
} from "@/lib/scoring";

type Send = (data: EventData) => Promise<void>;

export function TossPanel({ match, board, send }: { match: Match; board: Scoreboard; send: Send }) {
  const [winner, setWinner] = useState("");
  const [decision, setDecision] = useState<"bat" | "bowl" | "">("");
  const teams = [match.team_a_id, match.team_b_id].map((id) => board.team(id)).filter(Boolean);
  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-lg font-bold text-slate-900">Toss</h2>
      <Field label="Who won the toss?">
        <div className="grid grid-cols-2 gap-2">
          {teams.map((t) => (
            <Choice key={t!.id} active={winner === t!.id} onClick={() => setWinner(t!.id)}>
              <TeamDot color={t!.color} /> {t!.name}
            </Choice>
          ))}
        </div>
      </Field>
      <Field label="They chose to">
        <div className="grid grid-cols-2 gap-2">
          <Choice active={decision === "bat"} onClick={() => setDecision("bat")}>
            Bat first
          </Choice>
          <Choice active={decision === "bowl"} onClick={() => setDecision("bowl")}>
            Bowl first
          </Choice>
        </div>
      </Field>
      <Button size="lg" className="w-full" disabled={!winner || !decision} onClick={() => send({ type: "toss", winner, decision: decision as "bat" | "bowl" })}>
        Save toss
      </Button>
    </Card>
  );
}

function Choice({ active, onClick, children, disabled }: { active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition disabled:opacity-40",
        active ? "border-emerald-500 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-500" : "border-slate-200 text-slate-700",
      )}
    >
      {children}
    </button>
  );
}

const ORDINAL = ["1st", "2nd", "3rd", "4th"];

export function OpenersPanel({ match, board, send }: { match: Match; board: Scoreboard; send: Send }) {
  // Tests: after both first innings, the side ahead by enough may make the other bat again
  const followOnChoice = canEnforceFollowOn(board.state, board.rules);
  const [followOn, setFollowOn] = useState(false);
  const batting = nextBattingTeam(board.state, match.team_a_id!, match.team_b_id!, followOnChoice && followOn);
  const bowling = batting === match.team_a_id ? match.team_b_id! : match.team_a_id!;
  const [striker, setStriker] = useState("");
  const [nonStriker, setNonStriker] = useState("");
  const [bowler, setBowler] = useState("");
  const bat = board.lineups[batting] ?? [];
  const bowl = board.lineups[bowling] ?? [];
  const number = board.state.innings.length + 1;
  const chasing = number === board.rules.innings_per_side * 2;
  const leader = board.state.innings[0];
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-lg font-bold text-slate-900">{ORDINAL[number - 1]} innings</h2>
        <p className="text-sm text-slate-500">
          {board.team(batting)?.name} bat{chasing && board.state.target ? ` · target ${board.state.target}` : ""}
        </p>
      </div>
      {followOnChoice && leader && (
        <Field label={`${board.team(leader.batting_team)?.name} lead by ${leader.runs - board.state.innings[1]!.runs}. Enforce the follow-on?`}>
          <div className="grid grid-cols-2 gap-2">
            <Choice
              active={!followOn}
              onClick={() => {
                setFollowOn(false);
                setStriker("");
                setNonStriker("");
                setBowler("");
              }}
            >
              No, bat again
            </Choice>
            <Choice
              active={followOn}
              onClick={() => {
                setFollowOn(true);
                setStriker("");
                setNonStriker("");
                setBowler("");
              }}
            >
              Yes, they follow on
            </Choice>
          </div>
        </Field>
      )}
      <Field label="On strike">
        <Select value={striker} onChange={(e) => setStriker(e.target.value)}>
          <option value="">Choose batter</option>
          {bat.map((id) => (
            <option key={id} value={id} disabled={id === nonStriker}>
              {board.label(id)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Non-striker">
        <Select value={nonStriker} onChange={(e) => setNonStriker(e.target.value)}>
          <option value="">Choose batter</option>
          {bat.map((id) => (
            <option key={id} value={id} disabled={id === striker}>
              {board.label(id)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={`Opening bowler (${board.team(bowling)?.name})`}>
        <Select value={bowler} onChange={(e) => setBowler(e.target.value)}>
          <option value="">Choose bowler</option>
          {bowl.map((id) => (
            <option key={id} value={id}>
              {board.label(id)}
            </option>
          ))}
        </Select>
      </Field>
      <Button
        size="lg"
        className="w-full"
        disabled={!striker || !nonStriker || !bowler}
        onClick={() =>
          send({
            type: "innings_start",
            batting_team: batting,
            bowling_team: bowling,
            striker,
            non_striker: nonStriker,
            bowler,
            ...(followOnChoice && followOn ? { follow_on: true } : {}),
          })
        }
      >
        Start innings
      </Button>
    </Card>
  );
}

export function PickPanel({ kind, board, send }: { kind: "batter" | "bowler"; board: Scoreboard; send: Send }) {
  const inn = board.state.current!;
  if (kind === "batter") {
    const list = availableBatters(inn, board.lineups[inn.batting_team] ?? []);
    return (
      <Card className="p-5">
        <h2 className="mb-3 text-lg font-bold text-slate-900">Next batter</h2>
        {list.length === 0 && <p className="text-sm text-slate-500">No batters left. Add players from the menu, or end the innings.</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          {list.map((id) => (
            <Button key={id} variant="secondary" size="lg" onClick={() => send({ type: "new_batter", player: id })}>
              {board.label(id)}
              {inn.batters.find((b) => b.id === id)?.retired && " (returning)"}
            </Button>
          ))}
        </div>
      </Card>
    );
  }
  const list = availableBowlers(inn, board.lineups[inn.bowling_team] ?? [], board.rules);
  return (
    <Card className="p-5">
      <h2 className="text-lg font-bold text-slate-900">Over {Math.floor(inn.legal_balls / 6) + 1} · who bowls?</h2>
      <p className="mb-3 text-sm text-slate-500">{board.rules.max_bowler_overs ? `Max ${board.rules.max_bowler_overs} overs each` : "No overs limit"}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {list.map((b) => (
          <Button
            key={b.id}
            variant="secondary"
            size="lg"
            disabled={!!b.reason}
            onClick={() => send({ type: "new_bowler", player: b.id })}
            className="flex-col items-start! gap-0!"
          >
            <span>{board.label(b.id)}</span>
            <span className="text-xs font-normal text-slate-500">{b.reason ?? `${b.overs} overs`}</span>
          </Button>
        ))}
      </div>
    </Card>
  );
}

export function ScoringPad({ board, send, undo, canUndo }: { board: Scoreboard; send: Send; undo: () => void; canUndo: boolean }) {
  const [extra, setExtra] = useState<Extra | null>(null);
  const [wicketOpen, setWicketOpen] = useState(false);
  const inn = board.state.current!;

  function runs(n: number) {
    // on byes / leg byes / wides the runs are extras; on a no-ball they are off the bat
    if (extra === "b" || extra === "lb") {
      if (n === 0) return toast("Byes need at least 1 run", "info");
      send({ type: "ball", runs: 0, extra, extra_runs: n, wicket: null });
    } else if (extra === "wd") send({ type: "ball", runs: 0, extra, extra_runs: n, wicket: null });
    else send({ type: "ball", runs: n, extra, extra_runs: 0, wicket: null });
    setExtra(null);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        {(
          [
            ["wd", "Wide"],
            ["nb", "No ball"],
            ["b", "Bye"],
            ["lb", "Leg bye"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setExtra(extra === key ? null : key)}
            className={cn(
              "rounded-xl border py-3 text-sm font-semibold transition",
              extra === key ? "border-amber-500 bg-amber-400 text-amber-950" : "border-slate-200 bg-white text-slate-700",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {extra && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-center text-sm text-amber-900">
          {extra === "wd" ? "Wide: tap runs they ran (0 if none)" : extra === "nb" ? "No ball: tap runs off the bat" : "Tap how many byes they ran"}
        </p>
      )}
      <div className="grid grid-cols-4 gap-2">
        {[0, 1, 2, 3, 4, 6, 5].map((n) => (
          <button
            key={n}
            onClick={() => runs(n)}
            className={cn(
              "h-16 rounded-2xl text-2xl font-black shadow-sm transition active:scale-95",
              n === 4 ? "bg-sky-600 text-white" : n === 6 ? "bg-violet-600 text-white" : n === 0 ? "bg-slate-100 text-slate-500" : "bg-white text-slate-900 ring-1 ring-slate-200",
            )}
          >
            {n === 0 ? "•" : n}
          </button>
        ))}
        <button onClick={() => setWicketOpen(true)} className="h-16 rounded-2xl bg-rose-600 text-lg font-black text-white shadow-sm active:scale-95">
          OUT
        </button>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={undo} disabled={!canUndo}>
          <Undo2 className="size-4" /> Undo
        </Button>
        <Button variant="secondary" className="flex-1" onClick={() => send({ type: "swap" })}>
          <ArrowLeftRight className="size-4" /> Swap strike
        </Button>
      </div>
      {wicketOpen && (
        <WicketModal
          board={board}
          extra={extra}
          freeHit={inn.free_hit}
          onClose={() => setWicketOpen(false)}
          onSave={(data) => {
            setWicketOpen(false);
            setExtra(null);
            send(data);
          }}
        />
      )}
    </div>
  );
}

function WicketModal({
  board,
  extra,
  freeHit,
  onClose,
  onSave,
}: {
  board: Scoreboard;
  extra: Extra | null;
  freeHit: boolean;
  onClose: () => void;
  onSave: (data: EventData) => void;
}) {
  const inn = board.state.current!;
  const [kind, setKind] = useState<WicketKind | "">("");
  const [out, setOut] = useState(inn.striker ?? "");
  const [fielder, setFielder] = useState("");
  const [ranRuns, setRanRuns] = useState(0);
  const info = WICKET_KINDS.find((k) => k.key === kind);
  // only a run out can happen on a no-ball or free hit; a wide allows stumped and run out
  const allowed = WICKET_KINDS.filter((k) => (extra === "nb" || freeHit ? k.key === "run_out" : extra === "wd" ? k.key === "run_out" || k.key === "stumped" : true));
  const fielders = board.lineups[inn.bowling_team] ?? [];

  function save() {
    if (!kind) return toast("Pick how they got out", "error");
    if (info?.fielder && kind !== "run_out" && !fielder) return toast(kind === "stumped" ? "Pick the keeper" : "Pick the fielder", "error");
    const isBye = extra === "b" || extra === "lb" || extra === "wd";
    onSave({
      type: "ball",
      runs: isBye ? 0 : kind === "run_out" ? ranRuns : 0,
      extra,
      extra_runs: isBye ? ranRuns : 0,
      wicket: { kind, out: kind === "run_out" ? out : inn.striker!, fielder: fielder || null },
    });
  }

  return (
    <Modal open onClose={onClose} title="Wicket">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {allowed.map((k) => (
            <Choice key={k.key} active={kind === k.key} onClick={() => setKind(k.key)}>
              {k.label}
            </Choice>
          ))}
        </div>
        {kind === "run_out" && (
          <>
            <Field label="Who is out?">
              <div className="grid grid-cols-2 gap-2">
                {[inn.striker, inn.non_striker].map((id) => (
                  <Choice key={id} active={out === id} onClick={() => setOut(id!)}>
                    {board.label(id)}
                  </Choice>
                ))}
              </div>
            </Field>
            <Field label="Runs completed before the run out">
              <div className="grid grid-cols-4 gap-2">
                {[0, 1, 2, 3].map((n) => (
                  <Choice key={n} active={ranRuns === n} onClick={() => setRanRuns(n)}>
                    {n}
                  </Choice>
                ))}
              </div>
            </Field>
          </>
        )}
        {info?.fielder && (
          <Field label={kind === "stumped" ? "Wicket-keeper" : kind === "run_out" ? "Fielder (optional)" : "Caught by"}>
            <Select value={fielder} onChange={(e) => setFielder(e.target.value)}>
              <option value="">Choose player</option>
              {fielders.map((id) => (
                <option key={id} value={id}>
                  {board.label(id)}
                  {id === inn.bowler ? " (bowler)" : ""}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {freeHit && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Free hit: only a run out counts.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={save}>
            Save wicket
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function InningsBreak({ board, onStart }: { board: Scoreboard; onStart: () => void }) {
  const last = board.state.current!;
  const test = board.rules.format === "test";
  return (
    <Card className="space-y-3 p-5 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{test ? `End of ${ORDINAL[last.number - 1]} innings` : "Innings break"}</p>
      <p className="text-3xl font-black text-slate-900">
        {board.team(last.batting_team)?.name} {last.runs}/{last.wickets}
        {test && last.end_reason === "declared" ? "d" : ""}
      </p>
      <p className="text-slate-600">
        {ballsText(last.legal_balls)} overs · <span className="font-bold text-slate-900">{test ? breakText(board) : `target ${board.state.target}`}</span>
      </p>
      <Button size="lg" className="w-full" onClick={onStart}>
        Start {ORDINAL[last.number]} innings
      </Button>
    </Card>
  );
}

// Last step: result, knockout progress and player stats saved together
export function FinishPanel({
  match,
  board,
  settings,
  call,
  noResult,
}: {
  match: Match;
  board: Scoreboard;
  settings: FixtureSettings;
  call: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  noResult?: boolean;
}) {
  const [winner, setWinner] = useState("");
  const [saving, setSaving] = useState(false);
  const knockout = match.stage === "knockout";
  const name = (id: string | null) => board.team(id)?.name ?? "Team";
  const test = board.rules.format === "test";
  const scores = resultScores(board.state, match.team_a_id!);
  const tied = !test && !noResult && !!scores && scores.a_runs === scores.b_runs;
  const result =
    noResult || !scores
      ? decideResult(match, { outcome: "no_result", batting_first: "a", a_runs: null, a_wickets: null, a_balls: null, b_runs: null, b_wickets: null, b_balls: null, winner_team_id: winner || null }, board.rules, name)
      : test
        ? testResult(board.state, board.rules, board.lineups, name)
        : decideResult(match, { outcome: "win", winner_team_id: tied ? winner || null : null, ...scores }, board.rules, name);
  const needsWinner = knockout && !test && (tied || noResult) && !winner;

  async function finish() {
    if (needsWinner) return toast(tied ? "Pick who won the super over" : "Pick the team that goes through", "error");
    setSaving(true);
    const { data: all } = await supabase.from("matches").select("*").eq("tournament_id", match.tournament_id);
    const patch = {
      status: "completed" as const,
      outcome: result.outcome,
      winner_team_id: result.winner,
      batting_first: noResult ? null : (scores?.batting_first ?? null),
      a_runs: noResult ? null : (scores?.a_runs ?? null),
      a_wickets: noResult ? null : (scores?.a_wickets ?? null),
      a_balls: noResult ? null : (scores?.a_balls ?? null),
      b_runs: noResult ? null : (scores?.b_runs ?? null),
      b_wickets: noResult ? null : (scores?.b_wickets ?? null),
      b_balls: noResult ? null : (scores?.b_balls ?? null),
      result_text: result.text,
      innings: test && !noResult ? inningsSummary(board.state) : null,
    };
    const updated = ((all as Match[]) ?? []).map((m) => (m.id === match.id ? { ...m, ...patch } : m));
    const ok = await call("scorer_finish", {
      p_result: patch,
      p_changes: resolveTeams(updated, settings),
      p_stats: matchStats(board.state, board.lineups),
    });
    setSaving(false);
    if (ok) toast("Match finished. Fixtures, table and stats updated.", "success");
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="text-center">
        <Flag className="mx-auto size-8 text-emerald-600" />
        <p className="mt-2 text-xl font-black text-slate-900">{result.text}</p>
      </div>
      {!test && (tied || (noResult && knockout)) && (
        <Field label={tied ? (knockout ? "Scores level. Who won the super over?" : "Scores level. Super over winner (optional)") : "Who goes through?"}>
          <Select value={winner} onChange={(e) => setWinner(e.target.value)}>
            <option value="">{tied && !knockout ? "No super over (tie)" : "Choose team"}</option>
            {[match.team_a_id, match.team_b_id].map((id) => (
              <option key={id} value={id!}>
                {name(id)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Button size="lg" className="w-full" onClick={finish} loading={saving}>
        Finish match & save stats
      </Button>
      <p className="text-center text-xs text-slate-500">You can still undo the last ball before finishing.</p>
    </Card>
  );
}
