"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { useTournament } from "@/components/tournament-context";
import { toast } from "@/components/toast";
import { Button, Card, Field, Input } from "@/components/ui";
import { errorMessage, rupees } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { AUCTION_STATUS, type Slab } from "@/lib/types";

export default function SettingsPage() {
  const { tournament: t, teams } = useTournament();
  const router = useRouter();
  const [form, setForm] = useState({
    name: t.name,
    venue: t.venue ?? "",
    starts_on: t.starts_on ?? "",
    team_budget: String(t.team_budget),
    base_price: String(t.base_price),
    min_squad: String(t.min_squad),
    max_squad: String(t.max_squad),
    bid_timer_seconds: String(t.bid_timer_seconds),
    result_pause_seconds: String(t.result_pause_seconds),
  });
  const [slabs, setSlabs] = useState<Slab[]>(t.increment_slabs);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [key]: e.target.value });

  function setSlab(i: number, patch: Partial<Slab>) {
    setSlabs(slabs.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const budget = Number(form.team_budget);
    if (Number(form.min_squad) > Number(form.max_squad)) return toast("Min squad can't be more than max squad", "error");
    const cleanSlabs = slabs
      .map((s, i) => ({ upto: i === slabs.length - 1 ? null : s.upto, step: s.step }))
      .filter((s) => s.step > 0);
    for (let i = 1; i < cleanSlabs.length - 1; i++) {
      if ((cleanSlabs[i]!.upto ?? 0) <= (cleanSlabs[i - 1]!.upto ?? 0)) return toast("Increment slabs must go up in order", "error");
    }

    const budgetChanged = budget !== t.team_budget && teams.length > 0;
    if (budgetChanged && teams.some((team) => team.spent > budget)) {
      return toast("Some teams have already spent more than the new budget", "error");
    }
    const applyToTeams = budgetChanged && confirm(`Also set every team's purse to ${rupees(budget)}?`);

    setSaving(true);
    try {
      const { error } = await supabase
        .from("tournaments")
        .update({
          name: form.name.trim(),
          venue: form.venue.trim() || null,
          starts_on: form.starts_on || null,
          team_budget: budget,
          base_price: Number(form.base_price),
          min_squad: Number(form.min_squad),
          max_squad: Number(form.max_squad),
          bid_timer_seconds: Number(form.bid_timer_seconds),
          result_pause_seconds: Number(form.result_pause_seconds),
          increment_slabs: cleanSlabs,
        })
        .eq("id", t.id);
      if (error) throw error;
      if (applyToTeams) {
        const { error: teamError } = await supabase.from("teams").update({ purse: budget }).eq("tournament_id", t.id);
        if (teamError) throw teamError;
      }
      setSlabs(cleanSlabs);
      toast("Settings saved", "success");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function resetAuction() {
    if (prompt('This releases every sold player, refunds all teams and clears bids. Type "RESET" to confirm.') !== "RESET") return;
    const { error } = await supabase.rpc("reset_auction", { p_tournament: t.id });
    if (error) toast(errorMessage(error), "error");
    else toast("Auction reset", "success");
  }

  async function deleteTournament() {
    if (prompt(`This deletes the tournament, all players and teams. Type the tournament name "${t.name}" to confirm.`) !== t.name) return;
    const { error } = await supabase.from("tournaments").delete().eq("id", t.id);
    if (error) return toast(errorMessage(error), "error");
    toast("Tournament deleted", "success");
    router.push("/dashboard");
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-3xl space-y-6">
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold text-slate-900">Tournament</h2>
        <Field label="Name">
          <Input value={form.name} onChange={set("name")} required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Venue">
            <Input value={form.venue} onChange={set("venue")} />
          </Field>
          <Field label="Start date">
            <Input type="date" value={form.starts_on} onChange={set("starts_on")} />
          </Field>
          <Field label="Auction status" hint="Start or finish it from the Live auction tab">
            <Link
              href={`/t/${t.id}/auction`}
              className="flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 hover:border-emerald-300"
            >
              {AUCTION_STATUS[t.status]}
            </Link>
          </Field>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="font-semibold text-slate-900">Auction rules</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Budget per team (Rs)">
            <Input type="number" min={1} value={form.team_budget} onChange={set("team_budget")} required />
          </Field>
          <Field label="Default base price (Rs)" hint="Used for new players and the purse reserve rule">
            <Input type="number" min={1} value={form.base_price} onChange={set("base_price")} required />
          </Field>
          <Field label="Min squad size" hint="Teams must keep enough money to reach this">
            <Input type="number" min={0} value={form.min_squad} onChange={set("min_squad")} required />
          </Field>
          <Field label="Max squad size">
            <Input type="number" min={1} value={form.max_squad} onChange={set("max_squad")} required />
          </Field>
          <Field label="Bid timer (seconds)" hint="Resets after every bid. 0 = no timer, auctioneer closes manually">
            <Input type="number" min={0} max={600} value={form.bid_timer_seconds} onChange={set("bid_timer_seconds")} required />
          </Field>
          <Field label="Pause after SOLD / UNSOLD (seconds)" hint="How long the result stays on screen before the next player comes up automatically">
            <Input type="number" min={2} max={60} value={form.result_pause_seconds} onChange={set("result_pause_seconds")} required />
          </Field>
        </div>

        <div>
          <p className="text-sm font-medium text-slate-700">Bid increments</p>
          <p className="mb-3 text-xs text-slate-500">How much each new bid adds, depending on the current bid.</p>
          <div className="space-y-2">
            {slabs.map((s, i) => {
              const last = i === slabs.length - 1;
              const from = i === 0 ? 0 : slabs[i - 1]!.upto ?? 0;
              return (
                <div key={i} className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                  <span className="w-40">{last ? `From ${rupees(from)} and above` : `From ${rupees(from)} up to`}</span>
                  {!last && (
                    <Input
                      type="number"
                      min={1}
                      value={s.upto ?? ""}
                      onChange={(e) => setSlab(i, { upto: Number(e.target.value) })}
                      className="w-32"
                      required
                    />
                  )}
                  <span>add</span>
                  <Input type="number" min={1} value={s.step} onChange={(e) => setSlab(i, { step: Number(e.target.value) })} className="w-28" required />
                  {slabs.length > 1 && (
                    <button type="button" onClick={() => setSlabs(slabs.filter((_, j) => j !== i))} className="p-1.5 text-slate-400 hover:text-rose-600">
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => {
              const prev = slabs.at(-2)?.upto ?? 0;
              const copy = slabs.slice();
              copy.splice(slabs.length - 1, 0, { upto: prev + 10000, step: slabs.at(-1)?.step ?? 500 });
              setSlabs(copy);
            }}
          >
            <Plus className="size-4" /> Add slab
          </Button>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" loading={saving}>
          Save settings
        </Button>
      </div>

      <Card className="border-rose-200 p-5">
        <h2 className="font-semibold text-rose-700">Danger zone</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button type="button" variant="secondary" onClick={resetAuction}>
            Reset auction results
          </Button>
          <Button type="button" variant="danger" onClick={deleteTournament}>
            Delete tournament
          </Button>
        </div>
      </Card>
    </form>
  );
}
