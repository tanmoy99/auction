// Demo fixtures with realistic results, so every fixture screen has something to show.
// Safe to re-run: it replaces the demo fixtures (needs migration 006 and npm run seed:demo first).
//
//   npm run seed:fixtures -- you@example.com
//
// - Demo Premier League 2026: league (single round) + IPL playoffs, 11 of 15 league matches played
// - Demo Village Cup 2026 (new, 8 teams): 2 groups of 4, top 2 to semis; groups done, 1 semi played
// - Demo Knockout Trophy 2026 (new, 10 teams): straight knockout with byes, first round under way
// - Demo Champions Cup 2026 is left without fixtures so you can try the generator yourself
import { createClient } from "@supabase/supabase-js";
import * as F from "../src/lib/fixtures.ts";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.argv[2];
if (!URL || !SERVICE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
if (!email) {
  console.error("Usage: npm run seed:fixtures -- your-organiser-email@example.com");
  process.exit(1);
}
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

// small deterministic random so every run gives the same demo
let seed = 7;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

async function must(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}

// Plausible local T10-style scores. Returns the fields of a completed match.
function randomResult(m, s, name) {
  const maxBalls = s.overs * 6;
  if (rand() < 0.05) return { outcome: "no_result", batting_first: null, winner_team_id: null, result_text: "No result" };
  const first = rand() < 0.5 ? "a" : "b";
  const firstWkts = between(3, 10);
  const firstInn = { runs: between(70, 145), wickets: firstWkts, balls: firstWkts >= s.wickets ? between(42, maxBalls) : maxBalls };
  const target = firstInn.runs + 1;
  const chaseWins = rand() < 0.5;
  const secondInn = chaseWins
    ? { runs: target + between(0, 5), wickets: between(1, 8), balls: between(40, maxBalls) }
    : (() => {
        const wickets = between(4, 10);
        return { runs: between(Math.max(40, target - 45), target - 2), wickets, balls: wickets >= s.wickets ? between(36, maxBalls) : maxBalls };
      })();
  const [a, b] = first === "a" ? [firstInn, secondInn] : [secondInn, firstInn];
  const input = {
    outcome: "win",
    batting_first: first,
    a_runs: a.runs,
    a_wickets: a.wickets,
    a_balls: a.balls,
    b_runs: b.runs,
    b_wickets: b.wickets,
    b_balls: b.balls,
    winner_team_id: null,
  };
  const r = F.decideResult(m, input, s, name);
  return { ...input, outcome: r.outcome, winner_team_id: r.winner, result_text: r.text };
}

// Generate, play the first `played` matches in order (filling knockout teams as results come in), save.
async function makeFixtures(t, teams, settings, played, groups) {
  const name = (id) => teams.find((x) => x.id === id)?.name ?? "Team";
  const matches = F.generateFixtures(settings, teams.map((x) => x.id), groups).map((m, i) => ({
    ...m,
    id: `tmp-${i}`,
    tournament_id: t.id,
    status: "scheduled",
    outcome: null,
    winner_team_id: null,
    batting_first: null,
    a_runs: null,
    a_wickets: null,
    a_balls: null,
    b_runs: null,
    b_wickets: null,
    b_balls: null,
    result_text: null,
  }));
  for (const m of matches.slice(0, played)) {
    for (const c of F.resolveTeams(matches, settings)) Object.assign(matches.find((x) => x.id === c.id), c);
    if (!m.team_a_id || !m.team_b_id) break;
    Object.assign(m, { status: "completed" }, randomResult(m, settings, name));
    // a knockout can't end without someone going through
    if (m.stage === "knockout" && !m.winner_team_id) Object.assign(m, { winner_team_id: m.team_a_id, result_text: `No result · ${name(m.team_a_id)} go through` });
  }
  for (const c of F.resolveTeams(matches, settings)) Object.assign(matches.find((x) => x.id === c.id), c);

  await must(admin.from("matches").delete().eq("tournament_id", t.id));
  await must(admin.from("tournaments").update({ fixture_settings: settings }).eq("id", t.id));
  const rows = matches.map((m) => {
    const row = { ...m };
    delete row.id; // temporary id, the database makes the real one
    return row;
  });
  await must(admin.from("matches").insert(rows));
  const done = matches.filter((m) => m.status === "completed").length;
  console.log(`  ${t.name}: ${matches.length} matches, ${done} with results`);
}

const COLORS = ["#dc2626", "#2563eb", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#ca8a04", "#db2777", "#4f46e5", "#0d9488"];

async function freshTournament(organiserId, name, teamNames, venue, startsOn) {
  await must(admin.from("tournaments").delete().eq("organiser_id", organiserId).eq("name", name));
  const t = await must(
    admin.from("tournaments").insert({ organiser_id: organiserId, name, venue, starts_on: startsOn, status: "completed", registration_open: false }).select().single(),
  );
  const teams = await must(
    admin
      .from("teams")
      .insert(teamNames.map(([full, short], i) => ({ tournament_id: t.id, name: full, short_name: short, color: COLORS[i % COLORS.length], purse: t.team_budget })))
      .select(),
  );
  return { t, teams: teams.sort((a, b) => teamNames.findIndex(([n]) => n === a.name) - teamNames.findIndex(([n]) => n === b.name)) };
}

async function main() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const organiser = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!organiser) throw new Error(`No account with email ${email}. Sign up on the site first.`);
  console.log(`\nAdding demo fixtures for ${email}\n`);

  const base = (over) => ({ ...F.DEFAULT_SETTINGS, ...over, schedule: { ...F.DEFAULT_SETTINGS.schedule, ...over.schedule } });

  // 1. League + IPL playoffs on the existing Demo Premier League
  const dpl = await must(admin.from("tournaments").select("*").eq("organiser_id", organiser.id).eq("name", "Demo Premier League 2026").maybeSingle());
  if (dpl) {
    const teams = await must(admin.from("teams").select("*").eq("tournament_id", dpl.id).order("created_at"));
    await makeFixtures(
      dpl,
      teams,
      base({ format: "league", legs: 1, playoff: "ipl", overs: 10, schedule: { start_date: "2026-10-24", first_time: "08:30", per_day: 4, gap_minutes: 120, venue: "Barasat Stadium" } }),
      11,
    );
  } else console.log("  Demo Premier League 2026 not found (run npm run seed:demo first) - skipped");

  // 2. Groups + knockout
  {
    const { t, teams } = await freshTournament(
      organiser.id,
      "Demo Village Cup 2026",
      [
        ["Habra Hurricanes", "HAB"], ["Bongaon Blasters", "BON"], ["Kalyani Kings", "KAL"], ["Naihati Ninjas", "NAI"],
        ["Barasat Bulls", "BAR"], ["Dum Dum Daredevils", "DUM"], ["Basirhat Bravehearts", "BAS"], ["Madhyamgram Mavericks", "MAD"],
      ],
      "Habra High School Ground",
      "2026-10-20",
    );
    await makeFixtures(
      t,
      teams,
      base({ format: "groups", groups: 2, qualify: 2, legs: 1, overs: 8, wickets: 8, schedule: { start_date: "2026-10-20", first_time: "08:00", per_day: 6, gap_minutes: 90, venue: "Habra High School Ground" } }),
      13,
    );
  }

  // 3. Straight knockout with byes
  {
    const { t, teams } = await freshTournament(
      organiser.id,
      "Demo Knockout Trophy 2026",
      [
        ["Ashoknagar Aces", "ASH"], ["Gobardanga Giants", "GOB"], ["Chandpara Champs", "CHA"], ["Thakurnagar Titans", "THA"],
        ["Maslandapur Lions", "MAS"], ["Guma Gladiators", "GUM"], ["Bira Royals", "BIR"], ["Duttapukur Dragons", "DUT"],
        ["Sodepur Strikers", "SOD"], ["Agarpara Avengers", "AGA"],
      ],
      "Ashoknagar Kalyangarh Ground",
      "2026-10-26",
    );
    await makeFixtures(
      t,
      teams,
      base({ format: "knockout", overs: 10, schedule: { start_date: "2026-10-26", first_time: "09:00", per_day: 3, gap_minutes: 150, venue: "Ashoknagar Kalyangarh Ground" } }),
      3,
    );
  }

  console.log("\nDone. Open each tournament's Fixtures tab, or share /fixtures/<tournament id>.\n");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
