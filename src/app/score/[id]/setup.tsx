"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Clock, UserPlus } from "lucide-react";
import { toast } from "@/components/toast";
import { Button, Card, Input, Select, TeamDot, cn } from "@/components/ui";
import type { Match } from "@/lib/fixtures";
import type { GuestPlayer, MatchPlayer } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { ROLES, type Team } from "@/lib/types";

type SquadPlayer = { id: string; name: string; role: string | null; team_id: string; is_captain: boolean; is_keeper: boolean };
type Pick = { player_id: string | null; guest_id: string | null; name: string; role: string | null };
type Option = Pick & { key: string; pending?: boolean; captain?: boolean; keeper?: boolean };

// Pick each team's playing XI from its auction squad and approved guests; request new guests
export function LineupSetup({
  match,
  teams,
  players,
  guests,
  started,
  call,
  onDone,
}: {
  match: Match;
  teams: (Team | undefined)[];
  players: MatchPlayer[];
  guests: GuestPlayer[];
  started: boolean;
  call: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  onDone?: () => void;
}) {
  const [squads, setSquads] = useState<SquadPlayer[]>([]);
  const teamA = match.team_a_id;
  const teamB = match.team_b_id;
  useEffect(() => {
    supabase
      .from("players")
      .select("id, name, role, team_id, is_captain, is_keeper")
      .in("team_id", [teamA, teamB].filter(Boolean) as string[])
      .eq("status", "sold")
      .order("name")
      .then(({ data }) => setSquads((data as SquadPlayer[]) ?? []));
  }, [teamA, teamB]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900">{started ? "Add players" : "Playing XI"}</h2>
        <p className="text-sm text-slate-500">
          {started
            ? "Add a late arrival or substitute, or change the captain and keeper. Players already in the XI stay."
            : "Tick who is playing, then set each player's role, the captain (C) and the wicket-keeper (WK). Guests need the organiser's approval first."}
        </p>
      </div>
      {teams.map(
        (team) =>
          team && (
            <TeamLineup
              key={team.id}
              team={team}
              squad={squads.filter((p) => p.team_id === team.id)}
              chosen={players.filter((p) => p.team_id === team.id)}
              guests={guests.filter((g) => g.team_id === team.id && g.status !== "rejected")}
              started={started}
              call={call}
            />
          ),
      )}
      {onDone && (
        <Button size="lg" className="w-full" onClick={onDone}>
          Done
        </Button>
      )}
    </div>
  );
}

