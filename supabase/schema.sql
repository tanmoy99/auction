-- =====================================================================
-- Cricket Auction - database schema
-- Run this whole file once in Supabase: Dashboard -> SQL Editor -> New query -> Run
-- It is safe to re-run (drops and recreates functions/policies, keeps data).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

-- One row per login. role = 'organiser' (runs tournaments) or 'owner' (team owner, can only bid)
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  role text not null default 'organiser' check (role in ('organiser', 'owner')),
  full_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  organiser_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  venue text,
  starts_on date,
  team_budget integer not null default 100000 check (team_budget > 0),
  base_price integer not null default 500 check (base_price > 0),
  min_squad integer not null default 11 check (min_squad >= 0),
  max_squad integer not null default 15 check (max_squad > 0),
  bid_timer_seconds integer not null default 30 check (bid_timer_seconds >= 0),
  -- bid increments by slab: below "upto" the step is "step". Last slab has upto = null.
  increment_slabs jsonb not null default '[{"upto":5000,"step":500},{"upto":20000,"step":1000},{"upto":null,"step":2000}]',
  registration_open boolean not null default true,
  registration_token uuid not null default gen_random_uuid() unique,
  status text not null default 'setup' check (status in ('setup', 'live', 'completed')),
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments on delete cascade,
  name text not null,
  short_name text,
  color text not null default '#059669',
  logo_url text,
  owner_name text,
  owner_user_id uuid references auth.users on delete set null,
  owner_login text,
  purse integer not null check (purse >= 0),
  spent integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists teams_tournament_idx on public.teams (tournament_id);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments on delete cascade,
  name text not null,
  role text,
  batting_style text,
  bowling_style text,
  age integer,
  city text,
  photo_url text,
  category text,
  base_price integer not null check (base_price > 0),
  status text not null default 'available' check (status in ('pending', 'available', 'sold', 'unsold')),
  team_id uuid references public.teams on delete set null,
  sold_price integer,
  source text not null default 'manual',
  created_at timestamptz not null default now()
);
create index if not exists players_tournament_idx on public.players (tournament_id);
create index if not exists players_team_idx on public.players (team_id);

-- Phone numbers are kept apart so the public big screen can never read them
create table if not exists public.player_contacts (
  player_id uuid primary key references public.players on delete cascade,
  tournament_id uuid not null references public.tournaments on delete cascade,
  phone text
);
create index if not exists player_contacts_phone_idx on public.player_contacts (tournament_id, phone);

