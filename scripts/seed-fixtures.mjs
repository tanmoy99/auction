// Demo fixtures with realistic results, so every fixture screen has something to show.
// Safe to re-run: it replaces the demo fixtures (needs migration 006 and npm run seed:demo first).
//
//   npm run seed:fixtures -- you@example.com
//
// - Demo Premier League 2026: league (single round) + IPL playoffs, 11 of 15 league matches played
// - Demo Village Cup 2026 (new, 8 teams): 2 groups of 4, top 2 to semis. Every match scored ball by ball
//   (full scorecards + player stats); semi-final 1 done, semi-final 2 LIVE mid-chase, 1 guest waiting approval
// - Demo Knockout Trophy 2026 (new, 10 teams): straight knockout with byes, first round under way
// - Demo Champions Cup 2026 is left without fixtures so you can try the generator yourself
import { createClient } from "@supabase/supabase-js";
import * as F from "../src/lib/fixtures.ts";
import * as S from "../src/lib/scoring.ts";

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

// ---------------------------------------------------------------------
// Ball-by-ball simulation (Village Cup)
// ---------------------------------------------------------------------

const FIRST = ["Rahul", "Sourav", "Arijit", "Debashis", "Subhankar", "Amit", "Rohit", "Sandip", "Abhishek", "Pritam", "Saikat", "Ankit", "Tanmay", "Rajib", "Sumit", "Bikram", "Arnab", "Koushik", "Partha", "Manoj", "Vikas", "Suman", "Avijit", "Raju", "Deep", "Nilanjan", "Soumya", "Joy", "Biswajit", "Sayan", "Imran", "Asif", "Rakesh", "Gourab", "Ritam", "Shubham", "Akash", "Pintu", "Bapi", "Mithun"];
const LAST = ["Das", "Ghosh", "Saha", "Mondal", "Roy", "Paul", "Sarkar", "Biswas", "Dey", "Sen", "Banerjee", "Chatterjee", "Mukherjee", "Haldar", "Sheikh", "Khan", "Pramanik", "Bose", "Nath", "Kundu"];
const SQUAD_ROLES = ["Batsman", "Batsman", "Wicket-keeper", "Batsman", "All-rounder", "All-rounder", "All-rounder", "Bowler", "Bowler", "Bowler", "Bowler"];

function pickWeighted(options) {
  let r = rand() * options.reduce((sum, [, w]) => sum + w, 0);
  for (const [value, w] of options) if ((r -= w) <= 0) return value;
  return options[0][0];
}

// One delivery: mostly singles and dots, some boundaries, a wicket every ~16 balls
function randomBall(inn, bowlingXi) {
  const kind = pickWeighted([["dot", 34], ["1", 28], ["2", 9], ["3", 1], ["4", 11], ["6", 5], ["out", 6.5], ["wd", 4], ["nb", 1], ["lb", 1]]);
  if (kind === "wd") return { type: "ball", runs: 0, extra: "wd", extra_runs: 0, wicket: null };
  if (kind === "nb") return { type: "ball", runs: pickWeighted([[0, 3], [1, 2], [4, 1]]), extra: "nb", extra_runs: 0, wicket: null };
  if (kind === "lb") return { type: "ball", runs: 0, extra: "lb", extra_runs: 1, wicket: null };
  if (kind === "out") {
    const how = pickWeighted([["bowled", 28], ["caught", 46], ["lbw", 9], ["run_out", 11], ["stumped", 6]]);
    const fielder = how === "stumped" ? bowlingXi[2] : how === "caught" || how === "run_out" ? bowlingXi[between(0, bowlingXi.length - 1)] : null;
    const out = how === "run_out" && rand() < 0.4 ? inn.non_striker : inn.striker;
    return { type: "ball", runs: how === "run_out" ? between(0, 1) : 0, extra: null, extra_runs: 0, wicket: { kind: how, out, fielder } };
  }
  return { type: "ball", runs: kind === "dot" ? 0 : Number(kind), extra: null, extra_runs: 0, wicket: null };
}

// Plays a match event by event with the real scoring engine. A live match stops `stopAfterBalls` balls into the chase.
function simulate(m, lineups, rules, stopAfterBalls = Infinity) {
  const events = [];
  const add = (data) => events.push({ seq: events.length + 1, data });
  const tossWinner = [m.team_a_id, m.team_b_id][between(0, 1)];
  const decision = rand() < 0.6 ? "bat" : "bowl";
  add({ type: "toss", winner: tossWinner, decision });
  const other = (team) => (team === m.team_a_id ? m.team_b_id : m.team_a_id);
  const first = decision === "bat" ? tossWinner : other(tossWinner);

  for (const bat of [first, other(first)]) {
    const bowl = other(bat);
    const order = lineups[bat];
    const bowlers = lineups[bowl].slice(-5);
    add({ type: "innings_start", batting_team: bat, bowling_team: bowl, striker: order[0], non_striker: order[1], bowler: bowlers[0] });
    let nextBat = 2;
    for (;;) {
      const st = S.replay(events, rules, lineups);
      const inn = st.current;
      if (st.next === "new_batter") {
        if (nextBat >= order.length) break;
        add({ type: "new_batter", player: order[nextBat++] });
      } else if (st.next === "new_bowler") {
        const options = S.availableBowlers(inn, bowlers, rules).filter((b) => !b.reason);
        const pool = options.length ? options : S.availableBowlers(inn, lineups[bowl], rules).filter((b) => !b.reason);
        add({ type: "new_bowler", player: pool[between(0, pool.length - 1)].id });
      } else if (st.next === "ball") {
        if (st.innings.length === 2 && (inn.legal_balls >= stopAfterBalls || inn.runs >= st.target * 0.6)) return events;
        add(randomBall(inn, lineups[bowl]));
      } else break;
    }
  }
  return events;
}

