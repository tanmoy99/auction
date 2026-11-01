begin;

create or replace function public.reset_auction(p_tournament uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_organiser(p_tournament) then raise exception 'Only the organiser can do this'; end if;
  perform 1 from public.auction_state where tournament_id=p_tournament for update;
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

create or replace function public.release_player(p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.players%rowtype;
begin
  select * into p from public.players where id = p_player;
  if not found or not public.is_organiser(p.tournament_id) then raise exception 'Only the organiser can do this'; end if;
  perform 1 from public.auction_state where tournament_id=p.tournament_id for update;
  select * into p from public.players where id=p_player for update;
  if not found or not public.is_organiser(p.tournament_id) then raise exception 'Only the organiser can do this'; end if;
  if exists (select 1 from public.auction_state where player_id = p_player and phase = 'bidding') then
    raise exception 'This player is being auctioned right now';
  end if;
  if p.status = 'sold' and p.team_id is not null then
    update public.teams set spent = greatest(spent - coalesce(p.sold_price, 0), 0) where id = p.team_id;
  end if;
  update public.players set status = 'available', team_id = null, sold_price = null where id = p_player;
end $$;

create or replace function public.assign_player(p_player uuid, p_team uuid, p_price integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.players%rowtype;
  tm public.teams%rowtype;
begin
  select * into p from public.players where id = p_player;
  if not found or not public.is_organiser(p.tournament_id) then raise exception 'Only the organiser can do this'; end if;
  perform 1 from public.auction_state where tournament_id=p.tournament_id for update;
  select * into p from public.players where id=p_player for update;
  if not found or not public.is_organiser(p.tournament_id) then raise exception 'Only the organiser can do this'; end if;
  if p.status = 'sold' then raise exception 'Release this player first'; end if;
  if exists (select 1 from public.auction_state where player_id = p_player and phase = 'bidding') then
    raise exception 'This player is being auctioned right now';
  end if;
  select * into tm from public.teams where id = p_team and tournament_id = p.tournament_id for update;
  if not found then raise exception 'Team not found'; end if;
  if (select count(*) from public.players where team_id=p_team and status='sold') >= (select max_squad from public.tournaments where id=p.tournament_id) then raise exception 'Squad is full'; end if;
  if p_price < 0 or p_price > tm.purse - tm.spent then raise exception 'Team does not have enough purse'; end if;

  update public.players set status = 'sold', team_id = p_team, sold_price = p_price where id = p_player;
  update public.teams set spent = spent + p_price where id = p_team;
end $$;

create or replace function public.apply_bid(p_tournament uuid, p_team uuid, p_amount integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  st public.auction_state%rowtype;
  t public.tournaments%rowtype;
  tm public.teams%rowtype;
  p public.players%rowtype;
  v_min integer;
  v_squad integer;
  v_max integer;
begin
  if not public.tournament_active(p_tournament) then
    raise exception 'This auction is paused by the site admin';
  end if;

  select * into st from public.auction_state where tournament_id = p_tournament for update;
  if not found or st.phase <> 'bidding' or st.player_id is null then
    raise exception 'Bidding is not open right now';
  end if;
  if st.ends_at is not null and clock_timestamp() >= st.ends_at then
    raise exception 'Time is up for this player';
  end if;

  select * into tm from public.teams where id = p_team and tournament_id = p_tournament;
  if not found then raise exception 'Team not found'; end if;
  if st.leading_team_id = tm.id then raise exception 'You already have the highest bid'; end if;

  select * into t from public.tournaments where id = p_tournament;
  if t.status <> 'live' then raise exception 'Auction is not running'; end if;
  select * into p from public.players where id = st.player_id;

  v_min := case when st.current_bid is null then p.base_price
                else st.current_bid + public.bid_step(t.increment_slabs, st.current_bid) end;
  if p_amount < v_min then raise exception 'Minimum bid is Rs %', v_min; end if;

  select count(*) into v_squad from public.players where team_id = tm.id and status = 'sold';
  if v_squad >= t.max_squad then raise exception 'Squad is full (% players)', t.max_squad; end if;

  -- keep enough money to fill the remaining minimum squad at base price
  v_max := (tm.purse - tm.spent) - greatest(t.min_squad - v_squad - 1, 0) * t.base_price;
  if p_amount > v_max then
    raise exception 'Not enough purse. Max bid allowed is Rs %', greatest(v_max, 0);
  end if;

  update public.auction_state
     set current_bid = p_amount,
         leading_team_id = tm.id,
         ends_at = case when t.bid_timer_seconds > 0 then clock_timestamp() + make_interval(secs => t.bid_timer_seconds) end,
         updated_at = clock_timestamp()
   where tournament_id = p_tournament;

  insert into public.bids (tournament_id, player_id, team_id, amount)
  values (p_tournament, st.player_id, tm.id, p_amount);

  return jsonb_build_object('amount', p_amount, 'team_id', tm.id);
end $$;

create or replace function public.invalidate_match_rules() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  update public.matches set score_revision=score_revision+1 where tournament_id=new.id;
  return null;
end $$;
drop trigger if exists invalidate_match_rules on public.tournaments;
create trigger invalidate_match_rules after update of fixture_settings on public.tournaments
  for each row when (new.fixture_settings is distinct from old.fixture_settings) execute function public.invalidate_match_rules();
revoke all on function public.invalidate_match_rules() from public,anon,authenticated;
commit;
