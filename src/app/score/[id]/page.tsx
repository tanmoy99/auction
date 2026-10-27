"use client";

import { useCallback, useState } from "react";
import { useParams } from "next/navigation";
import { ExternalLink, KeyRound, Menu, Wifi, WifiOff } from "lucide-react";
import { Logo } from "@/components/app-header";
import { FullScorecard, LiveSummary, useScoreboard } from "@/components/scorecard";
import { toast } from "@/components/toast";
import { Button, Card, EmptyState, Field, Input, Modal, PageLoader, Select } from "@/components/ui";
import { DEFAULT_SETTINGS } from "@/lib/fixtures";
import { errorMessage } from "@/lib/format";
import { useMatchLive, useUser } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { FinishPanel, InningsBreak, OpenersPanel, PickPanel, ScoringPad, TossPanel } from "./pad";
import { deviceId, useScoringActions, type Access } from "./scorer";
import { LineupSetup } from "./setup";

// Scorer screen. Opened from the organiser's dashboard, or by a volunteer with the PIN link.
export default function ScorePage() {
  const { id } = useParams<{ id: string }>();
  const live = useMatchLive(id);
  const { user, loading: userLoading } = useUser();
  const [access, setAccess] = useState<Access | null>(null);
  const [lost, setLost] = useState<string | null>(null);

  if (live.loading || userLoading) return <PageLoader />;
  if (!live.match || !live.tournament) return <EmptyState icon={<KeyRound className="size-6" />} title="Match not found" />;
  if (!live.match.team_a_id || !live.match.team_b_id)
    return (
      <main className="mx-auto max-w-lg px-4 py-10">
        <EmptyState icon={<KeyRound className="size-6" />} title="Teams not decided yet" text="This match can be scored once both teams are known." />
      </main>
    );

  if (!access || lost)
    return (
      <PinGate
        matchId={id}
        title={`${live.teams.find((t) => t.id === live.match!.team_a_id)?.name} v ${live.teams.find((t) => t.id === live.match!.team_b_id)?.name}`}
        signedIn={!!user}
        lost={lost}
        onAccess={(a) => {
          setLost(null);
          setAccess(a);
        }}
      />
    );

  return <Scorer live={live} access={access} onLost={setLost} />;
}

// The WhatsApp link carries the PIN after # so it never reaches server logs.
// This screen only renders in the browser (after loading), so reading the URL here is safe.
function pinFromLink() {
  if (typeof window === "undefined") return "";
  const pin = new URLSearchParams(window.location.hash.slice(1)).get("pin") ?? "";
  return /^\d{4}$/.test(pin) ? pin : "";
}

function PinGate({ matchId, title, signedIn, lost, onAccess }: { matchId: string; title: string; signedIn: boolean; lost: string | null; onAccess: (a: Access) => void }) {
  const [pin, setPin] = useState(pinFromLink);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState<string | null>(null);

  const claim = useCallback(
    async (usePin: string, force = false) => {
      setBusy(true);
      const device = deviceId();
      const { data, error } = await supabase.rpc("scorer_claim", { p_match: matchId, p_pin: usePin, p_device: device, p_name: name, p_force: force });
      setBusy(false);
      if (error) return toast(errorMessage(error), "error");
      const res = data as { status: string; device_name?: string };
      if (res.status === "wrong_pin") return toast("Wrong PIN", "error");
      if (res.status === "taken") return setTaken(res.device_name ?? "another phone");
      onAccess({ pin: usePin, device });
    },
    [matchId, name, onAccess],
  );

  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-4 py-10">
      <Logo />
      <Card className="mt-6 space-y-4 p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Scorer</p>
          <h1 className="text-xl font-bold text-slate-900">{title}</h1>
          {lost && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">{lost}. Enter the PIN to take it back.</p>}
        </div>
        <Field label="Your name" hint="Shown to the organiser as the scorer">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rahul" />
        </Field>
        <Field label="4-digit PIN from the organiser">
          <Input
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            className="text-center text-2xl tracking-[0.5em]"
            placeholder="••••"
          />
        </Field>
        <Button size="lg" className="w-full" disabled={pin.length !== 4} loading={busy} onClick={() => claim(pin)}>
          Start scoring
        </Button>
        {signedIn && (
          <Button variant="secondary" className="w-full" loading={busy} onClick={() => claim("")}>
            I&apos;m the organiser, score without PIN
          </Button>
        )}
      </Card>
      {taken && (
        <Modal open onClose={() => setTaken(null)} title="Someone is already scoring">
          <p className="text-sm text-slate-600">
            <b>{taken}</b> is scoring this match on another phone. Only one phone can score at a time. Take over from them?
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTaken(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setTaken(null);
                claim(pin, true);
              }}
            >
              Take over
            </Button>
          </div>
        </Modal>
      )}
    </main>
  );
}

