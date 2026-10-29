-- Start and finish the auction on purpose. Finishing clears the stage, stops the automatic steps
-- and blocks new players until the organiser reopens it.
-- Run once in Supabase -> SQL Editor. Safe to run again.

-- p_status: 'live' (start, or reopen a finished auction) or 'completed' (finish)
create or replace function public.set_auction_status(p_tournament uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  st public.auction_state%rowtype;
begin
  if not public.is_organiser(p_tournament) then raise exception 'Only the organiser can do this'; end if;
  if p_status not in ('live', 'completed') then raise exception 'Unknown auction status'; end if;
  select * into st from public.auction_state where tournament_id = p_tournament for update;

  if p_status = 'completed' then
    if st.phase = 'bidding' then raise exception 'Close the player on stage first (SOLD, UNSOLD or Cancel)'; end if;
    update public.auction_state
       set player_id = null, current_bid = null, leading_team_id = null, phase = 'idle', ends_at = null,
           next_player_id = null, updated_at = now()
     where tournament_id = p_tournament;
  end if;
  update public.tournaments set status = p_status where id = p_tournament;
end $$;

-- Same as 005, plus: a finished auction takes no more players
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

  select * into t from public.tournaments where id = p_tournament;
  if t.status = 'completed' then raise exception 'The auction is finished. Reopen it to bring more players'; end if;

  select * into p from public.players where id = p_player and tournament_id = p_tournament;
  if not found or p.status not in ('available', 'unsold') then
    raise exception 'This player is not available for auction';
  end if;

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

revoke execute on function public.set_auction_status(uuid, text) from public, anon;
grant execute on function public.set_auction_status(uuid, text) to authenticated;
