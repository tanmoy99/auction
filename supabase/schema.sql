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

-- ---------------------------------------------------------------------
-- Up next player (same as migrations/005_next_player.sql)
-- ---------------------------------------------------------------------


alter table public.auction_state add column if not exists next_player_id uuid references public.players on delete set null;

-- Internal: a random player still waiting in the pool, never the one on stage
create or replace function public.pick_next_player(p_tournament uuid, p_exclude uuid)
returns uuid language sql volatile security definer set search_path = public as $$
  select id from public.players
   where tournament_id = p_tournament and status = 'available' and id is distinct from p_exclude
   order by random() limit 1;
$$;
revoke execute on function public.pick_next_player(uuid, uuid) from public, anon, authenticated;

-- Internal: keep the chosen next player if they can still be auctioned, otherwise pick a new one
create or replace function public.keep_or_pick_next(p_tournament uuid, p_next uuid, p_exclude uuid)
returns uuid language sql volatile security definer set search_path = public as $$
  select coalesce(
    (select id from public.players
      where id = p_next and tournament_id = p_tournament and status in ('available', 'unsold') and id is distinct from p_exclude),
    public.pick_next_player(p_tournament, p_exclude));
$$;
revoke execute on function public.keep_or_pick_next(uuid, uuid, uuid) from public, anon, authenticated;

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
         next_player_id = public.keep_or_pick_next(p_tournament, st.next_player_id, p_player),
         updated_at = now()
   where tournament_id = p_tournament;
  update public.tournaments set status = 'live' where id = p_tournament and status = 'setup';
end $$;