function Scorer({ live, access, onLost }: { live: ReturnType<typeof useMatchLive>; access: Access; onLost: (m: string) => void }) {
  const match = live.match!;
  const tournament = live.tournament!;
  const settings = tournament.fixture_settings ?? DEFAULT_SETTINGS;
  const board = useScoreboard(tournament, live.teams, live.players, live.events);
  const { send, undo, call } = useScoringActions(match.id, access, board, live.events, live.setEvents, live.reload, onLost);
  const [menu, setMenu] = useState(false);
  const [editXi, setEditXi] = useState(false);
  const [retire, setRetire] = useState(false);
  const [noResult, setNoResult] = useState(false);
  const { state } = board;
  const teamA = board.team(match.team_a_id);
  const teamB = board.team(match.team_b_id);
  const lineupsReady = (board.lineups[match.team_a_id!]?.length ?? 0) >= 2 && (board.lineups[match.team_b_id!]?.length ?? 0) >= 2;
  const started = state.innings.length > 0;
  const guests = live.guests.filter((g) => g.team_id === match.team_a_id || g.team_id === match.team_b_id);

  let body: React.ReactNode;
  if (match.status === "completed")
    body = (
      <Card className="p-5 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Match finished</p>
        <p className="mt-1 text-xl font-black text-slate-900">{match.result_text}</p>
        <p className="mt-2 text-sm text-slate-500">To change it, the organiser can remove the result from the Fixtures tab.</p>
      </Card>
    );
  else if (noResult) body = <FinishPanel match={match} board={board} settings={settings} call={call} noResult />;
  else if (editXi || !lineupsReady)
    body = (
      <LineupSetup
        match={match}
        teams={[teamA, teamB]}
        players={live.players}
        guests={guests}
        started={started}
        call={call}
        onDone={lineupsReady ? () => setEditXi(false) : undefined}
      />
    );
  else if (state.next === "toss") body = <TossPanel match={match} board={board} send={send} />;
  else if (state.next === "innings_start") body = <OpenersPanel match={match} board={board} send={send} />;
  else if (state.next === "innings_break") body = <InningsBreakOrOpeners board={board} match={match} send={send} />;
  else if (state.next === "finished") body = <FinishPanel match={match} board={board} settings={settings} call={call} />;
  else
    body = (
      <div className="space-y-4">
        <Card className="p-4">
          <LiveSummary board={board} />
        </Card>
        {state.next === "new_batter" && <PickPanel kind="batter" board={board} send={send} />}
        {state.next === "new_bowler" && <PickPanel kind="bowler" board={board} send={send} />}
        {state.next === "ball" && <ScoringPad board={board} send={send} undo={undo} canUndo={live.events.length > 0} />}
        {state.next !== "ball" && (
          <Button variant="secondary" className="w-full" onClick={undo} disabled={!live.events.length}>
            Undo last action
          </Button>
        )}
      </div>
    );

  const inn = state.current;

  return (
    <div className="flex flex-1 flex-col bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-xl items-center gap-2 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-slate-900">
              {teamA?.short_name || teamA?.name} v {teamB?.short_name || teamB?.name}
            </p>
            <p className="flex items-center gap-1 truncate text-xs text-slate-500">
              {live.connected ? <Wifi className="size-3 text-emerald-600" /> : <WifiOff className="size-3 text-amber-600" />}
              Match {match.match_no} · {tournament.name}
            </p>
          </div>
          <a href={`/match/${match.id}`} target="_blank" className="rounded-md p-2 text-slate-500 hover:bg-slate-100" title="Public scorecard">
            <ExternalLink className="size-4" />
          </a>
          <button onClick={() => setMenu(true)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" title="More">
            <Menu className="size-5" />
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 space-y-4 px-4 py-4">
        {body}
        {started && match.status !== "completed" && !editXi && <FullScorecard board={board} />}
      </main>

      {menu && (
        <Modal open onClose={() => setMenu(false)} title="Scoring options">
          <div className="grid gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setMenu(false);
                setEditXi(true);
              }}
            >
              Playing XI / guest players
            </Button>
            <Button
              variant="secondary"
              disabled={!inn || inn.complete || (!inn.striker && !inn.non_striker)}
              onClick={() => {
                setMenu(false);
                setRetire(true);
              }}
            >
              Retire a batter
            </Button>
            <Button
              variant="secondary"
              disabled={!inn || inn.complete}
              onClick={() => {
                setMenu(false);
                if (confirm("End this innings now (e.g. time ran out)?")) send({ type: "end_innings" });
              }}
            >
              End innings now
            </Button>
            <Button
              variant="ghost"
              className="text-rose-600 hover:bg-rose-50"
              onClick={() => {
                setMenu(false);
                setNoResult(true);
              }}
            >
              Abandon match (no result)
            </Button>
            {noResult && (
              <Button
                variant="ghost"
                onClick={() => {
                  setNoResult(false);
                  setMenu(false);
                }}
              >
                Back to scoring
              </Button>
            )}
          </div>
        </Modal>
      )}
      {retire && inn && (
        <RetireModal
          options={[inn.striker, inn.non_striker].filter(Boolean) as string[]}
          name={board.name}
          onClose={() => setRetire(false)}
          onSave={(player, out) => {
            setRetire(false);
            send({ type: "retire", player, out });
          }}
        />
      )}
    </div>
  );
}

function InningsBreakOrOpeners({ board, match, send }: { board: ReturnType<typeof useScoreboard>; match: NonNullable<ReturnType<typeof useMatchLive>["match"]>; send: Parameters<typeof OpenersPanel>[0]["send"] }) {
  const [starting, setStarting] = useState(false);
  return starting ? <OpenersPanel match={match} board={board} send={send} /> : <InningsBreak board={board} onStart={() => setStarting(true)} />;
}

function RetireModal({ options, name, onClose, onSave }: { options: string[]; name: (id: string) => string; onClose: () => void; onSave: (player: string, out: boolean) => void }) {
  const [player, setPlayer] = useState(options[0] ?? "");
  const [out, setOut] = useState(false);
  return (
    <Modal open onClose={onClose} title="Retire a batter">
      <div className="space-y-4">
        <Field label="Batter">
          <Select value={player} onChange={(e) => setPlayer(e.target.value)}>
            {options.map((id) => (
              <option key={id} value={id}>
                {name(id)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Type">
          <Select value={out ? "out" : "hurt"} onChange={(e) => setOut(e.target.value === "out")}>
            <option value="hurt">Retired hurt (can come back, not a wicket)</option>
            <option value="out">Retired out (counts as a wicket)</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(player, out)}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
