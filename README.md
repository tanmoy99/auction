# CricAuction

Live player auctions for local cricket tournaments.

- **Organisers** create tournaments, add players (manually, Excel/CSV, Google Sheet, Google Form or a registration link), add teams with a purse, and run the auction.
- **Team owners** log in on their phone and tap to bid. The highest bid when the auctioneer closes wins the player.
- **Big screen** (`/live/<id>`) for a projector or YouTube stream, and a public **squads** page (`/squads/<id>`).

Built with Next.js 16 + Tailwind CSS and Supabase (database, login, realtime, photo storage). It runs on the free tiers of Supabase and Vercel.

---

## 1. Create the Supabase project (free, about 5 minutes)

1. Sign up at https://supabase.com, then click **New project**. Pick the **Mumbai (ap-south-1)** region for India, and save the database password somewhere safe.
2. Open **SQL Editor → New query**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. You should see "Success".
3. Go to **Authentication → Sign In / Providers → Email** and turn **off** "Confirm email". This makes testing easier. You can turn it back on later.
4. Go to **Project Settings → API Keys** and copy:
   - the Project URL
   - the `anon` / publishable key
   - the `service_role` / secret key

## 2. Run it on your computer

```bash
cd cricket-auction
cp .env.example .env.local     # on Windows PowerShell: copy .env.example .env.local
# open .env.local and paste the 3 values
npm install
npm run dev
```

Open http://localhost:3000, click **Get started** and create your organiser account.

To test bidding from phones on the same Wi-Fi, open `http://<your-PC-IP>:3000` on the phone. Find the IP with `ipconfig`.

## 3. Run a test auction

1. **New tournament**: set the budget (e.g. Rs 50,000), base price Rs 500, and squad size.
2. **Teams** tab: add teams, then **Create owner login** for each one and send the login details on WhatsApp.
3. **Players** tab: **Import** an Excel file (use the **Template** button) or add players by hand.
   **Registration** tab: share the link so players can register themselves. Approve them in Players.
4. **Live auction** tab: click **Next random player** (or **Start** on a player). Owners bid from `/login` on their phones.
   Open **Big screen** on the projector. Click **Sold** to give the player to the highest bidder.

### Auction rules built in
- Bid increments by slab (default: +500 up to Rs 5,000, +1,000 up to Rs 20,000, then +2,000). Change these in Settings.
- Timer resets after every bid (default 30s, 0 = no timer).
- A team can't bid more than its purse minus the money needed to fill its **minimum squad** at base price.
- Max squad size is enforced.
- If two owners tap at the same moment, the database accepts only one bid for each amount.
- Undo a sale from the Players list. Assign icon or captain players directly with the shield button.

## 4. Deploy to Vercel (free)

1. Push this folder to a GitHub repository.
2. At https://vercel.com: **Add New → Project**, then import the repo.
3. Add the same 3 environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`), then click **Deploy**.
4. In Supabase, open **Authentication → URL Configuration** and set **Site URL** to your Vercel address.
5. Now the **Google Form** option works: in the Registration tab, copy the Apps Script and follow the steps there.

The free plans are fine for testing and for running your own tournaments. Vercel Hobby is for non-commercial use only, so if you charge organisers you need Vercel Pro. A free Supabase project pauses after 7 days with no activity; open the dashboard and click **Restore** to wake it.

## Project layout

```
supabase/schema.sql          tables, security rules, auction functions (bidding logic lives here)
src/lib/                     supabase clients, live-data hooks, formatting, Excel/Form field mapping
src/components/              UI kit, auction stage, toasts
src/app/dashboard            organiser's tournaments
src/app/t/[id]/...           tournament admin: overview, players, teams, live auction, registration, settings
src/app/bid/[id]             team owner bidding screen (phone)
src/app/live/[id]            big screen display (public)
src/app/squads/[id]          squads + Excel download (public)
src/app/register/[token]     public player registration form
src/app/api/                 owner login creation, registration webhook, Google Sheet import
```