function TeamLineup({
  team,
  squad,
  chosen,
  guests,
  started,
  call,
}: {
  team: Team;
  squad: SquadPlayer[];
  chosen: MatchPlayer[];
  guests: GuestPlayer[];
  started: boolean;
  call: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
}) {
  const options: Option[] = useMemo(
    () => [
      ...squad.map((p) => ({ key: `p-${p.id}`, player_id: p.id, guest_id: null, name: p.name, role: p.role, captain: p.is_captain, keeper: p.is_keeper })),
      ...guests.map((g) => ({ key: `g-${g.id}`, player_id: null, guest_id: g.id, name: g.name, role: g.role, pending: g.status === "pending" })),
    ],
    [squad, guests],
  );
  const keyOf = (c: MatchPlayer) => (c.player_id ? `p-${c.player_id}` : `g-${c.guest_id}`);
  const savedKeys = useMemo(() => new Set(chosen.map(keyOf)), [chosen]);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const selected = picked ?? savedKeys;
  // captain / keeper / roles: what was saved for this match, else the squad roles the owner set
  const saved = chosen.length > 0;
  const savedCaptain = saved ? (chosen.find((c) => c.is_captain) ? keyOf(chosen.find((c) => c.is_captain)!) : null) : (options.find((o) => o.captain)?.key ?? null);
  const savedKeeper = saved ? (chosen.find((c) => c.is_keeper) ? keyOf(chosen.find((c) => c.is_keeper)!) : null) : (options.find((o) => o.keeper)?.key ?? null);
  const [captainPick, setCaptain] = useState<string | null | undefined>(undefined);
  const [keeperPick, setKeeper] = useState<string | null | undefined>(undefined);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const captain = captainPick !== undefined ? captainPick : savedCaptain;
  const keeper = keeperPick !== undefined ? keeperPick : savedKeeper;
  const roleOf = (o: Option) => roles[o.key] ?? chosen.find((c) => keyOf(c) === o.key)?.role ?? o.role ?? "";
  const [saving, setSaving] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestRole, setGuestRole] = useState("");
  const [asking, setAsking] = useState(false);
  const dirty =
    (picked !== null && (picked.size !== savedKeys.size || [...picked].some((k) => !savedKeys.has(k)))) ||
    (captainPick !== undefined && captainPick !== savedCaptain) ||
    (keeperPick !== undefined && keeperPick !== savedKeeper) ||
    Object.keys(roles).length > 0;

  function toggle(key: string) {
    const next = new Set(selected);
    if (next.has(key)) {
      if (started && savedKeys.has(key)) return toast("Players already in the match can't be removed", "info");
      next.delete(key);
    } else next.add(key);
    setPicked(next);
  }

  async function save() {
    const list = options
      .filter((o) => selected.has(o.key) && !o.pending)
      .map((o) => ({ player_id: o.player_id, guest_id: o.guest_id, name: o.name, role: roleOf(o) || null, is_captain: o.key === captain, is_keeper: o.key === keeper }));
    if (list.length < 2) return toast("Pick at least 2 players", "error");
    setSaving(true);
    const ok = await call("scorer_lineup", { p_team: team.id, p_players: list });
    setSaving(false);
    if (ok) {
      toast(`${team.name}: ${list.length} players saved`, "success");
      setPicked(null);
      setCaptain(undefined);
      setKeeper(undefined);
      setRoles({});
    }
  }

  async function requestGuest() {
    if (!guestName.trim()) return;
    setAsking(true);
    const ok = await call("scorer_request_guest", { p_team: team.id, p_name: guestName.trim(), p_role: guestRole });
    setAsking(false);
    if (ok) {
      toast("Guest requested. The organiser needs to approve it.", "success");
      setGuestName("");
      setGuestRole("");
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 text-white" style={{ background: team.color }}>
        <p className="flex items-center gap-2 font-semibold">
          <TeamDot color="#fff" /> {team.name}
        </p>
        <span className="text-sm font-medium text-white/90">{selected.size} picked</span>
      </div>
      {options.length === 0 && <p className="px-4 py-4 text-sm text-slate-500">No squad players yet. Request guest players below.</p>}
      <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
        {options.map((o) => {
          const on = selected.has(o.key);
          return (
            <li key={o.key} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5", on && "bg-emerald-50", o.pending && "opacity-60")}>
              <button type="button" disabled={o.pending} onClick={() => toggle(o.key)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span className={cn("flex size-5 shrink-0 items-center justify-center rounded border", on ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300")}>
                  {on && <Check className="size-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">
                    {o.name}
                    {on && o.key === captain && " (c)"}
                    {on && o.key === keeper && " †"}
                  </span>
                  <span className="text-xs text-slate-500">{[roleOf(o), o.guest_id ? "Guest" : null].filter(Boolean).join(" · ")}</span>
                </span>
              </button>
              {o.pending && (
                <span className="flex items-center gap-1 text-xs font-medium text-amber-700">
                  <Clock className="size-3.5" /> Waiting approval
                </span>
              )}
              {on && !o.pending && (
                <span className="flex items-center gap-1.5">
                  <Select
                    value={roleOf(o)}
                    onChange={(e) => setRoles({ ...roles, [o.key]: e.target.value })}
                    className="h-8 w-32 py-0 text-xs"
                    aria-label={`${o.name} role`}
                  >
                    <option value="">Role</option>
                    {ROLES.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </Select>
                  <RoleToggle on={o.key === captain} onClick={() => setCaptain(o.key === captain ? null : o.key)} title="Captain">
                    C
                  </RoleToggle>
                  <RoleToggle on={o.key === keeper} onClick={() => setKeeper(o.key === keeper ? null : o.key)} title="Wicket-keeper">
                    WK
                  </RoleToggle>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="space-y-3 border-t border-slate-100 p-4">
        <Button className="w-full" onClick={save} loading={saving} disabled={!dirty && savedKeys.size > 0} variant={dirty || !savedKeys.size ? "primary" : "secondary"}>
          {savedKeys.size && !dirty ? `XI saved (${savedKeys.size})` : `Save ${team.short_name || team.name} XI`}
        </Button>
        <div className="flex gap-2">
          <Input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Guest player name" />
          <Select value={guestRole} onChange={(e) => setGuestRole(e.target.value)} className="w-36">
            <option value="">Role</option>
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
          <Button variant="secondary" onClick={requestGuest} loading={asking} disabled={!guestName.trim()} title="Ask the organiser to approve a guest">
            <UserPlus className="size-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function RoleToggle({ on, onClick, title, children }: { on: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={cn(
        "h-8 min-w-8 rounded-md border px-1.5 text-xs font-bold transition",
        on ? "border-amber-500 bg-amber-400 text-amber-950" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  );
}
