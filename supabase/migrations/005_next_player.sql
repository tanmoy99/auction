-- "Up next": the next player is picked as soon as a player comes on stage, so everyone
-- can see who is coming. The organiser can change it. Run once in Supabase -> SQL Editor.

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
