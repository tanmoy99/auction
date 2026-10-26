"use client";

import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { useTournament } from "@/components/tournament-context";
import { Card, TeamDot } from "@/components/ui";
import { rupees } from "@/lib/format";

export default function OverviewPage() {
  const { tournament: t, teams, players } = useTournament();
  const count = (s: string) => players.filter((p) => p.status === s).length;
  const totalSpent = teams.reduce((sum, team) => sum + team.spent, 0);

  const stats = [
    { label: "Teams", value: teams.length },
    { label: "Players in pool", value: count("available") },
    { label: "Sold", value: count("sold") },
    { label: "Unsold", value: count("unsold") },
    { label: "Pending approval", value: count("pending") },
    { label: "Total spent", value: rupees(totalSpent) },
  ];

  const checklist = [
    { done: teams.length >= 2, text: "Add at least 2 teams", href: `/t/${t.id}/teams` },
    { done: teams.length > 0 && teams.every((x) => x.owner_user_id), text: "Create a login for every team owner", href: `/t/${t.id}/teams` },
    { done: players.length > 0, text: "Add or import players", href: `/t/${t.id}/players` },
    { done: count("pending") === 0, text: "Approve pending registrations", href: `/t/${t.id}/players` },
    { done: t.status !== "setup", text: "Start the live auction", href: `/t/${t.id}/auction` },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
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
        <h2 className="font-semibold text-slate-900">Getting ready</h2>
        <ul className="mt-4 space-y-3">
          {checklist.map((c) => (
            <li key={c.text}>
              <Link href={c.href} className="flex items-start gap-2.5 text-sm hover:text-emerald-700">
                {c.done ? <CheckCircle2 className="size-5 shrink-0 text-emerald-600" /> : <Circle className="size-5 shrink-0 text-slate-300" />}
                <span className={c.done ? "text-slate-400 line-through" : "text-slate-700"}>{c.text}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-5 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          Budget {rupees(t.team_budget)} per team · Base price {rupees(t.base_price)} · Squad {t.min_squad}-{t.max_squad}
        </div>
      </Card>
    </div>
  );
}
