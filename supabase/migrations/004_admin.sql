-- Site admin: sees every organiser and tournament, can pause access (e.g. until payment),
-- set an "access until" date, open / edit / delete any tournament.
-- Run once in Supabase -> SQL Editor. Safe to run again.

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
