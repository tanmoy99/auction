"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Clock, Copy, ExternalLink, Lock, MessageCircle, Plus, RefreshCw, Trash2, UserPlus } from "lucide-react";
import { PlayerFields, emptyPlayerForm, playerFormData, type PlayerFormValues } from "@/components/player-fields";
import { toast } from "@/components/toast";
import { Avatar, Button, Card, EmptyState, Modal, PageLoader } from "@/components/ui";
import { errorMessage, rupees } from "@/lib/format";
import { useTournamentLive, useUser } from "@/lib/hooks";
import { compressImage } from "@/lib/image";
import { authHeader, supabase } from "@/lib/supabase";
import type { Team, Tournament } from "@/lib/types";

const ADDED_BY_TEAM = ["team-owner", "team-link"];

// Team owner: add players to their own squad, or share a join link on WhatsApp.
// Needs a one-time approval from the organiser (Teams tab).
export default function OwnerSquadPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const { tournament: t, teams, players, loading } = useTournamentLive(id);
  const [asking, setAsking] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!userLoading && !user) router.replace("/login");
  }, [userLoading, user, router]);

  const myTeam = teams.find((x) => x.owner_user_id === user?.id) ?? null;
  const squad = useMemo(() => players.filter((p) => p.team_id === myTeam?.id && p.status === "sold"), [players, myTeam]);

  if (loading || userLoading) return <PageLoader />;
  if (!t || !myTeam)
    return (
      <main className="mx-auto max-w-lg flex-1 px-4 py-10">
        <EmptyState icon={<UserPlus className="size-6" />} title="You don't own a team in this tournament" text="Log in with the team owner ID the organiser gave you." />
      </main>
    );

  const full = squad.length >= t.max_squad;

  async function askAccess() {
    setAsking(true);
    const { error } = await supabase.rpc("request_player_access", { p_team: myTeam!.id });
    setAsking(false);
    if (error) toast(errorMessage(error), "error");
    else toast("Request sent to the organiser", "success");
  }

  async function remove(playerId: string, name: string) {
    if (!confirm(`Remove ${name} from your squad?`)) return;
    const { error } = await supabase.rpc("owner_remove_player", { p_player: playerId });
    if (error) toast(errorMessage(error), "error");
    else toast("Player removed", "success");
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          <Link href={`/bid/${t.id}`} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" title="Back to bidding">
            <ArrowLeft className="size-5" />
          </Link>
          <Avatar name={myTeam.short_name || myTeam.name} src={myTeam.logo_url} color={myTeam.color} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-slate-900">Add players · {myTeam.name}</p>
            <p className="truncate text-xs text-slate-500">
              {t.name} · Squad {squad.length}/{t.max_squad}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl space-y-4 px-4 py-4">
        {myTeam.player_access === "none" && (
          <Card className="p-5 text-center">
            <Lock className="mx-auto size-8 text-slate-400" />
            <h2 className="mt-3 font-semibold text-slate-900">Ask the organiser first</h2>
            <p className="mt-1 text-sm text-slate-500">
              To add your own players (or share a join link on WhatsApp), the organiser has to allow it once for your team.
            </p>
            <Button className="mt-4" loading={asking} onClick={askAccess}>
              Ask for permission
            </Button>
          </Card>
        )}
        {myTeam.player_access === "requested" && (
          <Card className="border-amber-200 bg-amber-50 p-5 text-center">
            <Clock className="mx-auto size-8 text-amber-600" />
            <h2 className="mt-3 font-semibold text-amber-900">Waiting for the organiser</h2>
            <p className="mt-1 text-sm text-amber-800">Your request was sent. This page unlocks as soon as the organiser approves it.</p>
          </Card>
        )}
        {myTeam.player_access === "approved" && (
          <>
            <JoinLinkCard team={myTeam} tournament={t} />
            <Button className="w-full" size="lg" disabled={full} onClick={() => setAdding(true)}>
              <Plus className="size-4" /> {full ? "Squad is full" : "Add a player myself"}
            </Button>
          </>
        )}

        <Card>
          <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">My squad ({squad.length})</h2>
          {squad.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">No players yet</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {squad.map((p) => {
                const ours = ADDED_BY_TEAM.includes(p.source);
                return (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Avatar name={p.name} src={p.photo_url} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{p.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {[p.role, ours ? "Added by team" : `Bought for ${rupees(p.sold_price)}`].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {ours && myTeam.player_access === "approved" && (
                      <button onClick={() => remove(p.id, p.name)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600" title="Remove">
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </main>

      {adding && <AddPlayerModal team={myTeam} onClose={() => setAdding(false)} />}
    </div>
  );
}

function JoinLinkCard({ team, tournament }: { team: Team; tournament: Tournament }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link = token ? `${origin}/join/${token}` : "";

  useEffect(() => {
    supabase.rpc("team_link", { p_team: team.id }).then(({ data, error }) => {
      if (error) toast(errorMessage(error), "error");
      else setToken(data as string);
    });
  }, [team.id]);

  async function newLink() {
    if (!confirm("Create a new link? The old link will stop working.")) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("team_link", { p_team: team.id, p_new: true });
    setBusy(false);
    if (error) toast(errorMessage(error), "error");
    else {
      setToken(data as string);
      toast("New link created", "success");
    }
  }

  return (
    <Card className="p-5">
      <h2 className="font-semibold text-slate-900">Team join link</h2>
      <p className="mt-1 text-sm text-slate-500">Share on WhatsApp. Players fill the form and go straight into {team.name}.</p>
      {!token ? (
        <div className="py-4">
          <PageLoader />
        </div>
      ) : (
        <>
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 pl-3 text-sm">
            <span className="min-w-0 flex-1 truncate text-slate-700">{link}</span>
            <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(link).then(() => toast("Copied", "success"))}>
              <Copy className="size-4" />
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={`https://wa.me/?text=${encodeURIComponent(`Join ${team.name} for ${tournament.name}. Fill this form: ${link}`)}`} target="_blank">
              <Button size="sm">
                <MessageCircle className="size-4" /> Share on WhatsApp
              </Button>
            </a>
            <a href={link} target="_blank">
              <Button size="sm" variant="secondary">
                <ExternalLink className="size-4" /> Open
              </Button>
            </a>
            <Button size="sm" variant="ghost" loading={busy} onClick={newLink}>
              <RefreshCw className="size-4" /> New link
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function AddPlayerModal({ team, onClose }: { team: Team; onClose: () => void }) {
  const [values, setValues] = useState<PlayerFormValues>(emptyPlayerForm);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { data: token, error } = await supabase.rpc("team_link", { p_team: team.id });
      if (error) throw error;
      const res = await fetch(`/api/join/${token}`, {
        method: "POST",
        headers: await authHeader(),
        body: playerFormData(values, photo && (await compressImage(photo))),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast(`${values.name} added to ${team.name}`, "success");
      onClose();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Add player · ${team.name}`}>
      <form onSubmit={onSubmit} className="space-y-5">
        <PlayerFields
          values={values}
          onChange={setValues}
          photoPreview={preview}
          onPhoto={(file) => {
            setPhoto(file);
            setPreview(URL.createObjectURL(file));
          }}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Add to squad
          </Button>
        </div>
      </form>
    </Modal>
  );
}
