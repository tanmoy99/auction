-- Test matches (multi-day, two innings a side), squad roles (captain, vice-captain, wicket-keeper)
-- and the captain / keeper of each playing XI.
-- Run once in Supabase -> SQL Editor. Safe to run again.

-- ---------------------------------------------------------------------
-- Matches: limited overs (T20, 50 overs ...) or a multi-day Test
-- ---------------------------------------------------------------------

alter table public.matches add column if not exists match_type text not null default 'limited';
alter table public.matches drop constraint if exists matches_match_type_check;
alter table public.matches add constraint matches_match_type_check check (match_type in ('limited', 'test'));
alter table public.matches add column if not exists days integer;
alter table public.matches drop constraint if exists matches_days_check;
alter table public.matches add constraint matches_days_check check (days between 1 and 5);
-- Test scores in batting order: [{team, runs, wickets, balls, declared, follow_on}]
alter table public.matches add column if not exists innings jsonb;
alter table public.matches drop constraint if exists matches_outcome_check;
alter table public.matches add constraint matches_outcome_check check (outcome in ('win', 'tie', 'no_result', 'walkover', 'draw'));

-- A Test player can bat and bowl twice, so stats are kept per innings (1 or 2)
alter table public.player_match_stats add column if not exists innings smallint not null default 1;
do $$
begin
  if not exists (
    select 1 from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
     where i.indrelid = 'public.player_match_stats'::regclass and i.indisprimary and a.attname = 'innings') then
    alter table public.player_match_stats drop constraint if exists player_match_stats_pkey;
    alter table public.player_match_stats add primary key (match_id, match_player_id, innings);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Squad roles
-- ---------------------------------------------------------------------

alter table public.players add column if not exists is_captain boolean not null default false;
alter table public.players add column if not exists is_vice_captain boolean not null default false;
alter table public.players add column if not exists is_keeper boolean not null default false;

-- A player who leaves a team (released, auction reset) loses its captain / keeper marks
create or replace function public.clear_squad_roles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.team_id is distinct from old.team_id then
    new.is_captain := false;
    new.is_vice_captain := false;
    new.is_keeper := false;
  end if;
  return new;
end $$;

drop trigger if exists clear_squad_roles on public.players;
create trigger clear_squad_roles before update of team_id on public.players
  for each row execute function public.clear_squad_roles();