-- Exactly one row per tournament: what is on the auction stage right now
create table if not exists public.auction_state (
  tournament_id uuid primary key references public.tournaments on delete cascade,
  player_id uuid references public.players on delete set null,
  current_bid integer,
  leading_team_id uuid references public.teams on delete set null,
  phase text not null default 'idle' check (phase in ('idle', 'bidding', 'sold', 'unsold')),
  ends_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.bids (
  id bigint generated always as identity primary key,
  tournament_id uuid not null references public.tournaments on delete cascade,
  player_id uuid not null references public.players on delete cascade,
  team_id uuid not null references public.teams on delete cascade,
  amount integer not null,
  created_at timestamptz not null default now()
);
create index if not exists bids_player_idx on public.bids (tournament_id, player_id, created_at desc);

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    case when new.raw_app_meta_data->>'role' = 'owner' then 'owner' else 'organiser' end,
    new.raw_user_meta_data->>'full_name'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Supabase sets app_metadata (our "owner" flag) just after the insert, so keep the profile in sync on update too
create or replace function public.handle_user_role_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.raw_app_meta_data->>'role' = 'owner' then
    update public.profiles set role = 'owner' where id = new.id and role <> 'owner';
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_role_change on auth.users;
create trigger on_auth_user_role_change after update of raw_app_meta_data on auth.users
  for each row execute function public.handle_user_role_change();

create or replace function public.handle_new_tournament() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.auction_state (tournament_id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_tournament_created on public.tournaments;
create trigger on_tournament_created after insert on public.tournaments
  for each row execute function public.handle_new_tournament();

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

create or replace function public.is_organiser(p_tournament uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tournaments where id = p_tournament and organiser_id = auth.uid());
$$;

-- Step to add on top of the current bid (mirrors bidStep() in src/lib/format.ts)
create or replace function public.bid_step(p_slabs jsonb, p_amount integer) returns integer
language sql immutable as $$
  select coalesce((
    select (s.value->>'step')::integer
    from jsonb_array_elements(p_slabs) with ordinality as s(value, idx)
    where coalesce(s.value->>'upto', '') = '' or p_amount < (s.value->>'upto')::integer
    order by s.idx
    limit 1
  ), 500);
$$;

create or replace function public.server_now() returns timestamptz
language sql stable as $$ select now() $$;

-- ---------------------------------------------------------------------
-- Auction functions (all bidding goes through these, never direct table writes)
-- ---------------------------------------------------------------------

-- Internal: validates and records a bid. Row lock on auction_state makes
-- simultaneous bids safe - only one can win each increment.
create or replace function public.apply_bid(p_tournament uuid, p_team uuid, p_amount integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  st public.auction_state%rowtype;
  t public.tournaments%rowtype;
  tm public.teams%rowtype;
  p public.players%rowtype;
  v_min integer;
  v_squad integer;
  v_max integer;
begin
  select * into st from public.auction_state where tournament_id = p_tournament for update;
  if not found or st.phase <> 'bidding' or st.player_id is null then
    raise exception 'Bidding is not open right now';
  end if;
  if st.ends_at is not null and now() > st.ends_at then
    raise exception 'Time is up for this player';
  end if;

  select * into tm from public.teams where id = p_team and tournament_id = p_tournament;
  if not found then raise exception 'Team not found'; end if;
  if st.leading_team_id = tm.id then raise exception 'You already have the highest bid'; end if;

  select * into t from public.tournaments where id = p_tournament;
  select * into p from public.players where id = st.player_id;

  v_min := case when st.current_bid is null then p.base_price
                else st.current_bid + public.bid_step(t.increment_slabs, st.current_bid) end;
  if p_amount < v_min then raise exception 'Minimum bid is Rs %', v_min; end if;

  select count(*) into v_squad from public.players where team_id = tm.id and status = 'sold';
  if v_squad >= t.max_squad then raise exception 'Squad is full (% players)', t.max_squad; end if;

  -- keep enough money to fill the remaining minimum squad at base price
  v_max := (tm.purse - tm.spent) - greatest(t.min_squad - v_squad - 1, 0) * t.base_price;
  if p_amount > v_max then
    raise exception 'Not enough purse. Max bid allowed is Rs %', greatest(v_max, 0);
  end if;

  update public.auction_state
     set current_bid = p_amount,
         leading_team_id = tm.id,
         ends_at = case when t.bid_timer_seconds > 0 then now() + make_interval(secs => t.bid_timer_seconds) end,
         updated_at = now()
   where tournament_id = p_tournament;

  insert into public.bids (tournament_id, player_id, team_id, amount)
  values (p_tournament, st.player_id, tm.id, p_amount);

  return jsonb_build_object('amount', p_amount, 'team_id', tm.id);
end $$;

-- Team owner bids for their own team
create or replace function public.place_bid(p_tournament uuid, p_amount integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
begin
  select id into v_team from public.teams
   where tournament_id = p_tournament and owner_user_id = auth.uid();
  if v_team is null then raise exception 'You are not a team owner in this tournament'; end if;
  return public.apply_bid(p_tournament, v_team, p_amount);
end $$;

-- Organiser bids on behalf of a team (owner bidding by hand-raise in the room)
create or replace function public.admin_bid(p_tournament uuid, p_team uuid, p_amount integer)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_organiser(p_tournament) then raise exception 'Only the organiser can do this'; end if;
  return public.apply_bid(p_tournament, p_team, p_amount);
end $$;

create or replace function public.start_player(p_tournament uuid, p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  st public.auction_state%rowtype;
  t public.tournaments%rowtype;
  p public.players%rowtype;
begin
  if not public.is_organiser(p_tournament) then raise exception 'Only the organiser can do this'; end if;
  select * into st from public.auction_state where tournament_id = p_tournament for update;
  if st.phase = 'bidding' then raise exception 'Finish the current player first'; end if;

  select * into p from public.players where id = p_player and tournament_id = p_tournament;
  if not found or p.status not in ('available', 'unsold') then
    raise exception 'This player is not available for auction';
  end if;

  select * into t from public.tournaments where id = p_tournament;
  update public.auction_state
     set player_id = p_player,
         current_bid = null,
         leading_team_id = null,
         phase = 'bidding',
         ends_at = case when t.bid_timer_seconds > 0 then now() + make_interval(secs => t.bid_timer_seconds) end,
         updated_at = now()
   where tournament_id = p_tournament;
  update public.tournaments set status = 'live' where id = p_tournament and status = 'setup';
end $$;

-- Close bidding: sold to the highest bidder, or unsold if nobody bid
create or replace function public.close_player(p_tournament uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  st public.auction_state%rowtype;
begin
  if not public.is_organiser(p_tournament) then raise exception 'Only the organiser can do this'; end if;
  select * into st from public.auction_state where tournament_id = p_tournament for update;
  if st.phase <> 'bidding' then raise exception 'No player is being auctioned'; end if;

  if st.leading_team_id is not null then
    update public.players set status = 'sold', team_id = st.leading_team_id, sold_price = st.current_bid
     where id = st.player_id;
    update public.teams set spent = spent + st.current_bid where id = st.leading_team_id;
    update public.auction_state set phase = 'sold', ends_at = null, updated_at = now()
     where tournament_id = p_tournament;
    return 'sold';
  end if;

  update public.players set status = 'unsold' where id = st.player_id;
  update public.auction_state set phase = 'unsold', ends_at = null, updated_at = now()
   where tournament_id = p_tournament;
  return 'unsold';
end $$;

-- Take the current player off the stage without a result (bids are kept as history)
create or replace function public.cancel_player(p_tournament uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_organiser(p_tournament) then raise exception 'Only the organiser can do this'; end if;
  update public.auction_state
     set player_id = null, current_bid = null, leading_team_id = null, phase = 'idle', ends_at = null, updated_at = now()
   where tournament_id = p_tournament;
end $$;

create or replace function public.reset_timer(p_tournament uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_secs integer;
begin
  if not public.is_organiser(p_tournament) then raise exception 'Only the organiser can do this'; end if;
  select bid_timer_seconds into v_secs from public.tournaments where id = p_tournament;
  update public.auction_state
     set ends_at = case when v_secs > 0 then now() + make_interval(secs => v_secs) end, updated_at = now()
   where tournament_id = p_tournament and phase = 'bidding';
end $$;

-- Undo a sale / send a player back to the auction pool
create or replace function public.release_player(p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.players%rowtype;
begin
  select * into p from public.players where id = p_player for update;
  if not found or not public.is_organiser(p.tournament_id) then raise exception 'Only the organiser can do this'; end if;
  if exists (select 1 from public.auction_state where player_id = p_player and phase = 'bidding') then
    raise exception 'This player is being auctioned right now';
  end if;
  if p.status = 'sold' and p.team_id is not null then
    update public.teams set spent = greatest(spent - coalesce(p.sold_price, 0), 0) where id = p.team_id;
  end if;
  update public.players set status = 'available', team_id = null, sold_price = null where id = p_player;
end $$;

-- Directly put a player in a team (icon / captain / retained players)
create or replace function public.assign_player(p_player uuid, p_team uuid, p_price integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.players%rowtype;
  tm public.teams%rowtype;
begin
  select * into p from public.players where id = p_player for update;
  if not found or not public.is_organiser(p.tournament_id) then raise exception 'Only the organiser can do this'; end if;
  if p.status = 'sold' then raise exception 'Release this player first'; end if;
  if exists (select 1 from public.auction_state where player_id = p_player and phase = 'bidding') then
    raise exception 'This player is being auctioned right now';
  end if;
  select * into tm from public.teams where id = p_team and tournament_id = p.tournament_id for update;
  if not found then raise exception 'Team not found'; end if;
  if p_price < 0 or p_price > tm.purse - tm.spent then raise exception 'Team does not have enough purse'; end if;

  update public.players set status = 'sold', team_id = p_team, sold_price = p_price where id = p_player;
  update public.teams set spent = spent + p_price where id = p_team;
end $$;

-- Wipe all auction results of a tournament (players go back to the pool)
create or replace function public.reset_auction(p_tournament uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_organiser(p_tournament) then raise exception 'Only the organiser can do this'; end if;
  update public.players set status = 'available', team_id = null, sold_price = null
   where tournament_id = p_tournament and status in ('sold', 'unsold');
  update public.teams set spent = 0 where tournament_id = p_tournament;
  delete from public.bids where tournament_id = p_tournament;
  update public.auction_state
     set player_id = null, current_bid = null, leading_team_id = null, phase = 'idle', ends_at = null, updated_at = now()
   where tournament_id = p_tournament;
  update public.tournaments set status = 'setup' where id = p_tournament;
end $$;

revoke execute on function public.apply_bid(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_new_tournament() from public, anon, authenticated;
revoke execute on function public.handle_user_role_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.tournaments enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.player_contacts enable row level security;
alter table public.auction_state enable row level security;
alter table public.bids enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select using (id = auth.uid());

-- Tournaments, teams, approved players, auction state and bids are public (big screen / squads page)
drop policy if exists "tournaments readable" on public.tournaments;
create policy "tournaments readable" on public.tournaments for select using (true);
drop policy if exists "organisers create tournaments" on public.tournaments;
create policy "organisers create tournaments" on public.tournaments for insert to authenticated
  with check (organiser_id = auth.uid()
              and coalesce(auth.jwt()->'app_metadata'->>'role', '') <> 'owner'
              and exists (select 1 from public.profiles where id = auth.uid() and role = 'organiser'));
drop policy if exists "organiser updates tournament" on public.tournaments;
create policy "organiser updates tournament" on public.tournaments for update to authenticated
  using (organiser_id = auth.uid()) with check (organiser_id = auth.uid());
drop policy if exists "organiser deletes tournament" on public.tournaments;
create policy "organiser deletes tournament" on public.tournaments for delete to authenticated
  using (organiser_id = auth.uid());

drop policy if exists "teams readable" on public.teams;
create policy "teams readable" on public.teams for select using (true);
drop policy if exists "organiser manages teams" on public.teams;
create policy "organiser manages teams" on public.teams for all to authenticated
  using (public.is_organiser(tournament_id)) with check (public.is_organiser(tournament_id));

drop policy if exists "players readable" on public.players;
create policy "players readable" on public.players for select
  using (status <> 'pending' or public.is_organiser(tournament_id));
drop policy if exists "organiser manages players" on public.players;
create policy "organiser manages players" on public.players for all to authenticated
  using (public.is_organiser(tournament_id)) with check (public.is_organiser(tournament_id));

drop policy if exists "organiser manages contacts" on public.player_contacts;
create policy "organiser manages contacts" on public.player_contacts for all to authenticated
  using (public.is_organiser(tournament_id)) with check (public.is_organiser(tournament_id));

drop policy if exists "auction state readable" on public.auction_state;
create policy "auction state readable" on public.auction_state for select using (true);

drop policy if exists "bids readable" on public.bids;
create policy "bids readable" on public.bids for select using (true);

grant usage on schema public to anon, authenticated;
grant select on public.tournaments, public.teams, public.players, public.auction_state, public.bids to anon, authenticated;
grant select on public.profiles to authenticated;
grant insert, update, delete on public.tournaments, public.teams, public.players to authenticated;
grant select, insert, update, delete on public.player_contacts to authenticated;
grant execute on function public.server_now(), public.bid_step(jsonb, integer) to anon, authenticated;
grant execute on function
  public.place_bid(uuid, integer), public.admin_bid(uuid, uuid, integer), public.start_player(uuid, uuid),
  public.close_player(uuid), public.cancel_player(uuid), public.reset_timer(uuid),
  public.release_player(uuid), public.assign_player(uuid, uuid, integer), public.reset_auction(uuid)
  to authenticated;

-- ---------------------------------------------------------------------
-- Realtime (live updates on every screen)
-- ---------------------------------------------------------------------
do $$
declare
  tbl text;
begin
  foreach tbl in array array['auction_state', 'teams', 'players', 'bids'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Storage bucket for player photos and team logos (public read, 2 MB max)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "photos public read" on storage.objects;
create policy "photos public read" on storage.objects for select using (bucket_id = 'photos');
drop policy if exists "photos upload" on storage.objects;
create policy "photos upload" on storage.objects for insert to authenticated with check (bucket_id = 'photos');
drop policy if exists "photos update" on storage.objects;
create policy "photos update" on storage.objects for update to authenticated using (bucket_id = 'photos');

-- =====================================================================
-- Automatic timer flow (same as migrations/003_auto_timer.sql)
-- =====================================================================
alter table public.tournaments add column if not exists auto_close boolean not null default true;
alter table public.tournaments add column if not exists auto_next boolean not null default true;
alter table public.tournaments add column if not exists result_pause_seconds integer not null default 6
  check (result_pause_seconds between 2 and 60);

-- Internal: give the player on stage to the highest bidder, or mark unsold. Caller holds the row lock.
create or replace function public.finalize_player(p_tournament uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  st public.auction_state%rowtype;
begin
  select * into st from public.auction_state where tournament_id = p_tournament;
  if st.phase <> 'bidding' then return st.phase; end if;

  if st.leading_team_id is not null then
    update public.players set status = 'sold', team_id = st.leading_team_id, sold_price = st.current_bid
     where id = st.player_id;
    update public.teams set spent = spent + st.current_bid where id = st.leading_team_id;
    update public.auction_state set phase = 'sold', ends_at = null, updated_at = now()
     where tournament_id = p_tournament;
    return 'sold';
  end if;

  update public.players set status = 'unsold' where id = st.player_id;
  update public.auction_state set phase = 'unsold', ends_at = null, updated_at = now()
   where tournament_id = p_tournament;
  return 'unsold';
end $$;
revoke execute on function public.finalize_player(uuid) from public, anon, authenticated;

create or replace function public.close_player(p_tournament uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  st public.auction_state%rowtype;
begin
  if not public.is_organiser(p_tournament) then raise exception 'Only the organiser can do this'; end if;
  select * into st from public.auction_state where tournament_id = p_tournament for update;
  if st.phase <> 'bidding' then raise exception 'No player is being auctioned'; end if;
  return public.finalize_player(p_tournament);
end $$;

-- Safe for anyone to call: it only does what the tournament's own rules say is due.
create or replace function public.auction_tick(p_tournament uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  st public.auction_state%rowtype;
  t public.tournaments%rowtype;
  v_next uuid;
begin
  select * into st from public.auction_state where tournament_id = p_tournament for update skip locked;
  if not found then return 'busy'; end if;
  select * into t from public.tournaments where id = p_tournament;

  -- timer ran out
  if st.phase = 'bidding' and t.auto_close and st.ends_at is not null and now() >= st.ends_at then
    return public.finalize_player(p_tournament);
  end if;

  -- result has been on screen long enough: bring the next random player
  if st.phase in ('sold', 'unsold') and t.auto_next
     and now() >= st.updated_at + make_interval(secs => t.result_pause_seconds) then
    select id into v_next from public.players
     where tournament_id = p_tournament and status = 'available'
     order by random() limit 1;
    if v_next is null then
      update public.auction_state
         set player_id = null, current_bid = null, leading_team_id = null, phase = 'idle', ends_at = null, updated_at = now()
       where tournament_id = p_tournament;
      return 'idle';
    end if;
    update public.auction_state
       set player_id = v_next, current_bid = null, leading_team_id = null, phase = 'bidding',
           ends_at = case when t.bid_timer_seconds > 0 then now() + make_interval(secs => t.bid_timer_seconds) end,
           updated_at = now()
     where tournament_id = p_tournament;
    return 'bidding';
  end if;

  return st.phase;
end $$;
grant execute on function public.auction_tick(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Site admin and pausing (same as migrations/004_admin.sql)
-- ---------------------------------------------------------------------


alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles add column if not exists suspended boolean not null default false;
alter table public.profiles add column if not exists suspended_reason text;
alter table public.profiles add column if not exists access_until date;
alter table public.profiles add column if not exists admin_note text;

alter table public.tournaments add column if not exists suspended boolean not null default false;
alter table public.tournaments add column if not exists suspended_reason text;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- Not paused by the admin and access date (if any) not passed. Admins are always active.
create or replace function public.account_active(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin or (not suspended and (access_until is null or access_until >= current_date))
                     from public.profiles where id = p_user), false);
$$;

create or replace function public.tournament_active(p_tournament uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tournaments t
                  where t.id = p_tournament and not t.suspended and public.account_active(t.organiser_id));
$$;

-- Admins manage every tournament; organisers only their own, and only while it is not paused
create or replace function public.is_organiser(p_tournament uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.tournaments t
     where t.id = p_tournament and t.organiser_id = auth.uid()
       and not t.suspended and public.account_active(t.organiser_id));
$$;

-- Only admins (or the service key) may change pause fields or move a tournament to another organiser
create or replace function public.guard_tournament_admin_fields() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_privileged boolean := public.is_admin() or coalesce(auth.jwt()->>'role', '') = 'service_role' or auth.uid() is null;
begin
  if v_privileged then return new; end if;
  if tg_op = 'INSERT' then
    new.suspended := false;
    new.suspended_reason := null;
  elsif new.suspended is distinct from old.suspended
     or new.suspended_reason is distinct from old.suspended_reason
     or new.organiser_id is distinct from old.organiser_id then
    raise exception 'Only the site admin can change this';
  end if;
  return new;
end $$;

drop trigger if exists guard_tournament_admin_fields on public.tournaments;
create trigger guard_tournament_admin_fields before insert or update on public.tournaments
  for each row execute function public.guard_tournament_admin_fields();

-- ---------------------------------------------------------------------
-- Policies: route tournament edits through is_organiser (admin + pause aware)
-- ---------------------------------------------------------------------

drop policy if exists "organisers create tournaments" on public.tournaments;
create policy "organisers create tournaments" on public.tournaments for insert to authenticated
  with check (organiser_id = auth.uid()
              and coalesce(auth.jwt()->'app_metadata'->>'role', '') <> 'owner'
              and exists (select 1 from public.profiles where id = auth.uid() and role = 'organiser')
              and public.account_active(auth.uid()));
drop policy if exists "organiser updates tournament" on public.tournaments;
create policy "organiser updates tournament" on public.tournaments for update to authenticated
  using (public.is_organiser(id)) with check (public.is_admin() or organiser_id = auth.uid());
drop policy if exists "organiser deletes tournament" on public.tournaments;
create policy "organiser deletes tournament" on public.tournaments for delete to authenticated
  using (public.is_organiser(id));

-- ---------------------------------------------------------------------
-- Bidding and the automatic timer stop while a tournament is paused
-- ---------------------------------------------------------------------

create or replace function public.apply_bid(p_tournament uuid, p_team uuid, p_amount integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  st public.auction_state%rowtype;
  t public.tournaments%rowtype;
  tm public.teams%rowtype;
  p public.players%rowtype;
  v_min integer;
  v_squad integer;
  v_max integer;
begin
  if not public.tournament_active(p_tournament) then
    raise exception 'This auction is paused by the site admin';
  end if;

  select * into st from public.auction_state where tournament_id = p_tournament for update;
  if not found or st.phase <> 'bidding' or st.player_id is null then
    raise exception 'Bidding is not open right now';
  end if;
  if st.ends_at is not null and now() > st.ends_at then
    raise exception 'Time is up for this player';
  end if;

  select * into tm from public.teams where id = p_team and tournament_id = p_tournament;
  if not found then raise exception 'Team not found'; end if;
  if st.leading_team_id = tm.id then raise exception 'You already have the highest bid'; end if;

  select * into t from public.tournaments where id = p_tournament;
  select * into p from public.players where id = st.player_id;

  v_min := case when st.current_bid is null then p.base_price
                else st.current_bid + public.bid_step(t.increment_slabs, st.current_bid) end;
  if p_amount < v_min then raise exception 'Minimum bid is Rs %', v_min; end if;

  select count(*) into v_squad from public.players where team_id = tm.id and status = 'sold';
  if v_squad >= t.max_squad then raise exception 'Squad is full (% players)', t.max_squad; end if;

  -- keep enough money to fill the remaining minimum squad at base price
  v_max := (tm.purse - tm.spent) - greatest(t.min_squad - v_squad - 1, 0) * t.base_price;
  if p_amount > v_max then
    raise exception 'Not enough purse. Max bid allowed is Rs %', greatest(v_max, 0);
  end if;

  update public.auction_state
     set current_bid = p_amount,
         leading_team_id = tm.id,
         ends_at = case when t.bid_timer_seconds > 0 then now() + make_interval(secs => t.bid_timer_seconds) end,
         updated_at = now()
   where tournament_id = p_tournament;

  insert into public.bids (tournament_id, player_id, team_id, amount)
  values (p_tournament, st.player_id, tm.id, p_amount);

  return jsonb_build_object('amount', p_amount, 'team_id', tm.id);
end $$;
revoke execute on function public.apply_bid(uuid, uuid, integer) from public, anon, authenticated;

-- Team owner bids for their own team (a paused owner login cannot bid)
create or replace function public.place_bid(p_tournament uuid, p_amount integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
begin
  if not public.account_active(auth.uid()) then raise exception 'Your login is paused. Please contact the organiser'; end if;
  select id into v_team from public.teams
   where tournament_id = p_tournament and owner_user_id = auth.uid();
  if v_team is null then raise exception 'You are not a team owner in this tournament'; end if;
  return public.apply_bid(p_tournament, v_team, p_amount);
end $$;

create or replace function public.auction_tick(p_tournament uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  st public.auction_state%rowtype;
  t public.tournaments%rowtype;
  v_next uuid;
begin
  if not public.tournament_active(p_tournament) then return 'paused'; end if;
  select * into st from public.auction_state where tournament_id = p_tournament for update skip locked;
  if not found then return 'busy'; end if;
  select * into t from public.tournaments where id = p_tournament;

  -- timer ran out
  if st.phase = 'bidding' and t.auto_close and st.ends_at is not null and now() >= st.ends_at then
    return public.finalize_player(p_tournament);
  end if;

  -- result has been on screen long enough: bring the next random player
  if st.phase in ('sold', 'unsold') and t.auto_next
     and now() >= st.updated_at + make_interval(secs => t.result_pause_seconds) then
    select id into v_next from public.players
     where tournament_id = p_tournament and status = 'available'
     order by random() limit 1;
    if v_next is null then
      update public.auction_state
         set player_id = null, current_bid = null, leading_team_id = null, phase = 'idle', ends_at = null, updated_at = now()
       where tournament_id = p_tournament;
      return 'idle';
    end if;
    update public.auction_state
       set player_id = v_next, current_bid = null, leading_team_id = null, phase = 'bidding',
           ends_at = case when t.bid_timer_seconds > 0 then now() + make_interval(secs => t.bid_timer_seconds) end,
           updated_at = now()
     where tournament_id = p_tournament;
    return 'bidding';
  end if;

  return st.phase;
end $$;
grant execute on function public.auction_tick(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Admin functions
-- ---------------------------------------------------------------------

-- Everything the admin dashboard shows, in one call
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return jsonb_build_object(
    'users', (
      select coalesce(jsonb_agg(u order by u.created_at desc), '[]'::jsonb) from (
        select p.id, au.email, p.full_name, p.role, p.is_admin, p.suspended, p.suspended_reason,
               p.access_until, p.admin_note, p.created_at, au.last_sign_in_at,
               public.account_active(p.id) as active,
               (select count(*) from public.tournaments t where t.organiser_id = p.id) as tournament_count,
               (select coalesce(jsonb_agg(jsonb_build_object('team', tm.name, 'tournament_id', tm.tournament_id)), '[]'::jsonb)
                  from public.teams tm where tm.owner_user_id = p.id) as teams
          from public.profiles p join auth.users au on au.id = p.id
      ) u),
    'tournaments', (
      select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
        select t.id, t.name, t.venue, t.starts_on, t.status, t.suspended, t.suspended_reason, t.created_at,
               t.organiser_id, t.team_budget, s.phase, s.updated_at as last_activity,
               public.tournament_active(t.id) as active,
               (select count(*) from public.teams where tournament_id = t.id) as team_count,
               (select count(*) from public.players where tournament_id = t.id and status <> 'pending') as player_count,
               (select count(*) from public.players where tournament_id = t.id and status = 'pending') as pending_count,
               (select count(*) from public.players where tournament_id = t.id and status = 'sold') as sold_count
          from public.tournaments t left join public.auction_state s on s.tournament_id = t.id
      ) x)
  );
end $$;

-- p_changes keys (all optional): is_admin, suspended, suspended_reason, access_until, admin_note
create or replace function public.admin_update_user(p_user uuid, p_changes jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_user = auth.uid() and (coalesce((p_changes->>'is_admin')::boolean, true) = false
                              or coalesce((p_changes->>'suspended')::boolean, false)) then
    raise exception 'You cannot pause or remove your own admin access';
  end if;
  update public.profiles set
    is_admin = case when role = 'organiser' then coalesce((p_changes->>'is_admin')::boolean, is_admin) else false end,
    suspended = coalesce((p_changes->>'suspended')::boolean, suspended),
    suspended_reason = case when p_changes ? 'suspended_reason' then nullif(trim(p_changes->>'suspended_reason'), '') else suspended_reason end,
    access_until = case when p_changes ? 'access_until' then nullif(p_changes->>'access_until', '')::date else access_until end,
    admin_note = case when p_changes ? 'admin_note' then nullif(trim(p_changes->>'admin_note'), '') else admin_note end
  where id = p_user;
  if not found then raise exception 'User not found'; end if;
end $$;

-- Lets the website show "paused" to the organiser / team owners
create or replace function public.my_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('is_admin', p.is_admin, 'active', public.account_active(p.id),
                            'suspended', p.suspended, 'suspended_reason', p.suspended_reason, 'access_until', p.access_until)
    from public.profiles p where p.id = auth.uid();
$$;

revoke execute on function public.admin_overview(), public.admin_update_user(uuid, jsonb) from public, anon;
grant execute on function public.admin_overview(), public.admin_update_user(uuid, jsonb), public.my_access() to authenticated;
grant execute on function public.tournament_active(uuid), public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------
-- First admin
-- ---------------------------------------------------------------------

update public.profiles set is_admin = true
 where id in (select id from auth.users where lower(email) = 'tanmoybhowmik98@gmail.com');
