# Local implementation review

Work is on `improve/cricmate-reliability`, based on local commit `a7182c2`. The remote branch has **not** been refreshed: the user asked to finish locally before pushing. No production data, migrations, hosting settings or scheduler configuration were changed. No push or PR should happen until the remaining integration checks pass.

## Changes

- Public registration and team joins validate Indian mobile numbers, form sizes, age, roles and photo signatures. Google Form question-name mapping remains supported. Canonical phones use `+91` plus ten digits; national and trunk-prefix forms are accepted. Invalid values are rejected rather than truncated.
- Registration saves player/contact records atomically. A unique tournament/mobile index handles competing submissions and retries. Organiser manual entry and spreadsheet imports now use atomic RPCs too (up to 2,000 rows per import).
- Existing duplicate contacts abort migration 011 with a review instruction. No duplicate players are deleted or silently merged. Optional missing phones remain supported for organiser imports/manual entry and authenticated team owners; public registrants must provide a valid phone.
- Storage writes require organiser access to a single valid tournament folder. Public viewing stays enabled. Public upload endpoints use the service key only after link and field validation. A private upload ledger supports safe recovery of interrupted uploads; a registration cannot attach a file already claimed for cleanup.
- Private base-table reads are restricted in migration 018. Allowlisted display views reveal tokens/login fields only to their authorised organiser/owner/admin. Registration lookup uses a token-scoped RPC. Shared hooks load views; private-table Realtime notifications trigger refetches, with HTTP polling for spectators.
- Scoring uses persistent, serial actions with UUIDs and database revisions. Retry deduplication includes Undo. Events, lineups, scorer takeover, match changes and tournament rule changes invalidate stale inputs. Pending actions survive a refresh and stop for review on conflicts; export and confirmed discard support manual reconciliation. Web Locks prevent two tabs sharing the same pending queue. An in-flight write settles before its tab lock is released.
- Initial tournament/match/fixture/stat loading no longer waits for WebSocket subscription. Refetches run on reconnect and visibility changes, with periodic fallback and request-generation guards. Failed HTTP requests retain existing data and expose retry messages on the main public/organiser/scoring pages.
- Auction reset/release/assignment lock the auction row before changing players. Assignment enforces squad limits; bids use the database wall clock at the deadline. A service-only scheduler function reuses the existing atomic tick. Offline owner bids are rejected locally and are never queued.
- Added organiser password recovery, a fixed-destination callback and reset form. Team owners are directed to organiser-managed recovery.
- Existing simulations are labelled **Interactive demo**. `/demo` is browser-only fictional content without database mutations.
- Shared dialogs use native modal semantics, labelled titles, focus wrapping, Escape, background isolation and focus restoration. Privacy/support text avoids invented contacts and retention promises.
- Extended readiness checks cover squad/budget feasibility and volunteer scorer PIN setup. Added local QR generation for public registration/fixtures/match links, trusted audit history, downloadable match/player PNG cards, and sponsor names/logos on scoreboards/cards. Blank sponsor lists preserve the prior screen appearance.
- The same Geist fonts are loaded from the pinned Next.js installation so production builds no longer fetch Google Fonts. Review these paths when upgrading Next.js.

## Verified pre-existing improvements

The local baseline already contained auction start/finish, owner-added players, scorer device claims, PIN throttling on claims, server-side bid rules, Test-match scoring, captain/keeper roles, fixture progression and NRR. These were retained. Existing fixture/scoring assertions were not weakened.

## Validation

| Check | Local result |
|---|---|
| Existing fixture engine | 17 passed |
| Existing scoring engine, including Tests | 27 passed |
| New validation, durable queue and independently decoded QR tests | 8 passed |
| Actual registration/join handlers with mocked transport, including partial failures | 9 passed |
| Embedded PostgreSQL upgrade/security/registration/scoring/auction tests | 21 passed |
| Complete fresh-install schema and second execution | Passed |
| Responsive browser checks, 390/768/1440px | 27 passed |
| Browser scoring: rapid input, pending Undo, offline persistence, conflict, refresh | 5 scenarios passed |
| Result-card PNG rendering, including long names/Test scores | 2 passed |
| ESLint, route generation and TypeScript | Passed |
| Production build | Passed; browser suites also passed against the production server |
| Existing hosted Supabase auction/API integration suite | **Blocked**, exits unsuccessfully before accessing a project |
| Real email recovery delivery, hosted Storage/Realtime and cross-connection races | **Not executed** |
| Actual cron execution with browsers closed | **Not configured or verified** |

The PostgreSQL tests execute the real SQL in PGlite using minimal Auth/Storage schema fixtures. They verify database policies and transaction behaviour, not Supabase's hosted services or true multi-connection contention. Browser tests exercise the actual UI with intercepted Supabase responses; external traffic is blocked. They are not a substitute for a staging end-to-end run. The cold app shell is not an offline-installed PWA: reopening the app requires a connection, while pending input stays in browser storage.

Run `npm run verify:local`. For browser checks, start a local server and run `npm run test:browser` and `npm run test:scoring-browser` (`TEST_APP_URL` defaults to `http://localhost:3100`). Test artifacts are in ignored `artifacts/`; selected screenshots are copied into `docs/screenshots/` for review.