-- Organiser chooses who comes up next (null = pick a random one again)
create or replace function public.set_next_player(p_tournament uuid, p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  st public.auction_state%rowtype;
begin
  if not public.is_organiser(p_tournament) then raise exception 'Only the organiser can do this'; end if;
  select * into st from public.auction_state where tournament_id = p_tournament for update;
  if p_player is not null and not exists (
    select 1 from public.players where id = p_player and tournament_id = p_tournament
       and status in ('available', 'unsold') and id is distinct from st.player_id) then
    raise exception 'This player is not available for auction';
  end if;
  update public.auction_state
     set next_player_id = coalesce(p_player, public.pick_next_player(p_tournament, st.player_id))
         -- updated_at stays: it times the pause after SOLD / UNSOLD
   where tournament_id = p_tournament;
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

  -- result has been on screen long enough: bring the "up next" player
  if st.phase in ('sold', 'unsold') and t.auto_next
     and now() >= st.updated_at + make_interval(secs => t.result_pause_seconds) then
    v_next := public.keep_or_pick_next(p_tournament, st.next_player_id, st.player_id);
    if v_next is null then
      update public.auction_state
         set player_id = null, current_bid = null, leading_team_id = null, phase = 'idle', ends_at = null,
             next_player_id = null, updated_at = now()
       where tournament_id = p_tournament;
      return 'idle';
    end if;
    update public.auction_state
       set player_id = v_next, current_bid = null, leading_team_id = null, phase = 'bidding',
           ends_at = case when t.bid_timer_seconds > 0 then now() + make_interval(secs => t.bid_timer_seconds) end,
           next_player_id = public.pick_next_player(p_tournament, v_next),
           updated_at = now()
     where tournament_id = p_tournament;
    return 'bidding';
  end if;

  return st.phase;
end $$;

create or replace function public.reset_auction(p_tournament uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_organiser(p_tournament) then raise exception 'Only the organiser can do this'; end if;
  update public.players set status = 'available', team_id = null, sold_price = null
   where tournament_id = p_tournament and status in ('sold', 'unsold');
  update public.teams set spent = 0 where tournament_id = p_tournament;
  delete from public.bids where tournament_id = p_tournament;
  update public.auction_state
     set player_id = null, current_bid = null, leading_team_id = null, phase = 'idle', ends_at = null,
         next_player_id = null, updated_at = now()
   where tournament_id = p_tournament;
  update public.tournaments set status = 'setup' where id = p_tournament;
end $$;

grant execute on function public.auction_tick(uuid) to anon, authenticated;
grant execute on function public.start_player(uuid, uuid), public.set_next_player(uuid, uuid), public.reset_auction(uuid) to authenticated;

-- Tournaments already running get an "up next" straight away
update public.auction_state s
   set next_player_id = public.pick_next_player(s.tournament_id, s.player_id)
 where s.next_player_id is null and s.phase <> 'idle';

-- ---------------------------------------------------------------------
-- Fixtures (same as migrations/006_fixtures.sql)
-- ---------------------------------------------------------------------


-- Format, points rules, overs and schedule the organiser chose
alter table public.tournaments add column if not exists fixture_settings jsonb;

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments on delete cascade,
  match_no integer not null,
  stage text not null check (stage in ('league', 'group', 'knockout')),
  group_name text,
  round integer not null default 1,
  round_name text not null,
  team_a_id uuid references public.teams on delete set null,
  team_b_id uuid references public.teams on delete set null,
  -- where a knockout slot's team comes from: {"type":"winner","match":12}, {"type":"standing","group":"A","position":1} ...
  a_source jsonb,
  b_source jsonb,
  scheduled_at timestamptz,
  venue text,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed')),
  outcome text check (outcome in ('win', 'tie', 'no_result', 'walkover')),
  winner_team_id uuid references public.teams on delete set null,
  batting_first text check (batting_first in ('a', 'b')),
  a_runs integer check (a_runs >= 0),
  a_wickets integer check (a_wickets between 0 and 20),
  a_balls integer check (a_balls >= 0),
  b_runs integer check (b_runs >= 0),
  b_wickets integer check (b_wickets between 0 and 20),
  b_balls integer check (b_balls >= 0),
  result_text text,
  created_at timestamptz not null default now(),
  unique (tournament_id, match_no)
);

create index if not exists matches_tournament_idx on public.matches (tournament_id, match_no);

alter table public.matches enable row level security;

drop policy if exists "matches readable" on public.matches;
create policy "matches readable" on public.matches for select using (true);
drop policy if exists "organiser manages matches" on public.matches;
create policy "organiser manages matches" on public.matches for all to authenticated
  using (public.is_organiser(tournament_id)) with check (public.is_organiser(tournament_id));

grant select on public.matches to anon, authenticated;
grant insert, update, delete on public.matches to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'matches') then
    alter publication supabase_realtime add table public.matches;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Ball-by-ball scoring (same as migrations/007_scoring.sql)
-- ---------------------------------------------------------------------


-- matches can now be in progress
alter table public.matches drop constraint if exists matches_status_check;
alter table public.matches add constraint matches_status_check check (status in ('scheduled', 'live', 'completed'));
-- small summary for lists (fixtures, big screen ticker): {innings, team, runs, wickets, balls, target, overs}
alter table public.matches add column if not exists live_score jsonb;

-- Guests a scorer asks for on match day. Usable in a playing XI only after the organiser approves.
create table if not exists public.guest_players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments on delete cascade,
  team_id uuid not null references public.teams on delete cascade,
  match_id uuid references public.matches on delete set null,
  name text not null check (length(trim(name)) between 1 and 80),
  role text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

-- Playing XI per match. Names are copied so scorecards never need the auction tables.
create table if not exists public.match_players (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches on delete cascade,
  tournament_id uuid not null references public.tournaments on delete cascade,
  team_id uuid not null references public.teams on delete cascade,
  player_id uuid references public.players on delete set null,
  guest_id uuid references public.guest_players on delete set null,
  name text not null,
  role text,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists match_players_match_idx on public.match_players (match_id);

-- Every scoring action in order. The scorecard is rebuilt from this list.
create table if not exists public.match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches on delete cascade,
  tournament_id uuid not null references public.tournaments on delete cascade,
  seq integer not null,
  type text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (match_id, seq)
);

