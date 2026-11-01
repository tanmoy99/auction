begin;
-- Explicit allowlists; newly added columns never become public by accident.
create or replace view public.tournament_display as
select id, name, venue, starts_on, team_budget, base_price, min_squad, max_squad,
  bid_timer_seconds, increment_slabs, auto_close, auto_next, result_pause_seconds,
  registration_open, status, suspended, fixture_settings, created_at,
  case when organiser_id = auth.uid() or public.is_admin() then organiser_id end as organiser_id,
  case when organiser_id = auth.uid() or public.is_admin() then registration_token end as registration_token,
  case when organiser_id = auth.uid() or public.is_admin() then suspended_reason end as suspended_reason
from public.tournaments;
create or replace view public.team_display as
select id, tournament_id, name, short_name, color, logo_url, purse, spent, created_at,
  case when owner_user_id = auth.uid() or public.is_organiser(tournament_id) then owner_name end as owner_name,
  case when owner_user_id = auth.uid() or public.is_organiser(tournament_id) then owner_user_id end as owner_user_id,
  case when owner_user_id = auth.uid() or public.is_organiser(tournament_id) then owner_login end as owner_login,
  case when owner_user_id = auth.uid() or public.is_organiser(tournament_id) then player_access else 'none' end as player_access
from public.teams;
revoke all on public.tournament_display, public.team_display from anon, authenticated;
grant select on public.tournament_display, public.team_display to anon, authenticated;

create or replace function public.registration_info(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', name, 'venue', venue,
    'registration_open', registration_open and public.tournament_active(id))
  from public.tournaments where registration_token = p_token;
$$;
revoke all on function public.registration_info(uuid) from public;
grant execute on function public.registration_info(uuid) to anon, authenticated;

create or replace function public.owner_teams() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(tm) || jsonb_build_object('tournaments',
    jsonb_build_object('id',t.id,'name',t.name,'status',t.status))), '[]'::jsonb)
  from public.teams tm join public.tournaments t on t.id = tm.tournament_id
  where tm.owner_user_id = auth.uid();
$$;
revoke all on function public.owner_teams() from public, anon;
grant execute on function public.owner_teams() to authenticated;
commit;
