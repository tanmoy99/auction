"use client";

import { useMemo, useState } from "react";
import { CalendarDays, GitFork, ListOrdered, Shuffle, Table2 } from "lucide-react";
import { matchDay, matchTime } from "@/components/fixtures";
import { toast } from "@/components/toast";
import { Button, Card, Field, Input, TeamDot, cn } from "@/components/ui";
import {
  DEFAULT_SETTINGS,
  GROUP_NAMES,
  dealGroups,
  generateFixtures,
  playoffTeams,
  sourceLabel,
  validateSettings,
  type FixtureFormat,
  type FixtureSettings,
  type Playoff,
} from "@/lib/fixtures";
import { errorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { Team, Tournament } from "@/lib/types";

const FORMATS: { key: FixtureFormat; title: string; text: string; icon: typeof Table2 }[] = [
  { key: "league", title: "League", text: "Everyone plays everyone, points table, then optional playoffs (like IPL)", icon: Table2 },
  { key: "groups", title: "Groups + knockout", text: "Teams split into groups, top teams of each group play knockouts", icon: ListOrdered },
  { key: "knockout", title: "Knockout", text: "Lose and you're out. Byes are added when the team count needs them", icon: GitFork },
];

const PLAYOFFS: { key: Playoff; label: string; hint: string }[] = [
  { key: "none", label: "No playoffs", hint: "Table topper wins" },
  { key: "final", label: "Final", hint: "Top 2 play the final" },
  { key: "semis", label: "Semi-finals", hint: "1 v 4, 2 v 3, then final" },
  { key: "ipl", label: "IPL style", hint: "Qualifier 1, Eliminator, Qualifier 2, Final" },
  { key: "quarters", label: "Quarter-finals", hint: "Top 8, then semis and final" },
];

function Choice<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { key: T; label: string; hint?: string; disabled?: boolean }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          disabled={o.disabled}
          onClick={() => onChange(o.key)}
          className={cn(
            "rounded-lg border px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40",
            value === o.key ? "border-emerald-500 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-500" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
          )}
        >
          <span className="font-medium">{o.label}</span>
          {o.hint && <span className="block text-xs text-slate-500">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

function shuffled<T>(list: T[]) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export function FixtureGenerator({ tournament: t, teams, onCreated }: { tournament: Tournament; teams: Team[]; onCreated: () => void }) {
  const [s, setS] = useState<FixtureSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...t.fixture_settings,
    playoff: teams.length >= 4 ? "ipl" : teams.length >= 2 ? "final" : "none",
    schedule: { ...DEFAULT_SETTINGS.schedule, start_date: t.starts_on ?? "", venue: t.venue ?? "" },
  }));
  const [order, setOrder] = useState(() => teams.map((x) => x.id));
  const [saving, setSaving] = useState(false);
  const teamById = useMemo(() => new Map(teams.map((x) => [x.id, x])), [teams]);
  const set = (patch: Partial<FixtureSettings>) => setS({ ...s, ...patch });
  const setSchedule = (patch: Partial<FixtureSettings["schedule"]>) => setS({ ...s, schedule: { ...s.schedule, ...patch } });

  const maxGroups = Math.max(2, Math.floor(teams.length / 2));
  const groups = useMemo(
    () => (s.format === "groups" ? dealGroups(order, Math.min(s.groups, maxGroups)) : undefined),
    [s.format, s.groups, order, maxGroups],
  );
  const problem = validateSettings(s, teams.length, groups);
  const preview = useMemo(() => (problem ? [] : generateFixtures(s, order, groups)), [problem, s, order, groups]);
  const byNo = useMemo(() => new Map(preview.map((m) => [m.match_no, m])), [preview]);
  const days = new Set(preview.map((m) => matchDay(m.scheduled_at))).size;
  const stageCount = preview.filter((m) => m.stage !== "knockout").length;

  async function create() {
    if (problem) return toast(problem, "error");
    setSaving(true);
    try {
      const { error: e1 } = await supabase.from("tournaments").update({ fixture_settings: s }).eq("id", t.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("matches").insert(preview.map((m) => ({ ...m, tournament_id: t.id })));
      if (e2) throw e2;
      toast(`${preview.length} matches created`, "success");
      onCreated();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  const name = (id: string | null) => (id ? (teamById.get(id)?.name ?? "?") : null);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <Card className="p-5">
          <h2 className="font-semibold text-slate-900">1. Choose a format</h2>
          <p className="mb-4 text-sm text-slate-500">{teams.length} teams. You can start over later if you change your mind.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {FORMATS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => set({ format: f.key })}
                className={cn(
                  "rounded-xl border p-4 text-left transition",
                  s.format === f.key ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500" : "border-slate-200 hover:bg-slate-50",
                )}
              >
                <f.icon className={cn("size-6", s.format === f.key ? "text-emerald-600" : "text-slate-400")} />
                <p className="mt-2 font-semibold text-slate-900">{f.title}</p>
                <p className="mt-1 text-xs text-slate-500">{f.text}</p>
              </button>
            ))}
          </div>
        </Card>

        <Card className="space-y-5 p-5">
          <h2 className="font-semibold text-slate-900">2. Format options</h2>

          {s.format !== "knockout" && (
            <Field label={s.format === "groups" ? "Inside each group, teams play each other" : "Teams play each other"}>
              <Choice
                value={s.legs}
                onChange={(legs) => set({ legs })}
                options={[
                  { key: 1, label: "Once", hint: "Single round" },
                  { key: 2, label: "Twice", hint: "Home and away, like IPL" },
                ]}
              />
            </Field>
          )}

          {s.format === "league" && (
            <Field label="After the league">
              <Choice
                value={s.playoff}
                onChange={(playoff) => set({ playoff })}
                options={PLAYOFFS.map((p) => ({ ...p, disabled: teams.length < playoffTeams(p.key) }))}
              />
            </Field>
          )}

          {s.format === "groups" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Number of groups">
                  <Choice
                    value={Math.min(s.groups, maxGroups)}
                    onChange={(n) => set({ groups: n, qualify: Math.min(s.qualify, Math.floor(teams.length / n)) || 1 })}
                    options={Array.from({ length: Math.min(maxGroups, 8) - 1 }, (_, i) => ({ key: i + 2, label: String(i + 2) }))}
                  />
                </Field>
                <Field label="Teams from each group to knockouts">
                  <Choice
                    value={s.qualify}
                    onChange={(qualify) => set({ qualify })}
                    options={[1, 2, 3, 4]
                      .filter((n) => n <= Math.min(...(groups ?? [[]]).map((g) => g.length)))
                      .map((n) => ({ key: n, label: n === 1 ? "Winner" : `Top ${n}` }))}
                  />
                </Field>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-700">Group draw</p>
                  <Button type="button" variant="secondary" size="sm" onClick={() => setOrder(shuffled(order))}>
                    <Shuffle className="size-4" /> Shuffle draw
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {groups?.map((g, i) => (
                    <div key={i} className="rounded-lg border border-slate-200 p-2.5">
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Group {GROUP_NAMES[i]}</p>
                      {g.map((id) => (
                        <p key={id} className="flex items-center gap-1.5 truncate text-sm text-slate-800">
                          <TeamDot color={teamById.get(id)?.color ?? "#cbd5e1"} /> {teamById.get(id)?.name}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {s.format === "knockout" && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700">Seeding (seed 1 and 2 can only meet in the final)</p>
                <Button type="button" variant="secondary" size="sm" onClick={() => setOrder(shuffled(order))}>
                  <Shuffle className="size-4" /> Random draw
                </Button>
              </div>
              <ol className="grid gap-1 sm:grid-cols-2">
                {order.map((id, i) => (
                  <li key={id} className="flex items-center gap-2 text-sm text-slate-800">
                    <span className="w-6 text-right text-xs tabular-nums text-slate-400">{i + 1}</span>
                    <TeamDot color={teamById.get(id)?.color ?? "#cbd5e1"} /> {teamById.get(id)?.name}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-5">
            <Field label="Overs per side">
              <Input type="number" min={1} max={50} value={s.overs} onChange={(e) => set({ overs: Number(e.target.value) })} />
            </Field>
            <Field label="All out at (wkts)">
              <Input type="number" min={1} max={20} value={s.wickets} onChange={(e) => set({ wickets: Number(e.target.value) })} />
            </Field>
            {s.format !== "knockout" && (
              <>
                <Field label="Points: win">
                  <Input type="number" min={0} value={s.points.win} onChange={(e) => set({ points: { ...s.points, win: Number(e.target.value) } })} />
                </Field>
                <Field label="Tie">
                  <Input type="number" min={0} value={s.points.tie} onChange={(e) => set({ points: { ...s.points, tie: Number(e.target.value) } })} />
                </Field>
                <Field label="No result">
                  <Input type="number" min={0} value={s.points.no_result} onChange={(e) => set({ points: { ...s.points, no_result: Number(e.target.value) } })} />
                </Field>
              </>
            )}
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="font-semibold text-slate-900">3. Schedule</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="First match day">
              <Input type="date" value={s.schedule.start_date} onChange={(e) => setSchedule({ start_date: e.target.value })} required />
            </Field>
            <Field label="First match time">
              <Input type="time" value={s.schedule.first_time} onChange={(e) => setSchedule({ first_time: e.target.value })} />
            </Field>
            <Field label="Ground / venue">
              <Input value={s.schedule.venue} onChange={(e) => setSchedule({ venue: e.target.value })} placeholder="Optional" />
            </Field>
            <Field label="Matches per day">
              <Input type="number" min={1} max={12} value={s.schedule.per_day} onChange={(e) => setSchedule({ per_day: Number(e.target.value) })} />
            </Field>
            <Field label="Minutes between match starts" hint={`${Math.floor(s.schedule.gap_minutes / 60)}h ${s.schedule.gap_minutes % 60}m per match`}>
              <Input type="number" min={15} step={15} value={s.schedule.gap_minutes} onChange={(e) => setSchedule({ gap_minutes: Number(e.target.value) })} />
            </Field>
            {s.format !== "knockout" && (
              <label className="flex items-center gap-2 self-center text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={s.schedule.knockouts_new_day}
                  onChange={(e) => setSchedule({ knockouts_new_day: e.target.checked })}
                  className="size-4 accent-emerald-600"
                />
                Start knockouts on a new day
              </label>
            )}
          </div>
          <p className="text-xs text-slate-500">You can change the date, time or ground of any match afterwards.</p>
        </Card>
      </div>

      <div>
        <Card className="sticky top-20 p-5">
          <h2 className="font-semibold text-slate-900">Preview</h2>
          {problem ? (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{problem}</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-slate-600">
                <span className="text-2xl font-bold text-slate-900">{preview.length}</span> matches over {days} day{days === 1 ? "" : "s"}
              </p>
              <p className="text-xs text-slate-500">
                {stageCount > 0 && `${stageCount} ${s.format === "groups" ? "group" : "league"} matches`}
                {stageCount > 0 && preview.length > stageCount && " + "}
                {preview.length > stageCount && `${preview.length - stageCount} knockout`}
              </p>
              <ul className="mt-4 max-h-[50vh] space-y-1.5 overflow-y-auto pr-1 text-xs">
                {preview.map((m) => (
                  <li key={m.match_no} className={cn("rounded-md px-2 py-1.5", m.stage === "knockout" ? "bg-amber-50" : "bg-slate-50")}>
                    <span className="flex justify-between gap-2 text-slate-400">
                      <span>
                        #{m.match_no} {m.stage !== "league" && m.round_name}
                      </span>
                      <span className="flex items-center gap-1">
                        <CalendarDays className="size-3" />
                        {m.scheduled_at && new Date(m.scheduled_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })} {matchTime(m.scheduled_at)}
                      </span>
                    </span>
                    <span className="font-medium text-slate-700">
                      {name(m.team_a_id) ?? sourceLabel(m.a_source, byNo)} v {name(m.team_b_id) ?? sourceLabel(m.b_source, byNo)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <Button className="mt-4 w-full" size="lg" onClick={create} loading={saving} disabled={!!problem}>
            Create fixtures
          </Button>
        </Card>
      </div>
    </div>
  );
}
