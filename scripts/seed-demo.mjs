// Loads demo tournaments, teams, owner logins and players into an organiser's account.
// Safe to re-run: it replaces the previous demo data.
//
//   npm run seed:demo -- you@example.com
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.argv[2];
if (!URL || !SERVICE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
if (!email) {
  console.error("Usage: npm run seed:demo -- your-organiser-email@example.com");
  process.exit(1);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const OWNER_DOMAIN = "owners.cricauction.app";
const OWNER_PASSWORD = "demo123";

const FIRST = [
  "Rahul", "Sourav", "Arijit", "Debashis", "Subhankar", "Amit", "Rohit", "Sandip", "Abhishek", "Pritam",
  "Saikat", "Ankit", "Tanmay", "Rajib", "Sumit", "Bikram", "Arnab", "Koushik", "Partha", "Manoj",
  "Vikas", "Suman", "Avijit", "Raju", "Deep", "Nilanjan", "Soumya", "Joy", "Biswajit", "Sayan",
  "Imran", "Asif", "Rakesh", "Gourab", "Ritam", "Shubham", "Akash", "Pintu", "Bapi", "Mithun",
];
const LAST = ["Das", "Ghosh", "Saha", "Mondal", "Roy", "Paul", "Sarkar", "Biswas", "Dey", "Sen", "Banerjee", "Chatterjee", "Mukherjee", "Haldar", "Sheikh", "Khan", "Pramanik", "Bose", "Nath", "Kundu"];
const CITIES = ["Barasat", "Habra", "Madhyamgram", "Barrackpore", "Dum Dum", "Bongaon", "Basirhat", "Kalyani", "Naihati", "Hridaypur"];
const ROLES = [
  ["Batsman", "Right-hand bat", "Does not bowl"],
  ["Batsman", "Left-hand bat", "Right-arm off spin"],
  ["Bowler", "Right-hand bat", "Right-arm fast"],
  ["Bowler", "Right-hand bat", "Left-arm spin"],
  ["Bowler", "Left-hand bat", "Left-arm medium"],
  ["All-rounder", "Right-hand bat", "Right-arm medium"],
  ["All-rounder", "Left-hand bat", "Right-arm leg spin"],
  ["Wicket-keeper", "Right-hand bat", "Does not bowl"],
];

// small deterministic random so every run gives the same demo
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

function makePlayers(tournamentId, count, basePrice, { pending = 0 } = {}) {
  const used = new Set();
  return Array.from({ length: count + pending }, (_, i) => {
    let name;
    do name = `${pick(FIRST)} ${pick(LAST)}`;
    while (used.has(name));
    used.add(name);
    const [role, batting, bowling] = pick(ROLES);
    const star = i < 4;
    return {
      row: {
        tournament_id: tournamentId,
        name,
        role,
        batting_style: batting,
        bowling_style: bowling,
        age: 18 + Math.floor(rand() * 20),
        city: pick(CITIES),
        // about two thirds get a demo face photo, the rest show initials
        photo_url: i % 3 === 2 ? null : `https://randomuser.me/api/portraits/men/${(i * 7) % 99}.jpg`,
        category: star ? "Icon" : i < 16 ? "A" : "B",
        base_price: star ? basePrice * 4 : basePrice,
        status: i >= count ? "pending" : "available",
        source: i >= count ? "google-form" : "excel",
      },
      phone: `9${String(800000000 + Math.floor(rand() * 199999999)).padStart(9, "0")}`,
    };
  });
}

async function must(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}

async function findUserByEmail(target) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === target.toLowerCase());
    if (hit || data.users.length < 200) return hit ?? null;
  }
  return null;
}

async function ownerLogin(team, login) {
  const userEmail = `${login}@${OWNER_DOMAIN}`;
  const existing = await findUserByEmail(userEmail);
  if (existing) await admin.auth.admin.deleteUser(existing.id);
  const { data, error } = await admin.auth.admin.createUser({
    email: userEmail,
    password: OWNER_PASSWORD,
    email_confirm: true,
    app_metadata: { role: "owner" },
    user_metadata: { full_name: team.owner_name },
  });
  if (error) throw error;
  await must(admin.from("profiles").upsert({ id: data.user.id, role: "owner", full_name: team.owner_name }));
  await must(admin.from("teams").update({ owner_user_id: data.user.id, owner_login: login }).eq("id", team.id));
  return login;
}

async function createTournament(organiserId, info, teamDefs, playerCount, pending) {
  const old = await must(admin.from("tournaments").select("id").eq("organiser_id", organiserId).eq("name", info.name));
  for (const o of old) await must(admin.from("tournaments").delete().eq("id", o.id));

  const t = await must(admin.from("tournaments").insert({ ...info, organiser_id: organiserId }).select().single());
  const teams = await must(
    admin
      .from("teams")
      .insert(teamDefs.map(([name, short_name, color, owner_name]) => ({ tournament_id: t.id, name, short_name, color, owner_name, purse: t.team_budget })))
      .select(),
  );
  const generated = makePlayers(t.id, playerCount, t.base_price, { pending });
  const players = await must(admin.from("players").insert(generated.map((g) => g.row)).select());
  await must(admin.from("player_contacts").insert(players.map((p, i) => ({ player_id: p.id, tournament_id: t.id, phone: generated[i].phone }))));
  return { t, teams, players };
}

