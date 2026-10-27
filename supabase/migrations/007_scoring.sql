-- Ball-by-ball scoring: scorer PIN links, playing XIs, guest players (approved by the organiser),
-- the event log every screen replays, and per-player match stats saved when a match finishes.
-- Run once in Supabase -> SQL Editor. Safe to run again.

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
