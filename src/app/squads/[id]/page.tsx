"use client";

import { useParams } from "next/navigation";
import { Download } from "lucide-react";
import { Logo } from "@/components/app-header";
import { Avatar, Button, Card, PageLoader, RoleBadges } from "@/components/ui";
import { rupees } from "@/lib/format";
import { useTournamentLive } from "@/lib/hooks";
import { squadOrder } from "@/lib/types";

// Public page: every team's squad, updates live during the auction
export default function SquadsPage() {
  const { id } = useParams<{ id: string }>();
  const { tournament: t, teams, players, loading } = useTournamentLive(id);

  if (loading) return <PageLoader />;
  if (!t) return <p className="py-20 text-center text-slate-500">Tournament not found</p>;

  async function exportExcel() {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const rows = teams.flatMap((team) =>
      players
        .filter((p) => p.team_id === team.id && p.status === "sold")
        .map((p) => ({
          Team: team.name,
          Player: p.name,
          Role: p.role ?? "",
          "C / VC / WK": [p.is_captain && "C", p.is_vice_captain && "VC", p.is_keeper && "WK"].filter(Boolean).join(" "),
          City: p.city ?? "",
          Price: p.sold_price ?? 0,
        })),
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Squads");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        players.filter((p) => p.status === "unsold" || p.status === "available").map((p) => ({ Player: p.name, Role: p.role ?? "", Status: p.status })),
      ),
      "Not sold",
    );
    XLSX.writeFile(wb, `${t!.name} squads.xlsx`);
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Logo />
          <h1 className="mt-4 text-2xl font-bold text-slate-900">{t.name} · Squads</h1>
          <p className="text-sm text-slate-500">Updates live during the auction</p>
        </div>
        <div className="flex gap-2">
          <a href={`/fixtures/${t.id}`}>
            <Button variant="secondary">Fixtures</Button>
          </a>
        <Button variant="secondary" onClick={exportExcel}>
          <Download className="size-4" /> Download Excel
        </Button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {teams.map((team) => {
          const squad = players
            .filter((p) => p.team_id === team.id && p.status === "sold")
            .sort((a, b) => squadOrder(a, b) || (b.sold_price ?? 0) - (a.sold_price ?? 0));
          return (
            <Card key={team.id} className="overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 text-white" style={{ background: team.color }}>
                <Avatar name={team.short_name || team.name} src={team.logo_url} size={36} color="rgba(255,255,255,0.2)" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{team.name}</p>
                  <p className="text-xs text-white/80">
                    {squad.length} players · {rupees(team.spent)} spent · {rupees(team.purse - team.spent)} left
                  </p>
                </div>
              </div>
              <ul className="divide-y divide-slate-100">
                {squad.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">No players yet</li>}
                {squad.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-2">
                    <Avatar name={p.name} src={p.photo_url} size={30} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                        <span className="truncate">{p.name}</span>
                        <RoleBadges player={p} />
                      </p>
                      <p className="truncate text-xs text-slate-500">{p.role}</p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-slate-900">{rupees(p.sold_price)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </main>
  );
}