-- Team owner (own squad) or organiser: playing role plus captain / vice-captain / keeper (one each per team)
create or replace function public.set_player_role(p_player uuid, p_role text, p_captain boolean, p_vice boolean, p_keeper boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.players%rowtype;
  tm public.teams%rowtype;
begin
  select * into p from public.players where id = p_player for update;
  if not found or p.team_id is null or p.status <> 'sold' then raise exception 'Player not found in a squad'; end if;
  select * into tm from public.teams where id = p.team_id;
  if not (public.is_organiser(p.tournament_id) or (tm.owner_user_id = auth.uid() and public.account_active(auth.uid()))) then
    raise exception 'Only the team owner or the organiser can do this';
  end if;
  if p_role is not null and p_role not in ('Batsman', 'Bowler', 'All-rounder', 'Wicket-keeper') then raise exception 'Unknown role'; end if;
  if coalesce(p_captain, false) and coalesce(p_vice, false) then raise exception 'Captain and vice-captain must be different players'; end if;

  if p_captain then update public.players set is_captain = false where team_id = p.team_id and id <> p.id and is_captain; end if;
  if p_vice then update public.players set is_vice_captain = false where team_id = p.team_id and id <> p.id and is_vice_captain; end if;
  if p_keeper then update public.players set is_keeper = false where team_id = p.team_id and id <> p.id and is_keeper; end if;
  update public.players
     set role = p_role, is_captain = coalesce(p_captain, false), is_vice_captain = coalesce(p_vice, false), is_keeper = coalesce(p_keeper, false)
   where id = p.id;
end $$;

-- ---------------------------------------------------------------------
-- Captain and keeper in each playing XI
-- ---------------------------------------------------------------------

alter table public.match_players add column if not exists is_captain boolean not null default false;
alter table public.match_players add column if not exists is_keeper boolean not null default false;

-- Same as 007, plus captain / keeper. Once the match has started, players already in the XI keep
-- their place but their role, captain and keeper marks can still change.
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
  if (select count(*) from jsonb_array_elements(p_players) x where coalesce((x->>'is_captain')::boolean, false)) > 1 then
    raise exception 'Pick only one captain';
  end if;
  if (select count(*) from jsonb_array_elements(p_players) x where coalesce((x->>'is_keeper')::boolean, false)) > 1 then
    raise exception 'Pick only one wicket-keeper';
  end if;
  select exists (select 1 from public.match_events where match_id = p_match and type = 'innings_start') into v_started;
  if not v_started then
    delete from public.match_players where match_id = p_match and team_id = p_team;
  else
    update public.match_players set is_captain = false, is_keeper = false where match_id = p_match and team_id = p_team;
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
    if v_started then
      update public.match_players
         set role = p->>'role', is_captain = coalesce((p->>'is_captain')::boolean, false), is_keeper = coalesce((p->>'is_keeper')::boolean, false)
       where match_id = p_match and team_id = p_team
         and (player_id = (p->>'player_id')::uuid or guest_id = (p->>'guest_id')::uuid);
      if found then continue; end if;
    end if;
    insert into public.match_players (match_id, tournament_id, team_id, player_id, guest_id, name, role, sort, is_captain, is_keeper)
    values (p_match, m.tournament_id, p_team, (p->>'player_id')::uuid, (p->>'guest_id')::uuid,
            left(coalesce(p->>'name', 'Player'), 80), p->>'role', i,
            coalesce((p->>'is_captain')::boolean, false), coalesce((p->>'is_keeper')::boolean, false));
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Scoring: Test match actions (stumps, breaks, end as a draw) and results
-- ---------------------------------------------------------------------

create or replace function public.scorer_event(p_match uuid, p_pin text, p_device text, p_seq integer, p_type text, p_data jsonb, p_live jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.matches%rowtype;
  v_last integer;
begin
  if not public.scorer_ok(p_match, p_pin, p_device) then raise exception 'Wrong PIN'; end if;
  select * into m from public.matches where id = p_match for update;
  if m.status = 'completed' then raise exception 'This match is finished'; end if;
  if p_type not in ('toss', 'innings_start', 'ball', 'new_batter', 'new_bowler', 'swap', 'retire', 'end_innings', 'stumps', 'break', 'end_match') then
    raise exception 'Unknown scoring action';
  end if;
  if p_type in ('stumps', 'break', 'end_match') and m.match_type <> 'test' then raise exception 'Only for Test matches'; end if;
  select coalesce(max(seq), 0) into v_last from public.match_events where match_id = p_match;
  if p_seq <> v_last + 1 then raise exception 'Out of sync, reloading the latest score'; end if;
  insert into public.match_events (match_id, tournament_id, seq, type, data) values (p_match, m.tournament_id, p_seq, p_type, p_data);
  update public.matches set status = 'live', live_score = p_live where id = p_match;
end $$;

-- Same as 007, plus draws, Test innings scores and per-innings stats
create or replace function public.scorer_finish(p_match uuid, p_pin text, p_device text, p_result jsonb, p_changes jsonb, p_stats jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.matches%rowtype;
  c jsonb;
begin
  if not public.scorer_ok(p_match, p_pin, p_device) then raise exception 'Wrong PIN'; end if;
  select * into m from public.matches where id = p_match for update;
  if p_result->>'outcome' not in ('win', 'tie', 'no_result', 'walkover', 'draw') then raise exception 'Invalid result'; end if;
  if p_result->>'outcome' = 'draw' and m.match_type <> 'test' then raise exception 'Only a Test match can be drawn'; end if;
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
    innings = case when jsonb_typeof(p_result->'innings') = 'array' then p_result->'innings' end,
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
    (match_id, match_player_id, innings, tournament_id, team_id, player_id, guest_id, name, did_bat, bat_runs, bat_balls, fours, sixes, out, how_out,
     bowl_balls, bowl_runs, wickets, maidens, wides, noballs, catches, stumpings, run_outs)
  select p_match, mp.id, coalesce((s->>'innings')::smallint, 1), m.tournament_id, mp.team_id, mp.player_id, mp.guest_id, mp.name,
         coalesce((s->>'did_bat')::boolean, false), coalesce((s->>'bat_runs')::int, 0), coalesce((s->>'bat_balls')::int, 0),
         coalesce((s->>'fours')::int, 0), coalesce((s->>'sixes')::int, 0), coalesce((s->>'out')::boolean, false), s->>'how_out',
         coalesce((s->>'bowl_balls')::int, 0), coalesce((s->>'bowl_runs')::int, 0), coalesce((s->>'wickets')::int, 0),
         coalesce((s->>'maidens')::int, 0), coalesce((s->>'wides')::int, 0), coalesce((s->>'noballs')::int, 0),
         coalesce((s->>'catches')::int, 0), coalesce((s->>'stumpings')::int, 0), coalesce((s->>'run_outs')::int, 0)
    from jsonb_array_elements(coalesce(p_stats, '[]'::jsonb)) s
    join public.match_players mp on mp.id = (s->>'match_player_id')::uuid and mp.match_id = p_match;
end $$;

revoke execute on function public.clear_squad_roles() from public, anon, authenticated;
revoke execute on function public.set_player_role(uuid, text, boolean, boolean, boolean) from public, anon;
grant execute on function public.set_player_role(uuid, text, boolean, boolean, boolean) to authenticated;
grant execute on function
  public.scorer_event(uuid, text, text, integer, text, jsonb, jsonb),
  public.scorer_lineup(uuid, text, text, uuid, jsonb),
  public.scorer_finish(uuid, text, text, jsonb, jsonb, jsonb)
  to anon, authenticated;
