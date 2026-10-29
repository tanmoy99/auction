-- Team owners add their own players: the owner asks once, the organiser approves once, then the owner
-- can add players or share a WhatsApp link that puts players straight into their squad (price Rs 0).
-- Run once in Supabase -> SQL Editor. Safe to run again.

-- 'none' -> owner asks -> 'requested' -> organiser approves -> 'approved' (organiser can turn it off again)
alter table public.teams add column if not exists player_access text not null default 'none';
alter table public.teams drop constraint if exists teams_player_access_check;
alter table public.teams add constraint teams_player_access_check check (player_access in ('none', 'requested', 'approved'));

-- Private: the team's join link. Teams are public, so the token can't live there.
-- No policies: only reachable through the functions below and the service key.
create table if not exists public.team_links (
  team_id uuid primary key references public.teams on delete cascade,
  tournament_id uuid not null references public.tournaments on delete cascade,
  token uuid not null default gen_random_uuid() unique
);
alter table public.team_links enable row level security;

-- Turning access off kills the old link, so a later approval hands out a fresh one
create or replace function public.handle_player_access_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.player_access = 'none' and old.player_access <> 'none' then
    delete from public.team_links where team_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists on_player_access_change on public.teams;
create trigger on_player_access_change after update of player_access on public.teams
  for each row execute function public.handle_player_access_change();

-- Owner asks the organiser for permission to add players (only needed once)
create or replace function public.request_player_access(p_team uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.account_active(auth.uid()) then raise exception 'Your login is paused. Please contact the organiser'; end if;
  if not exists (select 1 from public.teams where id = p_team and owner_user_id = auth.uid()) then
    raise exception 'You are not the owner of this team';
  end if;
  update public.teams set player_access = 'requested' where id = p_team and player_access = 'none';
end $$;

-- The team's join link token, for its owner (once approved) or the organiser. p_new makes a new one (old link stops).
create or replace function public.team_link(p_team uuid, p_new boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  tm public.teams%rowtype;
  v_token uuid;
begin
  select * into tm from public.teams where id = p_team;
  if not found or not (public.is_organiser(tm.tournament_id)
                       or (tm.owner_user_id = auth.uid() and tm.player_access = 'approved' and public.account_active(auth.uid()))) then
    raise exception 'Ask the organiser to allow adding players first';
  end if;
  insert into public.team_links as l (team_id, tournament_id) values (tm.id, tm.tournament_id)
  on conflict (team_id) do update set token = case when p_new then gen_random_uuid() else l.token end
  returning token into v_token;
  return v_token;
end $$;

-- What the public join page shows (never the token or anything private). Null for an unknown link.
create or replace function public.team_link_info(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'team', tm.name, 'short_name', tm.short_name, 'color', tm.color, 'logo_url', tm.logo_url,
    'tournament', t.name, 'venue', t.venue,
    'open', tm.player_access = 'approved' and public.tournament_active(t.id),
    'full', (select count(*) from public.players p where p.team_id = tm.id and p.status = 'sold') >= t.max_squad)
    from public.team_links l
    join public.teams tm on tm.id = l.team_id
    join public.tournaments t on t.id = tm.tournament_id
   where l.token = p_token;
$$;

-- Internal (service key only, used by /api/join/[token]): put a new player straight into the team behind a link.
-- Locks the team row so two forms can't both take the last squad place.
create or replace function public.add_team_player(p_token uuid, p_player jsonb, p_phone text, p_source text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  tm public.teams%rowtype;
  t public.tournaments%rowtype;
  v_id uuid;
  v_digits text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
begin
  select x.* into tm from public.team_links l join public.teams x on x.id = l.team_id where l.token = p_token for update of x;
  if not found then raise exception 'Invalid team link'; end if;
  if tm.player_access <> 'approved' then raise exception 'Adding players to this team is closed'; end if;
  if not public.tournament_active(tm.tournament_id) then raise exception 'This tournament is paused'; end if;
  select * into t from public.tournaments where id = tm.tournament_id;

  if (select count(*) from public.players where team_id = tm.id and status = 'sold') >= t.max_squad then
    raise exception 'Squad is full (% players)', t.max_squad;
  end if;
  -- compare the last 10 digits so "+91 98765 43210" and "9876543210" match
  if length(v_digits) = 10 and exists (
    select 1 from public.player_contacts c
     where c.tournament_id = t.id and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10) = v_digits) then
    raise exception 'This mobile number is already registered in this tournament';
  end if;

  insert into public.players (tournament_id, name, role, batting_style, bowling_style, age, city, photo_url,
                              base_price, status, team_id, sold_price, source)
  values (t.id, left(trim(p_player->>'name'), 80), p_player->>'role', p_player->>'batting_style', p_player->>'bowling_style',
          (p_player->>'age')::integer, p_player->>'city', p_player->>'photo_url',
          t.base_price, 'sold', tm.id, 0, p_source)
  returning id into v_id;
  if nullif(trim(coalesce(p_phone, '')), '') is not null then
    insert into public.player_contacts (player_id, tournament_id, phone) values (v_id, t.id, trim(p_phone));
  end if;
  return v_id;
end $$;

-- Owner removes a player their team added (auctioned players stay; only the organiser can release those)
create or replace function public.owner_remove_player(p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  p public.players%rowtype;
begin
  if not public.account_active(auth.uid()) then raise exception 'Your login is paused. Please contact the organiser'; end if;
  select x.* into p from public.players x join public.teams tm on tm.id = x.team_id
   where x.id = p_player and tm.owner_user_id = auth.uid() and tm.player_access = 'approved'
   for update of x;
  if not found then raise exception 'Player not found in your team'; end if;
  if p.source not in ('team-owner', 'team-link') then raise exception 'Only players your team added can be removed. Ask the organiser'; end if;
  update public.teams set spent = greatest(spent - coalesce(p.sold_price, 0), 0) where id = p.team_id;
  delete from public.players where id = p.id;
end $$;

revoke execute on function public.handle_player_access_change() from public, anon, authenticated;
revoke execute on function public.add_team_player(uuid, jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.request_player_access(uuid), public.team_link(uuid, boolean), public.owner_remove_player(uuid) from public, anon;
grant execute on function public.request_player_access(uuid), public.team_link(uuid, boolean), public.owner_remove_player(uuid) to authenticated;
grant execute on function public.team_link_info(uuid) to anon, authenticated;
