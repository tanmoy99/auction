"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Gavel, MapPin, PauseCircle, Plus, Smartphone, Trophy, UserPlus, Users, UserRound } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { toast } from "@/components/toast";
import { Button, Card, EmptyState, Field, Input, Modal, PageLoader, cn } from "@/components/ui";
import { errorMessage, rupees } from "@/lib/format";
import { useRequireOrganiser } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import type { Tournament } from "@/lib/types";

type Row = Tournament & { teams: { count: number }[]; players: { count: number }[] };

const statusLabel = {
  setup: { text: "Setting up", cls: "bg-slate-100 text-slate-700" },
  live: { text: "Live", cls: "bg-rose-100 text-rose-700" },
  completed: { text: "Completed", cls: "bg-emerald-100 text-emerald-700" },
};

export default function DashboardPage() {
  const { user, access, ready } = useRequireOrganiser();
  const paused = !!access && !access.active;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!ready || !user) return;
    supabase
      .from("tournaments")
      .select("*, teams(count), players(count)")
      .eq("organiser_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => setRows((data as Row[]) ?? []));
  }, [ready, user]);

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">My tournaments</h1>
            <p className="text-sm text-slate-500">Create a tournament, then add players and teams.</p>
          </div>
          <Button onClick={() => setCreating(true)} disabled={paused}>
            <Plus className="size-4" /> New tournament
          </Button>
        </div>

        {paused && (
          <div className="mb-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <PauseCircle className="size-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-semibold">Your account is paused</p>
              <p className="mt-0.5">
                {access.suspended_reason ||
                  (access.access_until && !access.suspended
                    ? `Your access ended on ${new Date(access.access_until).toLocaleDateString("en-IN", { dateStyle: "medium" })}.`
                    : "The site admin has paused access.")}{" "}
                You can&apos;t create or run tournaments until the site admin turns it back on.
              </p>
            </div>
          </div>
        )}

        {!rows ? (
          <PageLoader />
        ) : rows.length === 0 ? (
          <div className="space-y-6">
            <EmptyState
              icon={<Trophy className="size-6" />}
              title="No tournaments yet"
              text="Create your first tournament to start registering players and teams."
              action={
                <Button onClick={() => setCreating(true)} disabled={paused}>
                  <Plus className="size-4" /> New tournament
                </Button>
              }
            />
            <HowItWorks />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((t) => (
              <Link key={t.id} href={`/t/${t.id}`}>
                <Card className="h-full p-5 transition hover:border-emerald-300 hover:shadow-md">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold text-slate-900">{t.name}</h2>
                    {t.suspended ? (
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Paused</span>
                    ) : (
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", statusLabel[t.status].cls)}>
                        {statusLabel[t.status].text}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 space-y-1.5 text-sm text-slate-500">
                    {t.venue && (
                      <p className="flex items-center gap-1.5">
                        <MapPin className="size-4" /> {t.venue}
                      </p>
                    )}
                    {t.starts_on && (
                      <p className="flex items-center gap-1.5">
                        <CalendarDays className="size-4" /> {new Date(t.starts_on).toLocaleDateString("en-IN", { dateStyle: "medium" })}
                      </p>
                    )}
                  </div>
                  <div className="mt-4 flex gap-4 border-t border-slate-100 pt-4 text-sm">
                    <span className="flex items-center gap-1.5 text-slate-700">
                      <Users className="size-4 text-slate-400" /> {t.teams[0]?.count ?? 0} teams
                    </span>
                    <span className="flex items-center gap-1.5 text-slate-700">
                      <UserRound className="size-4 text-slate-400" /> {t.players[0]?.count ?? 0} players
                    </span>
                    <span className="ml-auto text-slate-500">{rupees(t.team_budget)}</span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
      <CreateTournamentModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

const HOW_IT_WORKS = [
  { icon: Trophy, title: "Create a tournament", text: "Name, venue, team budget, base price and squad size. You can change these later in Settings." },
  { icon: Users, title: "Add teams and owner logins", text: "Each team owner gets a login ID and password to send on WhatsApp." },
  { icon: UserPlus, title: "Add players", text: "Import Excel or Google Sheet, or share a registration link. Approve the ones who sign up." },
  { icon: Gavel, title: "Start the auction", text: "Bring players one by one on the Big screen. Then finish it to lock the squads." },
  { icon: Smartphone, title: "Owners bid from phones", text: "Live bids, timer, and purse limits are handled for you. The highest bid wins the player." },
  { icon: CalendarDays, title: "Fixtures and scoring", text: "After the auction, make the fixtures and score matches ball by ball." },
];

// First-time help for a new organiser
function HowItWorks() {
  return (
    <Card className="p-5">
      <h2 className="font-semibold text-slate-900">How it works</h2>
      <ol className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {HOW_IT_WORKS.map((step, i) => (
          <li key={step.title} className="flex gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">{i + 1}</span>
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <step.icon className="size-4 text-slate-400" /> {step.title}
              </p>
              <p className="mt-0.5 text-sm text-slate-500">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function CreateTournamentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    venue: "",
    starts_on: "",
    team_budget: "50000",
    base_price: "500",
    min_squad: "11",
    max_squad: "15",
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { data, error } = await supabase
      .from("tournaments")
      .insert({
        name: form.name.trim(),
        venue: form.venue.trim() || null,
        starts_on: form.starts_on || null,
        team_budget: Number(form.team_budget),
        base_price: Number(form.base_price),
        min_squad: Number(form.min_squad),
        max_squad: Number(form.max_squad),
      })
      .select("id")
      .single();
    setSaving(false);
    if (error) return toast(errorMessage(error), "error");
    toast("Tournament created", "success");
    router.push(`/t/${data.id}`);
  }

  return (
    <Modal open={open} onClose={onClose} title="New tournament">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Tournament name">
          <Input value={form.name} onChange={set("name")} placeholder="e.g. Village Premier League 2026" required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Venue">
            <Input value={form.venue} onChange={set("venue")} placeholder="Ground / town" />
          </Field>
          <Field label="Start date">
            <Input type="date" value={form.starts_on} onChange={set("starts_on")} />
          </Field>
          <Field label="Budget per team (Rs)">
            <Input type="number" min={1} value={form.team_budget} onChange={set("team_budget")} required />
          </Field>
          <Field label="Player base price (Rs)">
            <Input type="number" min={1} value={form.base_price} onChange={set("base_price")} required />
          </Field>
          <Field label="Min squad size">
            <Input type="number" min={0} value={form.min_squad} onChange={set("min_squad")} required />
          </Field>
          <Field label="Max squad size">
            <Input type="number" min={1} value={form.max_squad} onChange={set("max_squad")} required />
          </Field>
        </div>
        <p className="text-xs text-slate-500">You can change bid increments, timer and everything else later in Settings.</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Create tournament
          </Button>
        </div>
      </form>
    </Modal>
  );
}
