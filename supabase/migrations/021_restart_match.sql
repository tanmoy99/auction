-- 021: organiser can restart one match (additive). The toss, every ball and the result are removed and the
-- match goes back to "not started"; the playing XIs are kept. Later knockout matches that took a team from
-- this result are emptied again, unless one of them has already started (then nothing changes).
begin;

create or replace function public.restart_match(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m public.matches%rowtype;
  blocker integer;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or not public.is_organiser(m.tournament_id) then raise exception 'Match not found'; end if;
  if not public.tournament_active(m.tournament_id) then raise exception 'This tournament is paused'; end if;

  -- a later match already playing with this match's winner / loser
  select d.match_no into blocker from public.matches d
   where d.tournament_id = m.tournament_id and d.id <> m.id and d.status <> 'scheduled'
     and ((d.a_source->>'type' in ('winner', 'loser') and (d.a_source->>'match')::integer = m.match_no)
       or (d.b_source->>'type' in ('winner', 'loser') and (d.b_source->>'match')::integer = m.match_no))
   order by d.match_no limit 1;
  -- or a knockout already playing with a team taken from this league / group table
  if blocker is null and m.stage in ('league', 'group') and m.match_type <> 'test' then
    select d.match_no into blocker from public.matches d
     where d.tournament_id = m.tournament_id and d.status <> 'scheduled'
       and ((d.a_source->>'type' = 'standing' and (d.a_source->>'group') is not distinct from m.group_name)
         or (d.b_source->>'type' = 'standing' and (d.b_source->>'group') is not distinct from m.group_name))
     order by d.match_no limit 1;
  end if;
  if blocker is not null then
    raise exception 'Match % has already started with a team from this result. Restart match % first', blocker, blocker;
  end if;

  delete from public.match_events where match_id = m.id;
  delete from public.scoring_actions where match_id = m.id;
  delete from public.player_match_stats where match_id = m.id;
  update public.matches set
    status = 'scheduled', live_score = null, innings = null, outcome = null, winner_team_id = null, batting_first = null,
    a_runs = null, a_wickets = null, a_balls = null, b_runs = null, b_wickets = null, b_balls = null, result_text = null
   where id = m.id;
  -- later knockout slots filled from this result go back to "winner of match N"
  update public.matches d set team_a_id = null
   where d.tournament_id = m.tournament_id and d.a_source->>'type' in ('winner', 'loser') and (d.a_source->>'match')::integer = m.match_no;
  update public.matches d set team_b_id = null
   where d.tournament_id = m.tournament_id and d.b_source->>'type' in ('winner', 'loser') and (d.b_source->>'match')::integer = m.match_no;
end $$;

revoke all on function public.restart_match(uuid) from public;
grant execute on function public.restart_match(uuid) to authenticated;

commit;
