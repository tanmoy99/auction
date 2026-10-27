"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, MonitorPlay, PauseCircle, PlayCircle, RefreshCw, Search, ShieldCheck, Trash2, Trophy, UserRound, Users } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { toast } from "@/components/toast";
import { Button, Card, EmptyState, Field, Input, Modal, PageLoader, Select, Textarea, cn } from "@/components/ui";
import { OWNER_EMAIL_DOMAIN } from "@/lib/config";
import { errorMessage } from "@/lib/format";
import { useRequireOrganiser } from "@/lib/hooks";
import { authHeader, supabase } from "@/lib/supabase";
import type { AdminTournament, AdminUser } from "@/lib/types";

type Overview = { users: AdminUser[]; tournaments: AdminTournament[] };
type Tab = "tournaments" | "organisers" | "owners";
type TournamentFilter = "all" | "running" | "setup" | "live" | "completed" | "paused";

const statusLabel = {
  setup: { text: "Setting up", cls: "bg-slate-100 text-slate-700" },
  live: { text: "Live", cls: "bg-rose-100 text-rose-700" },
  completed: { text: "Completed", cls: "bg-emerald-100 text-emerald-700" },
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "-";
}

// An auction counts as running when a player is on stage and something happened in the last 30 minutes
function isRunning(t: AdminTournament, now: number) {
  return !!t.phase && t.phase !== "idle" && !!t.last_activity && now - new Date(t.last_activity).getTime() < 30 * 60_000;
}

function ownerLogin(email: string) {
  return email.endsWith(`@${OWNER_EMAIL_DOMAIN}`) ? email.slice(0, -OWNER_EMAIL_DOMAIN.length - 1) : email;
}

function AccessBadge({ user }: { user: AdminUser }) {
  if (user.is_admin)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
        <ShieldCheck className="size-3.5" /> Admin
      </span>
    );
  if (user.suspended) return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Paused</span>;
  if (!user.active) return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Access ended</span>;
  return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Active</span>;
}