async function main() {
  const organiser = await findUserByEmail(email);
  if (!organiser) throw new Error(`No account found for ${email}. Sign up on the site first.`);
  console.log(`Seeding demo data for ${email}\n`);

  // 1) Fresh tournament, ready to run the auction yourself
  const one = await createTournament(
    organiser.id,
    {
      name: "Demo Premier League 2026",
      venue: "Barasat Stadium",
      starts_on: "2026-11-15",
      team_budget: 50000,
      base_price: 500,
      min_squad: 8,
      max_squad: 12,
      bid_timer_seconds: 30,
    },
    [
      ["Barasat Blasters", "BB", "#059669", "Sourav Ghosh"],
      ["Habra Hurricanes", "HH", "#2563eb", "Amit Saha"],
      ["Kalyani Kings", "KK", "#dc2626", "Rajib Mondal"],
      ["Madhyamgram Mavericks", "MM", "#d97706", "Partha Roy"],
      ["Naihati Ninjas", "NN", "#7c3aed", "Bikram Paul"],
      ["Dum Dum Dynamos", "DD", "#db2777", "Arnab Dey"],
    ],
    60,
    6,
  );
  const logins1 = [];
  for (const [i, team] of one.teams.entries()) logins1.push([team.name, await ownerLogin(team, `dpl${i + 1}`)]);

  // 2) Auction already half-way, so squads / big screen / history have something to show
  const two = await createTournament(
    organiser.id,
    {
      name: "Demo Champions Cup 2026",
      venue: "Kalyani Ground",
      starts_on: "2026-10-30",
      team_budget: 30000,
      base_price: 500,
      min_squad: 6,
      max_squad: 9,
      bid_timer_seconds: 0,
      status: "live",
    },
    [
      ["Bongaon Bulls", "BOB", "#0891b2", "Koushik Biswas"],
      ["Basirhat Royals", "BR", "#65a30d", "Imran Sheikh"],
      ["Barrackpore Titans", "BT", "#ea580c", "Suman Sen"],
      ["Hridaypur Heroes", "HRH", "#4b5563", "Joy Kundu"],
    ],
    32,
    0,
  );
  const logins2 = [];
  for (const [i, team] of two.teams.entries()) logins2.push([team.name, await ownerLogin(team, `dcc${i + 1}`)]);

  // sell 14 players with a realistic bid history, mark 3 unsold
  const spent = Object.fromEntries(two.teams.map((x) => [x.id, 0]));
  const bids = [];
  for (let i = 0; i < 14; i++) {
    const p = two.players[i];
    let amount = p.base_price;
    const rounds = 1 + Math.floor(rand() * 6);
    let teamIdx = Math.floor(rand() * 4);
    for (let r = 0; r < rounds; r++) {
      bids.push({ tournament_id: two.t.id, player_id: p.id, team_id: two.teams[teamIdx].id, amount });
      teamIdx = (teamIdx + 1 + Math.floor(rand() * 3)) % 4;
      amount += amount < 5000 ? 500 : 1000;
    }
    const winner = bids.at(-1);
    spent[winner.team_id] += winner.amount;
    await must(admin.from("players").update({ status: "sold", team_id: winner.team_id, sold_price: winner.amount }).eq("id", p.id));
  }
  await must(admin.from("bids").insert(bids));
  for (const [id, value] of Object.entries(spent)) await must(admin.from("teams").update({ spent: value }).eq("id", id));
  await must(admin.from("players").update({ status: "unsold" }).in("id", two.players.slice(14, 17).map((p) => p.id)));

  // a player on stage right now with two bids, so the bidding screens are live immediately
  const onStage = two.players[17];
  await must(
    admin.from("bids").insert([
      { tournament_id: two.t.id, player_id: onStage.id, team_id: two.teams[0].id, amount: 500 },
      { tournament_id: two.t.id, player_id: onStage.id, team_id: two.teams[2].id, amount: 1000 },
    ]),
  );
  await must(
    admin
      .from("auction_state")
      .update({ player_id: onStage.id, current_bid: 1000, leading_team_id: two.teams[2].id, phase: "bidding", ends_at: null, updated_at: new Date().toISOString() })
      .eq("tournament_id", two.t.id),
  );

  const print = (title, t, logins) => {
    console.log(`\x1b[1m${title}\x1b[0m`);
    console.log(`  Admin:      http://localhost:3000/t/${t.id}`);
    console.log(`  Big screen: http://localhost:3000/live/${t.id}`);
    console.log(`  Register:   http://localhost:3000/register/${t.registration_token}`);
    console.log(`  Owner logins (password: ${OWNER_PASSWORD}):`);
    for (const [name, login] of logins) console.log(`    ${login.padEnd(6)} ${name}`);
    console.log();
  };
  print("Demo Premier League 2026  (60 players + 6 pending, ready to start)", one.t, logins1);
  print("Demo Champions Cup 2026   (auction in progress, 14 sold, 3 unsold, 1 on stage)", two.t, logins2);
}

main().catch((e) => {
  console.error("Seeding failed:", e.message);
  process.exit(1);
});