// Like makeFixtures, but every played match gets squads, a playing XI and a ball-by-ball scorecard
async function scoredFixtures(t, teams, settings, played) {
  const name = (id) => teams.find((x) => x.id === id)?.name ?? "Team";
  const rules = S.defaultRules(settings);
  // 11-player squads, as if bought in the auction
  const used = new Set();
  const squadRows = teams.flatMap((team) =>
    SQUAD_ROLES.map((role) => {
      let full;
      do full = `${FIRST[between(0, FIRST.length - 1)]} ${LAST[between(0, LAST.length - 1)]}`;
      while (used.has(full));
      used.add(full);
      return { tournament_id: t.id, name: full, role, base_price: 500, status: "sold", team_id: team.id, sold_price: 500 * between(1, 8) };
    }),
  );
  const squad = await must(admin.from("players").insert(squadRows).select("id, name, role, team_id"));
  await must(admin.from("matches").delete().eq("tournament_id", t.id));
  await must(admin.from("tournaments").update({ fixture_settings: settings }).eq("id", t.id));
  const rows = F.generateFixtures(settings, teams.map((x) => x.id)).map((m) => ({ ...m, tournament_id: t.id }));
  const matches = (await must(admin.from("matches").insert(rows).select())).sort((a, b) => a.match_no - b.match_no);

  const refresh = async () => {
    for (const c of F.resolveTeams(matches, settings)) {
      await must(admin.from("matches").update({ team_a_id: c.team_a_id, team_b_id: c.team_b_id }).eq("id", c.id));
      Object.assign(matches.find((x) => x.id === c.id), c);
    }
  };

  for (let i = 0; i <= played && i < matches.length; i++) {
    await refresh();
    const m = matches[i];
    if (!m.team_a_id || !m.team_b_id) break;
    const isLive = i === played;
    const xiRows = [m.team_a_id, m.team_b_id].flatMap((team) =>
      squad
        .filter((p) => p.team_id === team)
        .map((p, k) => ({ match_id: m.id, tournament_id: t.id, team_id: team, player_id: p.id, name: p.name, role: p.role, sort: k + 1 })),
    );
    const xi = (await must(admin.from("match_players").insert(xiRows).select())).sort((a, b) => a.sort - b.sort);
    const lineups = {};
    for (const p of xi) (lineups[p.team_id] ??= []).push(p.id);
    const names = new Map(xi.map((p) => [p.id, p.name]));
    const events = simulate(m, lineups, rules, isLive ? between(18, 30) : Infinity);
    await must(admin.from("match_events").insert(events.map((e) => ({ match_id: m.id, tournament_id: t.id, seq: e.seq, type: e.data.type, data: e.data }))));
    const state = S.replay(events, rules, lineups, (id) => names.get(id) ?? "Player");

    if (isLive) {
      await must(admin.from("matches").update({ status: "live", live_score: S.liveScore(state, rules) }).eq("id", m.id));
      // a guest the scorer asked for, waiting for the organiser
      await must(admin.from("guest_players").insert({ tournament_id: t.id, team_id: m.team_a_id, match_id: m.id, name: "Bapi Sheikh", role: "Bowler", status: "pending" }));
      console.log(`  Match ${m.match_no} (${m.round_name}) is LIVE: ${name(state.current.batting_team)} ${state.current.runs}/${state.current.wickets}`);
      break;
    }
    const scores = S.resultScores(state, m.team_a_id);
    const tied = scores.a_runs === scores.b_runs;
    const r = F.decideResult(m, { outcome: "win", winner_team_id: tied ? m.team_a_id : null, ...scores }, rules, name);
    const patch = { status: "completed", outcome: r.outcome, winner_team_id: r.winner, result_text: r.text, ...scores };
    await must(admin.from("matches").update(patch).eq("id", m.id));
    Object.assign(m, patch);
    const stats = S.matchStats(state, lineups).map((st) => {
      const mp = xi.find((p) => p.id === st.match_player_id);
      return { ...st, match_id: m.id, tournament_id: t.id, player_id: mp.player_id, guest_id: null, name: mp.name };
    });
    await must(admin.from("player_match_stats").insert(stats));
  }
  await refresh();
  const done = matches.filter((m) => m.status === "completed").length;
  console.log(`  ${t.name}: ${matches.length} matches, ${done} scored ball by ball`);
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
    await scoredFixtures(
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