export default function AdminPage() {
  const { user, access, ready } = useRequireOrganiser();
  const [data, setData] = useState<Overview | null>(null);
  const [tab, setTab] = useState<Tab>("tournaments");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TournamentFilter>("all");
  const [managing, setManaging] = useState<AdminUser | null>(null);
  const [now, setNow] = useState(0); // set when data loads

  const show = useCallback(({ data: overview, error }: { data: unknown; error: { message: string } | null }) => {
    if (error) return toast(errorMessage(error), "error");
    setData(overview as Overview);
    setNow(Date.now());
  }, []);
  const load = useCallback(() => supabase.rpc("admin_overview").then(show), [show]);

  useEffect(() => {
    if (!ready || !access?.is_admin) return;
    supabase.rpc("admin_overview").then(show);
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [ready, access, load, show]);

  const usersById = useMemo(() => new Map((data?.users ?? []).map((u) => [u.id, u])), [data]);
  const tournamentsById = useMemo(() => new Map((data?.tournaments ?? []).map((t) => [t.id, t])), [data]);

  if (!ready) return <PageLoader />;
  if (!access?.is_admin)
    return (
      <>
        <AppHeader />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
          <EmptyState icon={<ShieldCheck className="size-6" />} title="Admins only" text="This page is for the site admin." />
        </main>
      </>
    );
  if (!data)
    return (
      <>
        <AppHeader />
        <PageLoader />
      </>
    );

  const organisers = data.users.filter((u) => u.role === "organiser");
  const owners = data.users.filter((u) => u.role === "owner");
  const q = query.trim().toLowerCase();
  const matches = (...values: (string | null | undefined)[]) => !q || values.some((v) => v?.toLowerCase().includes(q));

  const tournaments = data.tournaments.filter((t) => {
    const organiser = usersById.get(t.organiser_id);
    if (!matches(t.name, t.venue, organiser?.email, organiser?.full_name)) return false;
    if (filter === "running") return isRunning(t, now);
    if (filter === "paused") return !t.active;
    if (filter !== "all") return t.status === filter;
    return true;
  });

  const stats = [
    { label: "Organisers", value: organisers.length, icon: UserRound },
    { label: "Tournaments", value: data.tournaments.length, icon: Trophy },
    { label: "Auctions running now", value: data.tournaments.filter((t) => isRunning(t, now)).length, icon: PlayCircle },
    { label: "Paused", value: data.tournaments.filter((t) => !t.active).length + organisers.filter((u) => !u.active).length, icon: PauseCircle },
  ];

  async function toggleTournament(t: AdminTournament) {
    let reason: string | null = null;
    if (!t.suspended) {
      reason = prompt(`Pause "${t.name}"? Bidding and editing stop until you resume it.\n\nReason shown to the organiser (optional):`, "Payment pending");
      if (reason === null) return;
    }
    const { error } = await supabase
      .from("tournaments")
      .update({ suspended: !t.suspended, suspended_reason: t.suspended ? null : (reason ?? "").trim() || null })
      .eq("id", t.id);
    if (error) return toast(errorMessage(error), "error");
    toast(t.suspended ? "Tournament resumed" : "Tournament paused", "success");
    load();
  }

  async function deleteTournament(t: AdminTournament) {
    if (prompt(`This deletes "${t.name}" with all its teams, players and bids. Type the tournament name to confirm.`) !== t.name) return;
    const { error } = await supabase.from("tournaments").delete().eq("id", t.id);
    if (error) return toast(errorMessage(error), "error");
    toast("Tournament deleted", "success");
    load();
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "tournaments", label: "Tournaments", count: data.tournaments.length },
    { key: "organisers", label: "Organisers", count: organisers.length },
    { key: "owners", label: "Team owners", count: owners.length },
  ];

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
              <ShieldCheck className="size-6 text-violet-600" /> Admin dashboard
            </h1>
            <p className="text-sm text-slate-500">Every organiser and tournament on the site. Pause access, set paid-until dates, or step in.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={load}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.label} className="p-4">
              <s.icon className="size-5 text-slate-400" />
              <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{s.value}</p>
              <p className="text-xs text-slate-500">{s.label}</p>
            </Card>
          ))}
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <nav className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {tabs.map((x) => (
              <button
                key={x.key}
                onClick={() => setTab(x.key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition",
                  tab === x.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
                )}
              >
                {x.label} <span className="text-slate-400">{x.count}</span>
              </button>
            ))}
          </nav>
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or email" className="pl-9" />
          </div>
          {tab === "tournaments" && (
            <Select value={filter} onChange={(e) => setFilter(e.target.value as TournamentFilter)} className="w-auto">
              <option value="all">All tournaments</option>
              <option value="running">Auction running now</option>
              <option value="setup">Setting up</option>
              <option value="live">Live</option>
              <option value="completed">Completed</option>
              <option value="paused">Paused</option>
            </Select>
          )}
        </div>

        {tab === "tournaments" && (
          <Card className="divide-y divide-slate-100">
            {tournaments.length === 0 && <p className="p-6 text-center text-sm text-slate-400">No tournaments match</p>}
            {tournaments.map((t) => {
              const organiser = usersById.get(t.organiser_id);
              const running = isRunning(t, now);
              return (
                <div key={t.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/t/${t.id}`} className="font-semibold text-slate-900 hover:text-emerald-700">
                        {t.name}
                      </Link>
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusLabel[t.status].cls)}>{statusLabel[t.status].text}</span>
                      {running && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-xs font-medium text-white">
                          <span className="size-1.5 animate-pulse rounded-full bg-white" /> Auction running
                        </span>
                      )}
                      {t.suspended ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          Paused{t.suspended_reason ? `: ${t.suspended_reason}` : ""}
                        </span>
                      ) : (
                        !t.active && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Organiser paused</span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-sm text-slate-500">
                      {organiser ? (
                        <button onClick={() => setManaging(organiser)} className="hover:text-slate-800 hover:underline">
                          {organiser.email}
                        </button>
                      ) : (
                        "Unknown organiser"
                      )}
                      {t.venue && ` · ${t.venue}`} · created {formatDate(t.created_at)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {t.team_count} teams · {t.player_count} players · {t.sold_count} sold
                      {t.pending_count > 0 && ` · ${t.pending_count} waiting approval`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/t/${t.id}`}>
                      <Button variant="secondary" size="sm">
                        <ExternalLink className="size-4" /> Open
                      </Button>
                    </Link>
                    <a href={`/live/${t.id}`} target="_blank">
                      <Button variant="secondary" size="sm" title="Big screen">
                        <MonitorPlay className="size-4" />
                      </Button>
                    </a>
                    <Button variant={t.suspended ? "primary" : "secondary"} size="sm" onClick={() => toggleTournament(t)}>
                      {t.suspended ? <PlayCircle className="size-4" /> : <PauseCircle className="size-4" />}
                      {t.suspended ? "Resume" : "Pause"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteTournament(t)} title="Delete tournament" className="text-rose-600 hover:bg-rose-50">
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </Card>
        )}

        {tab !== "tournaments" && (
          <Card className="divide-y divide-slate-100">
            {(tab === "organisers" ? organisers : owners)
              .filter((u) => matches(u.email, u.full_name, ...u.teams.map((x) => x.team)))
              .map((u) => (
                <div key={u.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold text-slate-900">{u.role === "owner" ? ownerLogin(u.email) : u.email}</span>
                      <AccessBadge user={u} />
                      {u.id === user?.id && <span className="text-xs text-slate-400">(you)</span>}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {u.role === "owner"
                        ? u.teams.map((x) => `${x.team} · ${tournamentsById.get(x.tournament_id)?.name ?? "?"}`).join(", ") || "No team"
                        : `${u.full_name ? `${u.full_name} · ` : ""}${u.tournament_count} tournament${u.tournament_count === 1 ? "" : "s"}`}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Joined {formatDate(u.created_at)} · last login {formatDate(u.last_sign_in_at)}
                      {u.access_until && ` · access until ${formatDate(u.access_until)}`}
                      {u.admin_note && ` · ${u.admin_note}`}
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setManaging(u)}>
                    <Users className="size-4" /> Manage
                  </Button>
                </div>
              ))}
          </Card>
        )}
      </main>

      {managing && (
        <ManageUserModal
          key={managing.id}
          user={managing}
          isSelf={managing.id === user?.id}
          tournaments={data.tournaments.filter((t) => t.organiser_id === managing.id)}
          onClose={() => setManaging(null)}
          onSaved={() => {
            setManaging(null);
            load();
          }}
        />
      )}
    </>
  );
}

function addMonths(months: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function ManageUserModal({
  user,
  isSelf,
  tournaments,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  isSelf: boolean;
  tournaments: AdminTournament[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    suspended: user.suspended,
    suspended_reason: user.suspended_reason ?? "",
    access_until: user.access_until ?? "",
    admin_note: user.admin_note ?? "",
    is_admin: user.is_admin,
  });
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"save" | "password" | "delete" | null>(null);
  const name = user.role === "owner" ? ownerLogin(user.email) : user.email;

  async function save() {
    setBusy("save");
    const { error } = await supabase.rpc("admin_update_user", { p_user: user.id, p_changes: form });
    setBusy(null);
    if (error) return toast(errorMessage(error), "error");
    toast("Access updated", "success");
    onSaved();
  }

  async function callApi(action: "password" | "delete") {
    setBusy(action);
    const res = await fetch("/api/admin/user", {
      method: "POST",
      headers: { "content-type": "application/json", ...(await authHeader()) },
      body: JSON.stringify({ action, userId: user.id, password }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return toast(body.error ?? "Something went wrong", "error");
    return true;
  }

  async function resetPassword() {
    if (await callApi("password")) {
      toast(`New password set for ${name}`, "success");
      setPassword("");
    }
  }

  async function deleteAccount() {
    const warning =
      user.role === "organiser" && tournaments.length
        ? `This deletes ${name} and their ${tournaments.length} tournament(s) with all teams, players and bids.`
        : `This deletes the login ${name}.`;
    if (prompt(`${warning}\n\nType DELETE to confirm.`) !== "DELETE") return;
    if (await callApi("delete")) {
      toast("Account deleted", "success");
      onSaved();
    }
  }

  return (
    <Modal open onClose={onClose} title={name}>
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Access</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: false, label: "Active", icon: PlayCircle },
              { value: true, label: "Paused", icon: PauseCircle },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                disabled={isSelf}
                onClick={() => setForm({ ...form, suspended: o.value })}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition disabled:opacity-50",
                  form.suspended === o.value
                    ? o.value
                      ? "border-amber-400 bg-amber-50 text-amber-800"
                      : "border-emerald-400 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50",
                )}
              >
                <o.icon className="size-4" /> {o.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            {user.role === "owner"
              ? "A paused team owner can still watch but cannot bid."
              : "A paused organiser can't create, edit or run tournaments, and bidding stops in all their auctions."}
          </p>
        </div>

        {form.suspended && (
          <Field label="Reason shown to them">
            <Input value={form.suspended_reason} onChange={(e) => setForm({ ...form, suspended_reason: e.target.value })} placeholder="e.g. Payment pending" />
          </Field>
        )}

        {user.role === "organiser" && (
          <Field label="Access until" hint="Leave empty for no end date. After this date the account pauses by itself.">
            <div className="flex flex-wrap gap-2">
              <Input type="date" value={form.access_until} onChange={(e) => setForm({ ...form, access_until: e.target.value })} className="w-44" />
              {[1, 3, 12].map((m) => (
                <Button key={m} type="button" variant="secondary" size="sm" onClick={() => setForm({ ...form, access_until: addMonths(m) })}>
                  +{m === 12 ? "1 year" : `${m} month${m > 1 ? "s" : ""}`}
                </Button>
              ))}
              {form.access_until && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setForm({ ...form, access_until: "" })}>
                  No limit
                </Button>
              )}
            </div>
          </Field>
        )}

        <Field label="Admin note" hint="Only you see this, e.g. paid Rs 500 on 1 Nov by UPI">
          <Textarea rows={2} value={form.admin_note} onChange={(e) => setForm({ ...form, admin_note: e.target.value })} />
        </Field>

        {user.role === "organiser" && (
          <label className={cn("flex items-start gap-3 rounded-lg border border-slate-200 p-3", isSelf && "opacity-50")}>
            <input
              type="checkbox"
              checked={form.is_admin}
              disabled={isSelf}
              onChange={(e) => setForm({ ...form, is_admin: e.target.checked })}
              className="mt-0.5 size-4 accent-violet-600"
            />
            <span className="text-sm">
              <span className="font-medium text-slate-800">Site admin</span>
              <span className="block text-xs text-slate-500">Can see and control every tournament and user, like you.</span>
            </span>
          </label>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy === "save"}>
            Save access
          </Button>
        </div>

        {user.role === "organiser" && tournaments.length > 0 && (
          <div className="border-t border-slate-100 pt-4">
            <p className="mb-2 text-sm font-medium text-slate-700">Their tournaments</p>
            <ul className="space-y-1 text-sm">
              {tournaments.map((t) => (
                <li key={t.id}>
                  <Link href={`/t/${t.id}`} className="text-emerald-700 hover:underline">
                    {t.name}
                  </Link>
                  <span className="text-slate-400"> · {statusLabel[t.status].text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!isSelf && (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <Field label="Set a new password">
              <div className="flex gap-2">
                <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
                <Button variant="secondary" onClick={resetPassword} loading={busy === "password"} disabled={password.length < 6}>
                  Set
                </Button>
              </div>
            </Field>
            <Button variant="ghost" size="sm" onClick={deleteAccount} loading={busy === "delete"} className="text-rose-600 hover:bg-rose-50">
              <Trash2 className="size-4" /> Delete account
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