Review screenshots: [phone demo](screenshots/demo-390.png), [desktop demo](screenshots/demo-1440.png), [phone QR](screenshots/qr-390.png), and [long-name Test result](screenshots/long-result.png).

An online dependency installation reported 16 moderate advisories; the original production dependency versions were not upgraded. An offline audit returned no advisories and is **not** accepted as evidence that the online findings are resolved. Review a fresh online audit before release.

## Remaining integration gate

Configure a **separate disposable Supabase test project**, never the production project in the existing `.env.local`. The guarded suite requires:

```text
CRICMATE_TEST_DATABASE=dedicated
TEST_SUPABASE_URL=https://your-dedicated-test-project.supabase.co
TEST_SUPABASE_ANON_KEY=...
TEST_SUPABASE_SERVICE_ROLE_KEY=...
APP_URL=http://localhost:3102
```

The app process at `APP_URL` must also use that test project's normal `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. Use a separate ignored environment file/process; do not replace the working production credentials. The suite refuses a test URL equal to the regular project URL in its own environment. After applying the schema to the disposable project, run the original suite and extend hosted coverage for simultaneous independent registrations/bids, storage failures, scorer takeover, recovery email, and the one-second cron job. Embedded PostgreSQL serialises its connections and cannot prove these cross-service scenarios.

## Deployment order (operator action only)

1. Back up the target database and record its migration state. In a private SQL session, inspect existing duplicate phones:

   ```sql
   select tournament_id,
          right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),10) as mobile,
          array_agg(player_id) as players
   from public.player_contacts
   where length(regexp_replace(coalesce(phone,''),'[^0-9]','','g')) >= 10
   group by tournament_id, right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),10)
   having count(*) > 1;
   ```

   The operator must decide which contacts are mistakes or need correction; keep player records and record any corrections. Migration 011 performs its own canonical duplicate preflight inside a transaction.
2. Apply migrations **011–017** in order, first in the test project. They add the display views/RPCs and hardened writes while retaining old read policies. Old scoring RPCs remain available; new clients use `scorer_action`.
3. Deploy the new app only after the integration gate passes. Reload old tabs and verify owner/organiser/public workflows. Public base-table exposure remains until step 4; minimise this rollout interval.
4. Apply **018** to restrict base-table reads. Do not apply it ahead of the new clients. For a new project, `schema.sql` includes all migrations through 018.
5. Add exact recovery callback URLs to Supabase Auth's redirect allowlist, including `https://YOUR_HOST/auth/callback` and the local test callback. Set the correct Site URL and verify email delivery. The callback ignores arbitrary `next` destinations and only navigates to `/reset-password`.
6. Enable Supabase Cron, then review/run `supabase/enable-auction-scheduler.sql` in the test project. The job uses **`1 second`**, not a minute cron. Inspect `cron.job` and recent `cron.job_run_details`; test with every client closed. Supabase documents second-level intervals at <https://supabase.com/docs/guides/cron>. Scheduling still has database-load/availability latency and is not a hard real-time guarantee. An unavailable/paused database cannot progress an auction. **This work has not enabled any job.**
7. Schedule operator-owned photo maintenance if desired. `node --env-file=YOUR_ENV scripts/cleanup-registration-uploads.mjs` is read-only by default. Review its output, then use `--apply` to claim/delete abandoned uploads older than 24 hours. Referenced images are retained. Failed deletions remain retryable. No production cleanup was run.

No new mandatory application secrets are added. Outside Vercel, public registration requests share a conservative limiter bucket until a trusted host-specific proxy strategy is configured. Limits are 30 submissions per link/address/minute and 300 per address/minute; Google Form imports share their sender address. Large organiser imports use the authenticated import RPC instead.

## Recovery and rollback

- Before changing clients, export pending scoring input from every scorer device. Do not clear local storage to fix a synchronisation conflict. Compare pending input with the public scorecard, export a backup, and explicitly discard/re-enter only the missing actions after reviewing the authoritative score. Revision conflicts deliberately do not rebase automatically.
- Stop the cron with `select cron.unschedule('cricmate-auction-tick');` before rolling back auction behaviour. Restore reviewed function definitions from the previous migration snapshot if necessary.
- Prefer a forward fix. Keep the new private tables, unique index and audit records. Dropping them loses retry history/audit information and can allow duplicate actions/registrations. A prior app version cannot consume the new display views automatically, so rolling back across 018 requires a coordinated client/read-policy plan. **Do not restore unrestricted public reads as an unattended rollback.**
- Migrations 011–018 do not delete existing players. Phone formatting becomes canonical on subsequent writes. Any operator corrections to legacy duplicate contacts require their own backup/audit record; original formatting is not reconstructed automatically.
- Do not run the old full `schema.sql` over an upgraded production project: it can restore permissive policies. Use the reviewed migration sequence and a tested backup restoration plan.

## Regression inventory

Retained paths include organiser/owner/admin/scorer access; tournament setup and suspension; registration/approval/imports/photos; teams, owner logins and guests; auction bids, purses, squads, timers and progression; cancellation/reset/release/reassignment; fixtures/knockouts/points/NRR; limited-overs/Test scoring, extras/free hits/wickets/retirements/Undo; PIN/device control; statistics/public cards/projectors/Excel exports. Engine and selected database/UI behaviour are covered above; full authenticated cross-service regression is still gated on the disposable test environment. This is not an exhaustive regression guarantee.
