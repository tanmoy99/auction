"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, MessageCircle, RefreshCw, UserPlus, X } from "lucide-react";
import { toast } from "@/components/toast";
import { Button, Card, Field, Input, Modal, Spinner, TeamDot } from "@/components/ui";
import { DEFAULT_SETTINGS, OVERS_PRESETS, type Match } from "@/lib/fixtures";
import { errorMessage } from "@/lib/format";
import type { GuestPlayer } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { defaultRules } from "@/lib/scoring";
import type { Team, Tournament } from "@/lib/types";

// PIN link for whoever scores this match at the ground
export function ScorerLinkModal({ match, teams, onClose }: { match: Match; teams: Map<string, Team>; onClose: () => void }) {
  const [pin, setPin] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const title = `${teams.get(match.team_a_id ?? "")?.name} v ${teams.get(match.team_b_id ?? "")?.name}`;

  const fetchPin = useCallback(
    async (fresh: boolean) => {
      setBusy(true);
      const { data, error } = await supabase.rpc("scorer_pin", { p_match: match.id, p_new: fresh });
      setBusy(false);
      if (error) return toast(errorMessage(error), "error");
      setPin(data as string);
      if (fresh) toast("New PIN made. The old one no longer works.", "success");
    },
    [match.id],
  );

  useEffect(() => {
    supabase.rpc("scorer_pin", { p_match: match.id, p_new: false }).then(({ data, error }) => {
      if (error) toast(errorMessage(error), "error");
      else setPin(data as string);
    });
  }, [match.id]);

  const link = pin ? `${window.location.origin}/score/${match.id}#pin=${pin}` : "";
  const message = `Scorer link for Match ${match.match_no}: ${title}\n${link}\nPIN: ${pin}\nOnly one phone can score at a time.`;

  return (
    <Modal open onClose={onClose} title={`Scorer for match ${match.match_no}`}>
      {!pin ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Send this to the person scoring <b>{title}</b>. They don&apos;t need an account. The PIN only works for this match.
          </p>
          <div className="rounded-xl bg-slate-50 p-4 text-center ring-1 ring-slate-200">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">PIN</p>
            <p className="text-4xl font-black tracking-[0.4em] text-slate-900">{pin}</p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2">
            <span className="min-w-0 flex-1 truncate text-sm text-slate-600">{link}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigator.clipboard.writeText(message).then(() => toast("Copied", "success"), () => toast("Couldn't copy", "error"))}
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" className="flex-1">
              <Button className="w-full">
                <MessageCircle className="size-4" /> Share on WhatsApp
              </Button>
            </a>
            <Button variant="secondary" onClick={() => fetchPin(true)} loading={busy} title="Stops the old PIN and logs out the current scorer">
              <RefreshCw className="size-4" /> New PIN
            </Button>
          </div>
          <p className="text-xs text-slate-500">Making a new PIN stops the old one and signs out whoever is scoring now.</p>
        </div>
      )}
    </Modal>
  );
}

