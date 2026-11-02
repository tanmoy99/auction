-- 020: player logins (additive). Approved players get a one-time link from the organiser on WhatsApp,
-- set a password, and log in with their mobile number to see their own stats ("My CricMitra").
-- A player account can never organise: profiles.role = 'player', which every organiser rule already excludes.
begin;

-- 1. A third kind of account. New sign-ups that are not owners or players stay organisers, exactly as before.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('organiser', 'owner', 'player'));

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    case new.raw_app_meta_data->>'role' when 'owner' then 'owner' when 'player' then 'player' else 'organiser' end,
    new.raw_user_meta_data->>'full_name'
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Supabase sets app_metadata just after the insert, so keep the profile in sync on update too
create or replace function public.handle_user_role_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.raw_app_meta_data->>'role' in ('owner', 'player') then
    update public.profiles set role = new.raw_app_meta_data->>'role'
     where id = new.id and role <> new.raw_app_meta_data->>'role';
  end if;
  return new;
end $$;

-- the organiser rule for creating tournaments also refuses player accounts by their token
drop policy if exists "organisers create tournaments" on public.tournaments;
create policy "organisers create tournaments" on public.tournaments for insert to authenticated
  with check (organiser_id = auth.uid()
              and coalesce(auth.jwt()->'app_metadata'->>'role', '') not in ('owner', 'player')
              and exists (select 1 from public.profiles where id = auth.uid() and role = 'organiser')
              and public.account_active(auth.uid()));

-- 2. One player login per mobile number. Private: only reachable through the functions below and the server.
create table if not exists public.player_accounts (
  user_id uuid primary key references auth.users on delete cascade,
  mobile text not null unique, -- mobile_key() form, 10 digits
  first_name text not null, -- lower case; matched with the mobile number like the public profile
  created_at timestamptz not null default now()
);
alter table public.player_accounts enable row level security;
revoke all on public.player_accounts from anon, authenticated;

-- 3. One-time links the organiser sends on WhatsApp (valid 7 days)
create table if not exists public.player_invites (
  token uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players on delete cascade,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz
);
create index if not exists player_invites_player_idx on public.player_invites (player_id);
alter table public.player_invites enable row level security;
revoke all on public.player_invites from anon, authenticated;

-- Organiser: make a login link for an approved player who has a mobile number
create or replace function public.player_invite(p_player uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  p public.players%rowtype;
  v_mobile text;
  v_token uuid;
begin
  select * into p from public.players where id = p_player;
  if not found or not public.is_organiser(p.tournament_id) then raise exception 'Player not found'; end if;
  if not public.tournament_active(p.tournament_id) then raise exception 'This tournament is paused'; end if;
  if p.status = 'pending' then raise exception 'Approve the player first'; end if;
  select public.mobile_key(phone) into v_mobile from public.player_contacts where player_id = p.id;
  if v_mobile is null then raise exception 'Add the player''s mobile number first'; end if;
  insert into public.player_invites (player_id, created_by) values (p.id, auth.uid()) returning token into v_token;
  return v_token;
end $$;
revoke all on function public.player_invite(uuid) from public;
grant execute on function public.player_invite(uuid) to authenticated;

-- Logged-in player: their career (same data as the public profile) plus their teams' next matches
create or replace function public.my_player_career() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acc public.player_accounts%rowtype;
  v_player uuid;
  v_career jsonb;
begin
  select * into acc from public.player_accounts where user_id = auth.uid();
  if not found then return null; end if;
  select p.id into v_player
    from public.players p
    join public.player_contacts c on c.player_id = p.id
    join public.tournaments t on t.id = p.tournament_id
   where public.mobile_key(c.phone) = acc.mobile
     and lower(split_part(trim(p.name), ' ', 1)) = acc.first_name
     and p.status <> 'pending' and public.tournament_active(p.tournament_id)
   order by t.starts_on desc nulls last, t.created_at desc
   limit 1;
  if v_player is null then return null; end if;
  v_career := public.player_career(v_player);
  return v_career || jsonb_build_object('upcoming', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.live desc, x.scheduled_at nulls last, x.match_no)
    from (
      select m.id as match_id, t.name as tournament, m.match_no, m.round_name, m.scheduled_at, m.venue, m.status,
             m.status = 'live' as live, a.name as team_a, b.name as team_b
      from public.matches m
      join public.tournaments t on t.id = m.tournament_id
      left join public.teams a on a.id = m.team_a_id
      left join public.teams b on b.id = m.team_b_id
      where m.status in ('scheduled', 'live')
        and (m.team_a_id in (select (e->>'team_id')::uuid from jsonb_array_elements(v_career->'entries') e where e->>'team_id' is not null)
          or m.team_b_id in (select (e->>'team_id')::uuid from jsonb_array_elements(v_career->'entries') e where e->>'team_id' is not null))
      order by m.status = 'live' desc, m.scheduled_at nulls last, m.match_no
      limit 10) x), '[]'::jsonb));
end $$;
revoke all on function public.my_player_career() from public;
grant execute on function public.my_player_career() to authenticated;

commit;
