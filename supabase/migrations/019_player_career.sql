-- 019: public player profile across tournaments (read-only, additive).
-- A player's entries in different tournaments are linked inside the database when the registered mobile
-- number AND the first name match (a family sharing one phone stays separate). The number is never returned.
-- Pending (unapproved) players and suspended tournaments are left out, the same as the public pages.
begin;

create or replace function public.player_career(p_player uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (
    select p.id, p.name, public.mobile_key(c.phone) as mobile
    from public.players p
    left join public.player_contacts c on c.player_id = p.id
    where p.id = p_player and p.status <> 'pending' and public.tournament_active(p.tournament_id)
  ),
  linked as (
    select distinct p.*
    from public.players p
    left join public.player_contacts c on c.player_id = p.id
    join me on p.id = me.id
      or (me.mobile is not null
          and public.mobile_key(c.phone) = me.mobile
          and lower(split_part(trim(p.name), ' ', 1)) = lower(split_part(trim(me.name), ' ', 1)))
    where p.status <> 'pending' and public.tournament_active(p.tournament_id)
  )
  select case when not exists (select 1 from me) then null else jsonb_build_object(
    'profile', (
      select jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role, 'batting_style', p.batting_style,
        'bowling_style', p.bowling_style, 'city', p.city, 'photo_url', p.photo_url)
      from public.players p where p.id = p_player),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object('player_id', l.id, 'tournament_id', t.id, 'tournament', t.name,
          'starts_on', t.starts_on, 'team_id', tm.id, 'team', tm.name, 'team_color', tm.color,
          'sold_price', l.sold_price, 'status', l.status, 'photo_url', l.photo_url)
        order by t.starts_on desc nulls last, t.created_at desc)
      from linked l
      join public.tournaments t on t.id = l.tournament_id
      left join public.teams tm on tm.id = l.team_id), '[]'::jsonb),
    'stats', coalesce((
      select jsonb_agg(to_jsonb(s) || jsonb_build_object('match_no', m.match_no, 'round_name', m.round_name,
          'scheduled_at', m.scheduled_at, 'result_text', m.result_text, 'winner_team_id', m.winner_team_id,
          'opponent', (select o.name from public.teams o
                        where o.id = case when s.team_id = m.team_a_id then m.team_b_id else m.team_a_id end))
        order by m.scheduled_at desc nulls last, m.match_no desc)
      from public.player_match_stats s
      join linked l on l.id = s.player_id
      join public.matches m on m.id = s.match_id), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.player_career(uuid) from public;
grant execute on function public.player_career(uuid) to anon, authenticated;

commit;