-- Written when a match is finished; tournament stats add these up
create table if not exists public.player_match_stats (
  match_id uuid not null references public.matches on delete cascade,
  match_player_id uuid not null,
  tournament_id uuid not null references public.tournaments on delete cascade,
  team_id uuid not null references public.teams on delete cascade,
  player_id uuid references public.players on delete set null,
  guest_id uuid references public.guest_players on delete set null,
  name text not null,
  did_bat boolean not null default false,
  bat_runs integer not null default 0,
  bat_balls integer not null default 0,
  fours integer not null default 0,
  sixes integer not null default 0,
  out boolean not null default false,
  how_out text,
  bowl_balls integer not null default 0,
  bowl_runs integer not null default 0,
  wickets integer not null default 0,
  maidens integer not null default 0,
  wides integer not null default 0,
  noballs integer not null default 0,
  catches integer not null default 0,
  stumpings integer not null default 0,
  run_outs integer not null default 0,
  primary key (match_id, match_player_id)
);
create index if not exists player_match_stats_tournament_idx on public.player_match_stats (tournament_id);

-- Private: the PIN and which phone is scoring. Only reachable through the functions below.
create table if not exists public.match_scorers (
  match_id uuid primary key references public.matches on delete cascade,
  tournament_id uuid not null references public.tournaments on delete cascade,
  pin text not null,
  device_id text,
  device_name text,
  device_at timestamptz,
  failed integer not null default 0,
  locked_until timestamptz
);

alter table public.guest_players enable row level security;
alter table public.match_players enable row level security;
alter table public.match_events enable row level security;
alter table public.player_match_stats enable row level security;
alter table public.match_scorers enable row level security;

do $$
declare
  tbl text;
begin
  foreach tbl in array array['guest_players', 'match_players', 'match_events', 'player_match_stats'] loop
    execute format('drop policy if exists "%s readable" on public.%I', tbl, tbl);
    execute format('create policy "%s readable" on public.%I for select using (true)', tbl, tbl);
    execute format('drop policy if exists "organiser manages %s" on public.%I', tbl, tbl);
    execute format('create policy "organiser manages %s" on public.%I for all to authenticated using (public.is_organiser(tournament_id)) with check (public.is_organiser(tournament_id))', tbl, tbl);
    execute format('grant select on public.%I to anon, authenticated', tbl);
    execute format('grant insert, update, delete on public.%I to authenticated', tbl);
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    end if;
  end loop;
end $$;

-- Removing a result (organiser) also removes the stats it produced
create or replace function public.clear_stats_on_reopen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'completed' and new.status <> 'completed' then
    delete from public.player_match_stats where match_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists clear_stats_on_reopen on public.matches;
create trigger clear_stats_on_reopen after update of status on public.matches
  for each row execute function public.clear_stats_on_reopen();

-- ---------------------------------------------------------------------
-- Scorer access
-- ---------------------------------------------------------------------

