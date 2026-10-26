-- Automatic auction flow:
--   * when a player's timer runs out -> SOLD to the highest bidder, or UNSOLD if nobody bid
--   * a few seconds later -> the next random player comes up automatically (optional)
-- Any open screen (auctioneer, big screen, owner phones) nudges the server with auction_tick(),
-- so the auction keeps moving even if one device sleeps. The server decides; clients can't cheat.
-- Run once in Supabase SQL Editor (schema.sql already includes this for new projects).

alter table public.tournaments add column if not exists auto_close boolean not null default true;
alter table public.tournaments add column if not exists auto_next boolean not null default true;
alter table public.tournaments add column if not exists result_pause_seconds integer not null default 6
  check (result_pause_seconds between 2 and 60);

-- Internal: give the player on stage to the highest bidder, or mark unsold. Caller holds the row lock.
create or replace function public.finalize_player(p_tournament uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  st public.auction_state%rowtype;
begin
  select * into st from public.auction_state where tournament_id = p_tournament;
  if st.phase <> 'bidding' then return st.phase; end if;

  if st.leading_team_id is not null then
    update public.players set status = 'sold', team_id = st.leading_team_id, sold_price = st.current_bid
     where id = st.player_id;
    update public.teams set spent = spent + st.current_bid where id = st.leading_team_id;
    update public.auction_state set phase = 'sold', ends_at = null, updated_at = now()
     where tournament_id = p_tournament;
    return 'sold';
  end if;

  update public.players set status = 'unsold' where id = st.player_id;
  update public.auction_state set phase = 'unsold', ends_at = null, updated_at = now()
   where tournament_id = p_tournament;
  return 'unsold';
end $$;
revoke execute on function public.finalize_player(uuid) from public, anon, authenticated;

create or replace function public.close_player(p_tournament uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  st public.auction_state%rowtype;
begin
  if not public.is_organiser(p_tournament) then raise exception 'Only the organiser can do this'; end if;
  select * into st from public.auction_state where tournament_id = p_tournament for update;
  if st.phase <> 'bidding' then raise exception 'No player is being auctioned'; end if;
  return public.finalize_player(p_tournament);
end $$;

-- Safe for anyone to call: it only does what the tournament's own rules say is due.
create or replace function public.auction_tick(p_tournament uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  st public.auction_state%rowtype;
  t public.tournaments%rowtype;
  v_next uuid;
begin
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
