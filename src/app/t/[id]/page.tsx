"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import { useTournament } from "@/components/tournament-context";
import { Button, Card, TeamDot, cn } from "@/components/ui";
import { rupees } from "@/lib/format";
import { supabase } from "@/lib/supabase";

// ongoing: no finished state of its own, so it only becomes the next step once the auction is done
type Step = { done: boolean; title: string; text: string; href: string; cta: string; external?: boolean; ongoing?: boolean };

export default function OverviewPage() {
  const { tournament: t, teams, players } = useTournament();
  const count = (s: string) => players.filter((p) => p.status === s).length;
  const totalSpent = teams.reduce((sum, team) => sum + team.spent, 0);
  const [matches, setMatches] = useState<number | null>(null);

  useEffect(() => {
    supabase
      .from("matches")
      .select("id", { count: "exact", head: true })
      .eq("tournament_id", t.id)
      .then(({ count: n }) => setMatches(n ?? 0));
  }, [t.id]);

  const stats = [
    { label: "Teams", value: teams.length },
    { label: "Players in pool", value: count("available") },
    { label: "Sold", value: count("sold") },
    { label: "Unsold", value: count("unsold") },
    { label: "Pending approval", value: count("pending") },
    { label: "Total spent", value: rupees(totalSpent) },
  ];

  const started = t.status !== "setup";
  const finished = t.status === "completed";
  const groups: { title: string; steps: Step[] }[] = [
    {
      title: "Before the auction",
      steps: [
        {
          done: teams.length >= 2,
          title: "Add the teams",
          text: "At least 2. Set each team's name, colour and purse.",
          href: `/t/${t.id}/teams`,
          cta: "Add teams",
        },
        {
          done: teams.length > 0 && teams.every((x) => x.owner_user_id),
          title: "Create a login for every team owner",
          text: "On the Teams tab, tap Create owner login and send it on WhatsApp. Owners bid from their own phone.",
          href: `/t/${t.id}/teams`,
          cta: "Create logins",
        },
        {
          done: players.length > 0,
          title: "Add players",
          text: "Import an Excel or Google Sheet, add them by hand, or share the registration link so players sign up themselves.",
          href: `/t/${t.id}/registration`,
          cta: "Get players",
        },
        {
          done: players.length > 0 && count("pending") === 0,
          title: "Approve registrations",
          text: "Players who signed up wait as Pending in the Players tab. Only approved players come up in the auction.",
          href: `/t/${t.id}/players`,
          cta: "Review players",
        },
        {
          done: started,
          title: "Start the auction",
          text: "Check the rules in Settings (base price, increments, timer), then press Start on the Live auction tab.",
          href: `/t/${t.id}/auction`,
          cta: "Go to Live auction",
        },
      ],
    },
    {
      title: "Auction day",
      steps: [
        {
          done: finished || (started && count("available") === 0 && count("unsold") === 0),
          title: "Bring players and sell them",
          text: "Open the Big screen on a TV. Bring players one by one; owners bid from their phones, or you bid for a team.",
          href: `/t/${t.id}/auction`,
          cta: "Run the auction",
        },
        {
          done: finished,
          title: "Finish the auction",
          text: "When every player is done, press Finish auction. The big screen and owner phones then show the final squads.",
          href: `/t/${t.id}/auction`,
          cta: "Finish auction",
        },
      ],
    },
    {
      title: "After the auction",
      steps: [
        {
          done: false,
          title: "Share the final squads",
          text: "A public page with every team's players. Send it on WhatsApp or download it as Excel.",
          href: `/squads/${t.id}`,
          cta: "Open squads",
          external: true,
          ongoing: true,
        },
        {
          done: (matches ?? 0) > 0,
          title: "Make the fixtures",
          text: "Generate league or knockout matches. Everyone can follow the schedule and points table.",
          href: `/t/${t.id}/fixtures`,
          cta: "Make fixtures",
        },
        {
          done: false,
          title: "Score matches ball by ball",
          text: "In Fixtures, open a match and send the scorer link and PIN to whoever is scoring.",
          href: `/t/${t.id}/fixtures`,
          cta: "Go to Fixtures",
          ongoing: true,
        },
      ],
    },
  ];
  const next = groups.flatMap((g) => g.steps).find((s) => !s.done && (!s.ongoing || finished));

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {next && (
          <Card className="border-emerald-200 bg-emerald-50 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Next step</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">{next.title}</h2>
            <p className="mt-1 text-sm text-slate-600">{next.text}</p>
            <Link href={next.href} target={next.external ? "_blank" : undefined} className="mt-3 inline-block">
              <Button>
                {next.cta} <ArrowRight className="size-4" />
              </Button>
            </Link>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {stats.map((s) => (
            <Card key={s.label} className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{s.label}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{s.value}</p>
            </Card>
          ))}
        </div>

        <Card>
          <div className="border-b border-slate-100 px-5 py-3.5">
            <h2 className="font-semibold text-slate-900">Teams & purse</h2>
          </div>
          {teams.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">No teams yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {teams.map((team) => {
                const squad = players.filter((p) => p.team_id === team.id && p.status === "sold").length;
                const pct = Math.min(100, (team.spent / team.purse) * 100);
                return (
                  <li key={team.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2 font-medium text-slate-800">
                        <TeamDot color={team.color} /> {team.name}
                      </span>
                      <span className="text-slate-500">
                        {squad}/{t.max_squad} players · <span className="font-medium text-slate-800">{rupees(team.purse - team.spent)}</span> left
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: team.color }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card className="h-fit p-5">
        <h2 className="font-semibold text-slate-900">Step by step</h2>
        <div className="mt-4 space-y-5">
          {groups.map((group) => (
            <div key={group.title}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{group.title}</p>
              <ul className="mt-2 space-y-2.5">
                {group.steps.map((step) => (
                  <li key={step.title}>
                    <Link
                      href={step.href}
                      target={step.external ? "_blank" : undefined}
                      className="flex items-start gap-2.5 text-sm hover:text-emerald-700"
                      title={step.text}
                    >
                      {step.done ? (
                        <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
                      ) : (
                        <Circle className={cn("size-5 shrink-0", step === next ? "text-emerald-500" : "text-slate-300")} />
                      )}
                      <span className={cn(step.done ? "text-slate-400 line-through" : "text-slate-700", step === next && "font-semibold text-slate-900")}>
                        {step.title}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-5 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          Budget {rupees(t.team_budget)} per team · Base price {rupees(t.base_price)} · Squad {t.min_squad}-{t.max_squad}
        </div>
      </Card>
    </div>
  );
}