// Guest players requested by scorers, waiting for the organiser
export function GuestRequests({ tournamentId, teams }: { tournamentId: string; teams: Map<string, Team> }) {
  const [guests, setGuests] = useState<GuestPlayer[]>([]);
  const load = useCallback(
    () =>
      supabase
        .from("guest_players")
        .select("*")
        .eq("tournament_id", tournamentId)
        .eq("status", "pending")
        .order("created_at")
        .then(({ data }) => setGuests((data as GuestPlayer[]) ?? [])),
    [tournamentId],
  );

  useEffect(() => {
    const channel = supabase
      .channel(`guests-${tournamentId}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "guest_players", filter: `tournament_id=eq.${tournamentId}` }, () => load())
      .subscribe((status) => status === "SUBSCRIBED" && load());
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tournamentId, load]);

  async function decide(g: GuestPlayer, status: "approved" | "rejected") {
    const { error } = await supabase.from("guest_players").update({ status }).eq("id", g.id);
    if (error) return toast(errorMessage(error), "error");
    toast(status === "approved" ? `${g.name} approved. The scorer can now pick them.` : `${g.name} rejected`, "success");
    load();
  }

  if (!guests.length) return null;
  return (
    <Card className="border-amber-200 bg-amber-50/50 p-4">
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900">
        <UserPlus className="size-4" /> {guests.length} guest player{guests.length === 1 ? "" : "s"} waiting for your approval
      </p>
      <ul className="divide-y divide-amber-100">
        {guests.map((g) => {
          const team = teams.get(g.team_id);
          return (
            <li key={g.id} className="flex items-center gap-3 py-2">
              <TeamDot color={team?.color ?? "#cbd5e1"} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{g.name}</p>
                <p className="text-xs text-slate-500">
                  {[g.role, `for ${team?.name ?? "team"}`].filter(Boolean).join(" · ")}
                </p>
              </div>
              <Button size="sm" onClick={() => decide(g, "approved")}>
                <Check className="size-4" /> Approve
              </Button>
              <Button size="sm" variant="ghost" onClick={() => decide(g, "rejected")} title="Reject">
                <X className="size-4" />
              </Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// Local rules used by ball-by-ball scoring (wides, no-balls, free hit, overs per bowler)
export function RulesModal({ tournament, onClose, onSaved }: { tournament: Tournament; onClose: () => void; onSaved: () => void }) {
  const settings = tournament.fixture_settings ?? DEFAULT_SETTINGS;
  const [rules, setRules] = useState(() => defaultRules(settings));
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof rules>) => setRules({ ...rules, ...patch });

  async function save() {
    setSaving(true);
    const { overs, wickets, wide_runs, noball_runs, wide_rebowl, noball_rebowl, free_hit, max_bowler_overs } = rules;
    const scoring = { wide_runs, noball_runs, wide_rebowl, noball_rebowl, free_hit, max_bowler_overs };
    const { error } = await supabase
      .from("tournaments")
      .update({ fixture_settings: { ...settings, overs, wickets, scoring } })
      .eq("id", tournament.id);
    setSaving(false);
    if (error) return toast(errorMessage(error), "error");
    toast("Rules saved", "success");
    onSaved();
  }

  const toggle = (key: "wide_rebowl" | "noball_rebowl" | "free_hit", label: string, hint: string) => (
    <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
      <input type="checkbox" checked={rules[key]} onChange={(e) => set({ [key]: e.target.checked })} className="mt-0.5 size-4 accent-emerald-600" />
      <span className="text-sm">
        <span className="font-medium text-slate-800">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
    </label>
  );

  return (
    <Modal open onClose={onClose} title="One-day match rules">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {OVERS_PRESETS.map((p) => (
            <Button
              key={p.overs}
              type="button"
              size="sm"
              variant={rules.overs === p.overs ? "primary" : "secondary"}
              onClick={() => set({ overs: p.overs, max_bowler_overs: p.overs / 5 })}
              title={p.hint}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Overs per side">
            <Input type="number" min={1} max={50} value={rules.overs} onChange={(e) => set({ overs: Number(e.target.value) })} />
          </Field>
          <Field label="All out at (wickets)">
            <Input type="number" min={1} max={20} value={rules.wickets} onChange={(e) => set({ wickets: Number(e.target.value) })} />
          </Field>
          <Field label="Runs for a wide">
            <Input type="number" min={0} max={5} value={rules.wide_runs} onChange={(e) => set({ wide_runs: Number(e.target.value) })} />
          </Field>
          <Field label="Runs for a no-ball">
            <Input type="number" min={0} max={5} value={rules.noball_runs} onChange={(e) => set({ noball_runs: Number(e.target.value) })} />
          </Field>
          <Field label="Max overs per bowler" hint="0 = no limit">
            <Input type="number" min={0} max={50} value={rules.max_bowler_overs} onChange={(e) => set({ max_bowler_overs: Number(e.target.value) })} />
          </Field>
        </div>
        {toggle("wide_rebowl", "Wide is bowled again", "Off = a wide counts as one of the 6 balls")}
        {toggle("noball_rebowl", "No-ball is bowled again", "Off = a no-ball counts as one of the 6 balls")}
        {toggle("free_hit", "Free hit after a no-ball", "Only a run out counts on the next ball")}
        <p className="text-xs text-slate-500">Changes apply to scoring from now on, including matches in progress.</p>
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
