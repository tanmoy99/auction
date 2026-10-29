# CricMate

A one-stop site for local cricket tournaments: **player registration → live auction → fixtures → ball-by-ball scoring → stats**.

Built for Indian local tournaments (bids start around ₹500), it works on phones and runs on the free tiers of Supabase and Vercel.

**Live demo:** https://auction-mu-sandy.vercel.app

---

## Features

### For organisers
- **Tournaments.** Create as many as you like. Each one has its own budget per team, base price, squad sizes and status (setting up, live, completed).
- **Players**, added in any of these ways:
  - by hand, with a photo (compressed automatically)
  - **Excel / CSV import** (column names are matched automatically; there's a downloadable template)
  - **Google Sheet** link import
  - a **registration link** players fill in on their phone (share it on WhatsApp)
  - your own **Google Form**, using the Apps Script shown on the Registration tab

  New registrations wait as **Pending** until you approve them. Duplicate phone numbers are ignored.
- **Teams.** Set the colour, logo and purse. **Create an owner login** for each team (a short login ID and password) and share it on WhatsApp.
- **Settings:** bid increment slabs, bid timer, the pause after SOLD / UNSOLD, reset the auction, delete the tournament.

- **Step-by-step guide.** The Overview tab shows the next thing to do (teams, owner logins, players, start, finish, fixtures). An empty dashboard explains how it all works, and owners get bidding tips the first time they open their phone screen.

### Live auction
- **Start and finish** (needs migration 009). The Live auction tab shows a readiness checklist and a **Start auction** button. While it runs there is a **Finish auction** button. Finishing clears the stage, stops automatic steps and blocks new players. The tab, big screen and owner phones then show the final result and what to do next. You can **Reopen** it to auction leftover players.
- **The organiser's control room:**
  - start a random player or the **Up next** player
  - shuffle or choose who is next
  - **SOLD** / **UNSOLD** buttons, restart the timer, cancel a player
  - bid on behalf of a team (for hand-raise bidding in the room)
- **Automatic mode.** When the timer ends the player is SOLD to the highest bidder, or UNSOLD if there were no bids. After a short pause the next player comes up on their own. Both steps can be switched on or off.
- **Team owner phone screen:**
  - one-tap bid, plus a jump bid
  - purse left, max bid allowed, and the squad
  - the phone vibrates when you're outbid
  - an **Up next** strip
  - a **Players** tab showing who is remaining, sold or unsold, and the live status
- **Owners add their own players** (needs migration 008). The owner taps **Players → Ask for permission**, and the organiser approves it once on the **Teams** tab. The owner can then add players themselves, or share a **team join link** on WhatsApp. Players who fill it in go straight into that squad at Rs 0 (purse untouched, squad limit still applies). The organiser can turn it off at any time, which kills the link; players already added stay.
- **Bid rules enforced by the database:**
  - increment slabs
  - max squad size
  - a purse reserve, so a team can always fill its minimum squad at base price
  - a timer that resets on every bid
  - if two owners tap at the same moment, only one bid is accepted for each amount
- **Big screen** (`/live/<id>`): a dark projector or TV view with a SOLD / UNSOLD stamp, team purses and the next player.
- **Squads page** (`/squads/<id>`): every team's squad, live, with an Excel download.
- Every screen updates **live without reloading**, and there's a backup refresh in case a phone's connection drops.

### Fixtures
- **Formats:**
  - **League:** every team plays every other team once or twice (home and away). After the league there can be no playoffs, a **Final**, **Semi-finals** (1v4, 2v3), **Quarter-finals**, or **IPL-style** playoffs (Qualifier 1, Eliminator, Qualifier 2, Final).
  - **Groups + knockout:** 2–8 groups, with the top 1–4 of each group going through. Group winners meet the other group's runner-up. You can shuffle the draw.
  - **Knockout:** a seeded bracket for any number of teams. Byes and preliminary matches are added automatically.
- **Schedule.** Dates and times fill in automatically from the start date, first match time, matches per day and gap between matches (IST). Any match's date, time or ground can be edited afterwards.
- **Quick result entry:** runs, wickets and overs for each side, no result, walkover, or a tie with a super-over winner. The result line ("won by 24 runs") is written automatically.
- **Points table:** P, W, L, T, NR, points, **net run rate** (using the all-out rule) and form. The qualifying places are highlighted.
- **Knockouts fill themselves in.** Table positions go into the playoffs once the league or a group finishes, and every knockout winner moves into the next round. A champion banner appears at the end.
- A public **fixtures page** (`/fixtures/<id>`) with matches, the points table, the bracket and stats. It updates live.

### Ball-by-ball scoring
- **Who can score.** The organiser can score any match. A volunteer can score using a **per-match PIN link** shared on WhatsApp, with no account needed.
  - **Only one phone scores at a time.** A second phone is asked whether to take over, and the first is then locked out.
  - **8 wrong PINs lock the link for 10 minutes.** A new PIN can be made at any time.
- **Playing XI.** Players are picked from each team's auction squad. A scorer can request a **guest player**; it can only go into the XI after the **organiser approves it**.
- **Scoring pad:**
  - 0, 1, 2, 3, 4, 5, 6
  - wide, no-ball, bye, leg-bye
  - OUT: bowled, caught, LBW, run out, stumped, hit wicket
  - **Undo** and swap strike
  - retired hurt or retired out, end innings, abandon (no result)
- **Cricket rules built in:**
  - strike rotation, with batters changing ends after each over
  - maidens
  - free hit after a no-ball (only a run out counts)
  - the same bowler can't bowl two overs in a row
  - max overs per bowler
  - all out when the side runs out of batters
  - the chase ends as soon as the target is reached
- **Local rules for each tournament:** overs, all-out wickets, runs for a wide or no-ball, whether either is bowled again, free hit, and overs per bowler.
- **Live, ball by ball, on every screen at the same time:**
  - the public **scorecard** (`/match/<id>`): live score, CRR / RRR, target, batters, bowler, this over, full batting and bowling cards, fall of wickets, and every over
  - the **big screen** for the ground (`/match/<id>/screen`)
  - the **LIVE** badge and running score on Fixtures
- **Finish match.** Saves the result, updates the points table, NRR and knockouts, and saves every player's match stats.

### Stats
- **Tournament leaderboards:** most runs, most wickets, highest score, best bowling, most sixes, best strike rate (min 20 balls), best economy (min 2 overs), most catches.
- **Full tables:**
  - batting: M, Inn, Runs, HS, Avg, SR, 4s, 6s
  - bowling: overs, wickets, runs, best, economy, average
  - fielding: catches, stumpings, run outs
- Stats update when each scored match is finished, and are removed again if the result is removed.

### Site admin
- An **admin dashboard** (`/admin`) showing every organiser, team owner and tournament, including which auctions are running right now.
- **Open, edit, run, pause, resume or delete any tournament.**
- **Organiser access:**
  - pause or resume, with a reason they will see
  - an **access until** date (the account pauses by itself when it passes, which suits payment plans)
  - private notes
  - make someone admin
  - set a new password, or delete the account
- **Pausing is enforced by the database.** While a tournament is paused:
  - bidding, the auction timer and scoring stop
  - the organiser can't edit it
  - owner phones and the big screen show a "paused" message
- Team owner logins can be paused on their own (they can still watch but can't bid).

---

## Tech

- **Next.js 16** (App Router) + **Tailwind CSS v4** + TypeScript
- **Supabase:**
  - Postgres with row-level security, and all auction, scoring and admin rules as database functions
  - Auth
  - Realtime
  - Storage for photos
- Fixtures and the scoring engine are plain TypeScript ([`src/lib/fixtures.ts`](src/lib/fixtures.ts), [`src/lib/scoring.ts`](src/lib/scoring.ts)). Every ball is stored as an event, and every screen replays the same list, so all screens agree and undo is exact.

---

## Setup

### 1. Supabase project (free, about 5 minutes)

1. Sign up at https://supabase.com and click **New project**. For India, pick the **Mumbai (ap-south-1)** region.
2. Open **SQL Editor → New query**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. It already includes every migration.
   - **Upgrading an older project?** Instead, run the files in [`supabase/migrations/`](supabase/migrations) that you haven't run yet, in order (002 → 009).
3. Go to **Authentication → Sign In / Providers → Email**. Make sure sign-ups are allowed, and turn **off** "Confirm email".
4. Go to **Project Settings → API Keys** and copy:
   - the Project URL
   - the publishable / `anon` key
   - the secret / `service_role` key

### 2. Run locally

```bash
cd cricket-auction
cp .env.example .env.local     # Windows PowerShell: copy .env.example .env.local
# paste the 3 values into .env.local
npm install
npm run dev
```

Open http://localhost:3000, click **Get started** and create your organiser account. To test from phones on the same Wi-Fi, open `http://<your-PC-IP>:3000` (find the IP with `ipconfig`).

### 3. Make yourself the site admin

Run this once in the Supabase SQL Editor, using your own email:

```sql
update public.profiles set is_admin = true
 where id = (select id from auth.users where lower(email) = 'you@example.com');
```

An **Admin** link then appears in the top bar.

### 4. Demo data (optional)

```bash
npm run seed:demo -- you@example.com       # 2 demo tournaments, 6 + 4 teams, 66 players, owner logins dpl1..dpl6 / dcc1..dcc4 (password demo123)
npm run seed:fixtures -- you@example.com   # demo fixtures: league + IPL playoffs, groups + knockout (fully scored ball by ball, one match live), knockout with byes
```

### 5. Deploy to Vercel

1. Push this folder to GitHub, then at https://vercel.com click **Add New → Project** and import the repo.
2. Add the environment variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, then click **Deploy**. Every push to `main` deploys again automatically.
3. In Supabase, go to **Authentication → URL Configuration**. Set **Site URL** to your Vercel address, and add `https://<your-app>.vercel.app/**` to the Redirect URLs.
4. Copy the Google Form Apps Script again from the Registration tab of the **live** site, because it contains the site address.

---

## Tests

```bash
npm run test:scoring    # cricket rules of the scoring engine (no database needed)
npm run test:fixtures   # fixture formats, byes, playoffs, points table, NRR (no database needed)
npm run test:auction    # end-to-end checks against your Supabase project (needs .env.local; run `npm run dev` for the website checks)
```

The database tests cover:
- auction permissions and bid rules
- the automatic timer and "up next"
- admin pausing and access dates
- who can manage fixtures
- scorer PINs, the one-phone lock and guest approval
- event order, undo, finishing a match and stats

They create temporary users and tournaments and delete them at the end.

---

## Free plan limits

| | Free | What it's enough for |
|---|---|---|
| Supabase database | 500 MB | ~80–100 tournaments, each with an auction, scored matches and stats |
| Supabase storage | 1 GB | ~8,000–10,000 player photos |
| Realtime | 200 screens at once, 2M messages a month | ~8–10 auctions at the same time, or a match watched by ~150 people |
| Vercel Hobby | 100 GB traffic | 150,000+ page visits a month |

**Free plan caveats:**
- A free Supabase project **pauses after 7 days with no activity**. Open it the day before an event; to wake it, click **Restore** in the Supabase dashboard.
- There are **no automatic backups** on the free plan.
- **Vercel Hobby is for non-commercial use only.**

**Before charging organisers,** move to Supabase Pro (~$25 a month) and Vercel Pro (~$20 a month), or host the website on Cloudflare instead, and add a domain.

**Not built yet:**
- offline scoring (a tap made with no signal fails and has to be tapped again)
- super overs scored ball by ball (after a tie, the scorer picks the super-over winner)
- "last man stands"
- online payments

---

## Project layout

```
supabase/schema.sql              full database: tables, security rules, auction / scoring / admin functions
supabase/migrations/             step-by-step upgrades (002-009) for existing projects
src/lib/fixtures.ts              fixture generation, scheduling, points table, NRR, knockout progression
src/lib/scoring.ts               ball-by-ball engine: replays events into innings, scorecards, stats
src/lib/hooks.ts                 live data hooks (auction, matches, scoring, stats) with realtime + fallback refresh
src/components/                  UI kit, auction stage, player board, fixtures, scorecard, stats
src/app/dashboard                organiser's tournaments
src/app/t/[id]/...               tournament admin: overview, players, teams, live auction, fixtures, registration, settings
src/app/bid/[id]                 team owner bidding screen (phone)
src/app/bid/[id]/squad           team owner adds players / shares the team join link
src/app/join/[token]             team join form (public, from the owner's WhatsApp link)
src/app/live/[id]                auction big screen (public)
src/app/squads/[id]              squads + Excel download (public)
src/app/fixtures/[id]            fixtures, points table, knockouts, stats (public)
src/app/score/[id]               scorer screen (PIN or organiser)
src/app/match/[id]               live scorecard (public), /screen for the ground's big screen
src/app/register/[token]         public player registration form
src/app/admin                    site admin dashboard
src/app/api/                     owner logins, admin user actions, registration webhook, Google Sheet import
scripts/                         tests and demo data
```
