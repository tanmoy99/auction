"use client";

import { useState } from "react";
import { Copy, KeyRound, MessageCircle, Pencil, Plus, Trash2, UserPlus, Users } from "lucide-react";
import { useTournament } from "@/components/tournament-context";
import { toast } from "@/components/toast";
import { Avatar, Button, Card, EmptyState, Field, Input, Modal, cn } from "@/components/ui";
import { errorMessage, rupees } from "@/lib/format";
import { uploadPhoto } from "@/lib/image";
import { authHeader, supabase } from "@/lib/supabase";
import type { Team } from "@/lib/types";

const COLORS = ["#059669", "#2563eb", "#dc2626", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#4b5563", "#65a30d", "#ea580c"];

export default function TeamsPage() {
  const { tournament, teams, players } = useTournament();
  const [editing, setEditing] = useState<Team | null | undefined>(undefined);
  const [loginFor, setLoginFor] = useState<Team | null>(null);

  async function remove(team: Team) {
    const squad = players.filter((p) => p.team_id === team.id).length;
    if (squad > 0) return toast("Release this team's players before deleting it", "error");
    if (!confirm(`Delete ${team.name}?`)) return;
    const { error } = await supabase.from("teams").delete().eq("id", team.id);
    if (error) toast(errorMessage(error), "error");
    else toast("Team deleted", "success");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          Each team gets {rupees(tournament.team_budget)} and a login for its owner to bid from their phone.
        </p>
        <Button onClick={() => setEditing(null)}>
          <Plus className="size-4" /> Add team
        </Button>
      </div>

      {teams.length === 0 ? (
        <EmptyState
          icon={<Users className="size-6" />}
          title="No teams yet"
          text="Add the teams taking part. You can then create a login for each team owner."
          action={
            <Button onClick={() => setEditing(null)}>
              <Plus className="size-4" /> Add team
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => {
            const squad = players.filter((p) => p.team_id === team.id && p.status === "sold");
            return (
              <Card key={team.id} className="overflow-hidden">
                <div className="h-1.5" style={{ background: team.color }} />
                <div className="p-5">
                  <div className="flex items-start gap-3">
                    <Avatar name={team.short_name || team.name} src={team.logo_url} size={48} color={team.color} />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold text-slate-900">{team.name}</h3>
                      <p className="truncate text-sm text-slate-500">{team.owner_name ? `Owner: ${team.owner_name}` : "No owner name"}</p>
                    </div>
                    <div className="flex">
                      <button onClick={() => setEditing(team)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit">
                        <Pencil className="size-4" />
                      </button>
                      <button onClick={() => remove(team)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600" title="Delete">
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>

                  <dl className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-center">
                    <div>
                      <dt className="text-xs text-slate-500">Purse left</dt>
                      <dd className="text-sm font-semibold text-slate-900">{rupees(team.purse - team.spent)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Spent</dt>
                      <dd className="text-sm font-semibold text-slate-900">{rupees(team.spent)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Squad</dt>
                      <dd className="text-sm font-semibold text-slate-900">
                        {squad.length}/{tournament.max_squad}
                      </dd>
                    </div>
                  </dl>

                  <button
                    onClick={() => setLoginFor(team)}
                    className={cn(
                      "mt-3 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium",
                      team.owner_user_id
                        ? "border-slate-200 text-slate-600 hover:bg-slate-50"
                        : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100",
                    )}
                  >
                    <KeyRound className="size-4" />
                    {team.owner_user_id ? `Login: ${team.owner_login} · Reset password` : "Create owner login"}
                  </button>
                  <PlayerAccess team={team} />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editing !== undefined && <TeamModal team={editing} onClose={() => setEditing(undefined)} />}
      {loginFor && <OwnerLoginModal team={loginFor} onClose={() => setLoginFor(null)} />}
    </div>
  );
}

const ACCESS_MESSAGES: Record<Team["player_access"], string> = {
  none: "Owner adding players turned off",
  requested: "Request declined",
  approved: "Owner can now add players",
};

// One-time permission for the owner to add their own players (and share a join link)
function PlayerAccess({ team }: { team: Team }) {
  const [busy, setBusy] = useState(false);

  async function set(player_access: Team["player_access"]) {
    setBusy(true);
    const { error } = await supabase.from("teams").update({ player_access }).eq("id", team.id);
    setBusy(false);
    if (error) toast(errorMessage(error), "error");
    else toast(player_access === "none" && team.player_access === "requested" ? ACCESS_MESSAGES.requested : ACCESS_MESSAGES[player_access], "success");
  }

  if (team.player_access === "requested")
    return (
      <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
        <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
          <UserPlus className="size-4" /> Owner asks to add their own players
        </p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" className="flex-1" loading={busy} onClick={() => set("approved")}>
            Approve
          </Button>
          <Button size="sm" variant="secondary" className="flex-1" disabled={busy} onClick={() => set("none")}>
            Decline
          </Button>
        </div>
      </div>
    );

  return (
    <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
      <span className={cn("flex items-center gap-2", team.player_access === "approved" ? "text-emerald-700" : "text-slate-500")}>
        <UserPlus className="size-4" />
        {team.player_access === "approved" ? "Owner can add players" : "Owner can't add players"}
      </span>
      <Button
        size="sm"
        variant="ghost"
        loading={busy}
        onClick={() =>
          team.player_access === "approved"
            ? confirm(`Stop ${team.name}'s owner adding players? Their join link stops working. Players already added stay.`) && set("none")
            : set("approved")
        }
      >
        {team.player_access === "approved" ? "Turn off" : "Allow"}
      </Button>
    </div>
  );
}

function TeamModal({ team, onClose }: { team: Team | null; onClose: () => void }) {
  const { tournament, teams } = useTournament();
  const [name, setName] = useState(team?.name ?? "");
  const [shortName, setShortName] = useState(team?.short_name ?? "");
  const [ownerName, setOwnerName] = useState(team?.owner_name ?? "");
  const [color, setColor] = useState(team?.color ?? COLORS[teams.length % COLORS.length]!);
  const [purse, setPurse] = useState(String(team?.purse ?? tournament.team_budget));
  const [logo, setLogo] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (team && Number(purse) < team.spent) return toast(`Purse can't be less than already spent (${rupees(team.spent)})`, "error");
    setSaving(true);
    try {
      const logo_url = logo ? await uploadPhoto(tournament.id, logo) : team?.logo_url ?? null;
      const row = {
        name: name.trim(),
        short_name: shortName.trim().toUpperCase() || null,
        owner_name: ownerName.trim() || null,
        color,
        purse: Number(purse),
        logo_url,
      };
      const { error } = team
        ? await supabase.from("teams").update(row).eq("id", team.id)
        : await supabase.from("teams").insert({ ...row, tournament_id: tournament.id });
      if (error) throw error;
      toast(team ? "Team updated" : "Team added", "success");
      onClose();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={team ? "Edit team" : "Add team"}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Team name" className="sm:col-span-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Royal Strikers" required />
          </Field>
          <Field label="Short name">
            <Input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="RS" maxLength={5} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Owner name">
            <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
          </Field>
          <Field label="Purse (Rs)">
            <Input type="number" min={0} value={purse} onChange={(e) => setPurse(e.target.value)} required />
          </Field>
        </div>
        <Field label="Team colour">
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn("size-8 rounded-full ring-offset-2", color === c && "ring-2 ring-slate-900")}
                style={{ background: c }}
                aria-label={c}
              />
            ))}
          </div>
        </Field>
        <Field label="Logo (optional)">
          <Input type="file" accept="image/*" className="py-1.5" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {team ? "Save" : "Add team"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function randomPassword() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function OwnerLoginModal({ team, onClose }: { team: Team; onClose: () => void }) {
  const { tournament } = useTournament();
  const suggested = (team.short_name || team.name).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  const [login, setLogin] = useState(team.owner_login ?? suggested);
  const [password, setPassword] = useState(randomPassword);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const siteUrl = typeof window === "undefined" ? "" : window.location.origin;
  const message = `${tournament.name} - Player Auction\nTeam: ${team.name}\n\nLogin here: ${siteUrl}/login\nLogin ID: ${login}\nPassword: ${password}`;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/owner", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ teamId: team.id, login, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setLogin(body.login);
      setDone(true);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Owner login · ${team.name}`}>
      {done ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Login is ready. Send these details to the team owner:</p>
          <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4 font-sans text-sm text-slate-800">{message}</pre>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => navigator.clipboard.writeText(message).then(() => toast("Copied", "success"))}
            >
              <Copy className="size-4" /> Copy
            </Button>
            <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" className="flex-1">
              <Button className="w-full">
                <MessageCircle className="size-4" /> WhatsApp
              </Button>
            </a>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Login ID" hint="Letters and numbers only. The owner types this on the login page.">
            <Input value={login} onChange={(e) => setLogin(e.target.value.toLowerCase())} pattern="[a-z0-9._-]{3,30}" required />
          </Field>
          <Field label={team.owner_user_id ? "New password" : "Password"}>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {team.owner_user_id ? "Update login" : "Create login"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