-- Organiser: get (or make a new) 4-digit PIN for a match
create or replace function public.scorer_pin(p_match uuid, p_new boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare
  m public.matches%rowtype;
  v_pin text;
begin
  select * into m from public.matches where id = p_match;
  if not found or not public.is_organiser(m.tournament_id) then raise exception 'Only the organiser can do this'; end if;
  v_pin := lpad(floor(random() * 10000)::int::text, 4, '0');
  insert into public.match_scorers (match_id, tournament_id, pin) values (p_match, m.tournament_id, v_pin)
  on conflict (match_id) do update
    set pin = case when p_new then excluded.pin else public.match_scorers.pin end,
        device_id = case when p_new then null else public.match_scorers.device_id end,
        failed = 0, locked_until = null;
  select pin into v_pin from public.match_scorers where match_id = p_match;
  return v_pin;
end $$;

-- Internal: may this caller score this match right now?
create or replace function public.scorer_ok(p_match uuid, p_pin text, p_device text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  m public.matches%rowtype;
  sc public.match_scorers%rowtype;
begin
  select * into m from public.matches where id = p_match;
  if not found then return false; end if;
  if not public.tournament_active(m.tournament_id) then raise exception 'This tournament is paused by the site admin'; end if;
  select * into sc from public.match_scorers where match_id = p_match;
  -- the organiser needs no PIN, but is still bound by "one phone at a time"
  if public.is_organiser(m.tournament_id) and coalesce(p_pin, '') = '' then
    if found and sc.device_id is distinct from p_device then raise exception 'Another phone took over scoring for this match'; end if;
    return true;
  end if;
  if not found or sc.pin <> coalesce(p_pin, '') then return false; end if;
  if sc.device_id is distinct from p_device then raise exception 'Another phone took over scoring for this match'; end if;
  update public.match_scorers set device_at = now() where match_id = p_match;
  return true;
end $$;
revoke execute on function public.scorer_ok(uuid, text, text) from public, anon, authenticated;

-- Scorer opens the link and enters the PIN. Only one phone scores at a time; p_force takes over.
create or replace function public.scorer_claim(p_match uuid, p_pin text, p_device text, p_name text, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m public.matches%rowtype;
  sc public.match_scorers%rowtype;
  v_organiser boolean;
begin
  select * into m from public.matches where id = p_match;
  if not found then raise exception 'Match not found'; end if;
  v_organiser := public.is_organiser(m.tournament_id);
  if v_organiser and (p_pin is null or p_pin = '') then
    perform public.scorer_pin(p_match);
  end if;
  select * into sc from public.match_scorers where match_id = p_match for update;
  if not found then raise exception 'Scoring is not set up for this match yet. Ask the organiser for the scorer link'; end if;
  if not v_organiser or (p_pin is not null and p_pin <> '') then
    if sc.locked_until is not null and sc.locked_until > now() then
      raise exception 'Too many wrong PINs. Try again in a few minutes';
    end if;
    if sc.pin <> coalesce(p_pin, '') then
      update public.match_scorers
         set failed = failed + 1,
             locked_until = case when failed + 1 >= 8 then now() + interval '10 minutes' end
       where match_id = p_match;
      return jsonb_build_object('status', 'wrong_pin');
    end if;
  end if;
  if sc.device_id is not null and sc.device_id <> p_device and not p_force then
    return jsonb_build_object('status', 'taken', 'device_name', sc.device_name, 'since', sc.device_at);
  end if;
  update public.match_scorers
     set device_id = p_device, device_name = left(coalesce(nullif(trim(p_name), ''), 'Scorer'), 40), device_at = now(), failed = 0, locked_until = null
   where match_id = p_match;
  return jsonb_build_object('status', 'ok', 'pin', case when v_organiser then sc.pin end);
end $$;

-- Add one scoring event. p_seq must be the next number, so two taps can't both land.
create or replace function public.scorer_event(p_match uuid, p_pin text, p_device text, p_seq integer, p_type text, p_data jsonb, p_live jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.matches%rowtype;
  v_last integer;
begin
  if not public.scorer_ok(p_match, p_pin, p_device) then raise exception 'Wrong PIN'; end if;
  select * into m from public.matches where id = p_match for update;
  if m.status = 'completed' then raise exception 'This match is finished'; end if;
  if p_type not in ('toss', 'innings_start', 'ball', 'new_batter', 'new_bowler', 'swap', 'retire', 'end_innings') then
    raise exception 'Unknown scoring action';
  end if;
  select coalesce(max(seq), 0) into v_last from public.match_events where match_id = p_match;
  if p_seq <> v_last + 1 then raise exception 'Out of sync, reloading the latest score'; end if;
  insert into public.match_events (match_id, tournament_id, seq, type, data) values (p_match, m.tournament_id, p_seq, p_type, p_data);
  update public.matches set status = 'live', live_score = p_live where id = p_match;
end $$;

-- Remove the last event
create or replace function public.scorer_undo(p_match uuid, p_pin text, p_device text, p_seq integer, p_live jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.matches%rowtype;
  v_last integer;
begin
  if not public.scorer_ok(p_match, p_pin, p_device) then raise exception 'Wrong PIN'; end if;
  select * into m from public.matches where id = p_match for update;
  if m.status = 'completed' then raise exception 'This match is finished'; end if;
  select coalesce(max(seq), 0) into v_last from public.match_events where match_id = p_match;
  if p_seq <> v_last then raise exception 'Out of sync, reloading the latest score'; end if;
  delete from public.match_events where match_id = p_match and seq = p_seq;
  update public.matches set live_score = p_live, status = case when v_last = 1 then 'scheduled' else 'live' end where id = p_match;
end $$;

-- Save one team's playing XI: [{player_id, guest_id, name, role}]. Before the match starts the list
-- is replaced; once it has started, new names can only be added (late arrivals, substitutes).
create or replace function public.scorer_lineup(p_match uuid, p_pin text, p_device text, p_team uuid, p_players jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.matches%rowtype;
  v_started boolean;
  p jsonb;
  i integer := 0;
begin
  if not public.scorer_ok(p_match, p_pin, p_device) then raise exception 'Wrong PIN'; end if;
  select * into m from public.matches where id = p_match;
  if p_team is distinct from m.team_a_id and p_team is distinct from m.team_b_id then raise exception 'That team is not in this match'; end if;
  select exists (select 1 from public.match_events where match_id = p_match and type = 'innings_start') into v_started;
  if not v_started then
    delete from public.match_players where match_id = p_match and team_id = p_team;
  end if;
  for p in select * from jsonb_array_elements(p_players) loop
    i := i + 1;
    -- players must belong to this team (squad) or be an approved guest of this team
    if (p->>'player_id') is not null and not exists (
      select 1 from public.players where id = (p->>'player_id')::uuid and team_id = p_team) then
      raise exception 'A player is not in this team''s squad';
    end if;
    if (p->>'guest_id') is not null and not exists (
      select 1 from public.guest_players where id = (p->>'guest_id')::uuid and team_id = p_team and status = 'approved') then
      raise exception 'Guest players need the organiser''s approval first';
    end if;
    if (p->>'player_id') is null and (p->>'guest_id') is null then raise exception 'Unknown player'; end if;
    if v_started and exists (
      select 1 from public.match_players where match_id = p_match and team_id = p_team
         and (player_id = (p->>'player_id')::uuid or guest_id = (p->>'guest_id')::uuid)) then
      continue;
    end if;
    insert into public.match_players (match_id, tournament_id, team_id, player_id, guest_id, name, role, sort)
    values (p_match, m.tournament_id, p_team, (p->>'player_id')::uuid, (p->>'guest_id')::uuid,
            left(coalesce(p->>'name', 'Player'), 80), p->>'role', i);
  end loop;
end $$;

-- Scorer asks for a guest player; the organiser approves it in the Fixtures tab
create or replace function public.scorer_request_guest(p_match uuid, p_pin text, p_device text, p_team uuid, p_name text, p_role text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  m public.matches%rowtype;
  v_id uuid;
begin
  if not public.scorer_ok(p_match, p_pin, p_device) then raise exception 'Wrong PIN'; end if;
  select * into m from public.matches where id = p_match;
  if p_team is distinct from m.team_a_id and p_team is distinct from m.team_b_id then raise exception 'That team is not in this match'; end if;
  if (select count(*) from public.guest_players where match_id = p_match and status = 'pending') >= 10 then
    raise exception 'Too many guest requests waiting. Ask the organiser to approve them first';
  end if;
  insert into public.guest_players (tournament_id, team_id, match_id, name, role, status)
  values (m.tournament_id, p_team, p_match, trim(p_name), nullif(trim(coalesce(p_role, '')), ''),
          case when public.is_organiser(m.tournament_id) then 'approved' else 'pending' end)
  returning id into v_id;
  return v_id;
end $$;

-- Finish: save the result, move knockout winners on, store player stats. All in one go.
-- p_changes: [{id, team_a_id, team_b_id}] knockout slots that this result decides
-- p_stats: rows for player_match_stats
create or replace function public.scorer_finish(p_match uuid, p_pin text, p_device text, p_result jsonb, p_changes jsonb, p_stats jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.matches%rowtype;
  c jsonb;
begin
  if not public.scorer_ok(p_match, p_pin, p_device) then raise exception 'Wrong PIN'; end if;
  select * into m from public.matches where id = p_match for update;
  if p_result->>'outcome' not in ('win', 'tie', 'no_result', 'walkover') then raise exception 'Invalid result'; end if;
  if (p_result->>'winner_team_id') is not null
     and (p_result->>'winner_team_id')::uuid is distinct from m.team_a_id
     and (p_result->>'winner_team_id')::uuid is distinct from m.team_b_id then
    raise exception 'Winner must be one of the two teams';
  end if;

  update public.matches set
    status = 'completed',
    outcome = p_result->>'outcome',
    winner_team_id = (p_result->>'winner_team_id')::uuid,
    batting_first = p_result->>'batting_first',
    a_runs = (p_result->>'a_runs')::int, a_wickets = (p_result->>'a_wickets')::int, a_balls = (p_result->>'a_balls')::int,
    b_runs = (p_result->>'b_runs')::int, b_wickets = (p_result->>'b_wickets')::int, b_balls = (p_result->>'b_balls')::int,
    result_text = left(p_result->>'result_text', 200),
    live_score = null
  where id = p_match;

  for c in select * from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) loop
    update public.matches
       set team_a_id = (c->>'team_a_id')::uuid, team_b_id = (c->>'team_b_id')::uuid
     where id = (c->>'id')::uuid and tournament_id = m.tournament_id and stage = 'knockout' and status <> 'completed';
  end loop;

  delete from public.player_match_stats where match_id = p_match;
  insert into public.player_match_stats
    (match_id, match_player_id, tournament_id, team_id, player_id, guest_id, name, did_bat, bat_runs, bat_balls, fours, sixes, out, how_out,
     bowl_balls, bowl_runs, wickets, maidens, wides, noballs, catches, stumpings, run_outs)
  select p_match, mp.id, m.tournament_id, mp.team_id, mp.player_id, mp.guest_id, mp.name,
         coalesce((s->>'did_bat')::boolean, false), coalesce((s->>'bat_runs')::int, 0), coalesce((s->>'bat_balls')::int, 0),
         coalesce((s->>'fours')::int, 0), coalesce((s->>'sixes')::int, 0), coalesce((s->>'out')::boolean, false), s->>'how_out',
         coalesce((s->>'bowl_balls')::int, 0), coalesce((s->>'bowl_runs')::int, 0), coalesce((s->>'wickets')::int, 0),
         coalesce((s->>'maidens')::int, 0), coalesce((s->>'wides')::int, 0), coalesce((s->>'noballs')::int, 0),
         coalesce((s->>'catches')::int, 0), coalesce((s->>'stumpings')::int, 0), coalesce((s->>'run_outs')::int, 0)
    from jsonb_array_elements(coalesce(p_stats, '[]'::jsonb)) s
    join public.match_players mp on mp.id = (s->>'match_player_id')::uuid and mp.match_id = p_match;
end $$;

revoke execute on function public.scorer_pin(uuid, boolean) from public, anon;
grant execute on function public.scorer_pin(uuid, boolean) to authenticated;
grant execute on function
  public.scorer_claim(uuid, text, text, text, boolean),
  public.scorer_event(uuid, text, text, integer, text, jsonb, jsonb),
  public.scorer_undo(uuid, text, text, integer, jsonb),
  public.scorer_lineup(uuid, text, text, uuid, jsonb),
  public.scorer_request_guest(uuid, text, text, uuid, text, text),
  public.scorer_finish(uuid, text, text, jsonb, jsonb, jsonb)
  to anon, authenticated;
