"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Pencil, Plus, Search, Shield, Trash2, Undo2, Upload, UserRound, X } from "lucide-react";
import { useTournament } from "@/components/tournament-context";
import { toast } from "@/components/toast";
import { Avatar, Button, Card, EmptyState, Field, Input, Modal, RoleBadges, Select, StatusBadge, TeamDot, cn } from "@/components/ui";
import { errorMessage, rupees } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { Player, PlayerStatus } from "@/lib/types";
import { ROLES } from "@/lib/types";
import { ImportModal } from "./import-modal";
import { PlayerModal } from "./player-modal";

const FILTERS: { value: PlayerStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "available", label: "Available" },
  { value: "sold", label: "Sold" },
  { value: "unsold", label: "Unsold" },
];

async function fetchPhones(tournamentId: string): Promise<Record<string, string>> {
  const { data } = await supabase.from("player_contacts").select("player_id, phone").eq("tournament_id", tournamentId);
  return Object.fromEntries((data ?? []).map((c) => [c.player_id, c.phone ?? ""]));
}

export default function PlayersPage() {
  const { tournament, teams, players, state, reload } = useTournament();
  const [phones, setPhones] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<PlayerStatus | "all">("all");
  const [role, setRole] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Player | null | undefined>(undefined); // undefined = closed, null = new
  const [importing, setImporting] = useState(false);
  const [assigning, setAssigning] = useState<Player | null>(null);

  const loadPhones = useCallback(() => fetchPhones(tournament.id).then(setPhones), [tournament.id]);

  // reload when players are added (e.g. a new registration arrives live)
  useEffect(() => {
    fetchPhones(tournament.id).then(setPhones);
  }, [tournament.id, players.length]);

  const teamById = useMemo(() => Object.fromEntries(teams.map((t) => [t.id, t])), [teams]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: players.length };
    for (const p of players) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [players]);

  const visible = players.filter((p) => {
    if (filter !== "all" && p.status !== filter) return false;
    if (role && p.role !== role) return false;
    const q = query.trim().toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || (p.city ?? "").toLowerCase().includes(q) || (phones[p.id] ?? "").includes(q);
  });

  async function run(action: PromiseLike<{ error: unknown }>, success: string) {
    const { error } = await action;
    if (error) toast(errorMessage(error), "error");
    else toast(success, "success");
  }

  const approve = (ids: string[]) =>
    run(supabase.from("players").update({ status: "available" }).in("id", ids), ids.length > 1 ? `${ids.length} players approved` : "Player approved");

  function remove(p: Player) {
    if (!confirm(`Delete ${p.name}? This cannot be undone.`)) return;
    run(supabase.from("players").delete().eq("id", p.id), "Player deleted");
  }

  function release(p: Player) {
    if (!confirm(`Remove ${p.name} from ${teamById[p.team_id!]?.name ?? "the team"} and refund ${rupees(p.sold_price)}?`)) return;
    run(supabase.rpc("release_player", { p_player: p.id }), "Player back in the auction pool");
  }

  const pendingIds = players.filter((p) => p.status === "pending").map((p) => p.id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 text-sm">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "shrink-0 rounded-md px-3 py-1.5 font-medium",
                filter === f.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
              )}
            >
              {f.label} <span className="text-slate-400">{counts[f.value] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setImporting(true)}>
            <Upload className="size-4" /> Import
          </Button>
          <Button onClick={() => setEditing(null)}>
            <Plus className="size-4" /> Add player
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, city or phone" className="pl-9" />
        </div>
        <Select value={role} onChange={(e) => setRole(e.target.value)} className="sm:w-48">
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </Select>
      </div>

      {pendingIds.length > 0 && (filter === "all" || filter === "pending") && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>
            <b>{pendingIds.length}</b> new registrations waiting for approval. Approved players join the auction pool.
          </span>
          <Button size="sm" onClick={() => approve(pendingIds)}>
            <Check className="size-4" /> Approve all
          </Button>
        </div>
      )}

      {players.length === 0 ? (
        <EmptyState
          icon={<UserRound className="size-6" />}
          title="No players yet"
          text="Add players one by one, import an Excel / Google Sheet, or share the registration link from the Registration tab."
          action={
            <Button onClick={() => setImporting(true)}>
              <Upload className="size-4" /> Import players
            </Button>
          }
        />
      ) : (
        <Card className="divide-y divide-slate-100">
          {visible.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-500">No players match your filters.</p>}
          {visible.map((p) => {
            const team = p.team_id ? teamById[p.team_id] : null;
            const onStage = state?.player_id === p.id && state.phase === "bidding";
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
                <Avatar name={p.name} src={p.photo_url} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">
                    {p.name}
                    {p.status === "sold" && <RoleBadges player={p} className="ml-2 align-middle" />}
                    {p.category && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{p.category}</span>}
                  </p>
                  <p className="truncate text-sm text-slate-500">
                    {[p.role, p.city, phones[p.id]].filter(Boolean).join(" · ") || "No details"}
                  </p>
                </div>
                <div className="w-28 text-right text-sm">
                  {p.status === "sold" && team ? (
                    <>
                      <p className="font-semibold text-slate-900">{rupees(p.sold_price)}</p>
                      <p className="flex items-center justify-end gap-1 truncate text-xs text-slate-500">
                        <TeamDot color={team.color} /> {team.short_name || team.name}
                      </p>
                    </>
                  ) : (
                    <p className="text-slate-500">Base {rupees(p.base_price)}</p>
                  )}
                </div>
                <div className="w-20">{onStage ? <span className="text-xs font-semibold text-rose-600">ON STAGE</span> : <StatusBadge status={p.status} />}</div>
                <div className="flex gap-1">
                  {p.status === "pending" && (
                    <IconButton title="Approve" onClick={() => approve([p.id])} className="text-emerald-600">
                      <Check className="size-4" />
                    </IconButton>
                  )}
                  {(p.status === "available" || p.status === "unsold") && !onStage && (
                    <IconButton title="Assign to a team directly (icon / captain)" onClick={() => setAssigning(p)}>
                      <Shield className="size-4" />
                    </IconButton>
                  )}
                  {p.status === "sold" && (
                    <IconButton title="Undo sale / release" onClick={() => release(p)}>
                      <Undo2 className="size-4" />
                    </IconButton>
                  )}
                  <IconButton title="Edit" onClick={() => setEditing(p)}>
                    <Pencil className="size-4" />
                  </IconButton>
                  {!onStage && (
                    <IconButton title={p.status === "pending" ? "Reject" : "Delete"} onClick={() => remove(p)} className="hover:text-rose-600">
                      {p.status === "pending" ? <X className="size-4" /> : <Trash2 className="size-4" />}
                    </IconButton>
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {editing !== undefined && (
        <PlayerModal
          tournament={tournament}
          player={editing}
          phone={editing ? phones[editing.id] ?? "" : ""}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            reload();
            loadPhones();
          }}
        />
      )}
      {importing && (
        <ImportModal
          tournament={tournament}
          existingPhones={Object.values(phones)}
          onClose={() => setImporting(false)}
          onImported={() => {
            reload();
            loadPhones();
          }}
        />
      )}
      {assigning && <AssignModal player={assigning} onClose={() => setAssigning(null)} />}
    </div>
  );
}

function IconButton({ className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={cn("rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700", className)} {...rest} />;
}

function AssignModal({ player, onClose }: { player: Player; onClose: () => void }) {
  const { teams } = useTournament();
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [price, setPrice] = useState(String(player.base_price));
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.rpc("assign_player", { p_player: player.id, p_team: teamId, p_price: Number(price) });
    setSaving(false);
    if (error) return toast(errorMessage(error), "error");
    toast(`${player.name} added to the team`, "success");
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={`Assign ${player.name}`}>
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="text-sm text-slate-600">Use this for icon players, captains or retained players who skip the auction.</p>
        <Field label="Team">
          <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} required>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({rupees(t.purse - t.spent)} left)
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Price deducted from purse (Rs)" hint="Use 0 if the player is free">
          <Input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} required />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={!teamId}>
            Assign
          </Button>
        </div>
      </form>
    </Modal>
  );
}
