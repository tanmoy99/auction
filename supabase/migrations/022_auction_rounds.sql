-- 022: auction rounds (additive). The organiser can limit the auction to some player categories
-- (e.g. "A", "Icon") and/or some playing roles (Batsman, Bowler, ...). Random picks and the automatic
-- "up next" only come from that round. Empty / null = everyone, which is how every tournament stays
-- until the organiser picks a round. No rows are deleted or rewritten; two nullable columns are added.
begin;

alter table public.auction_state add column if not exists pool_categories text[];
alter table public.auction_state add column if not exists pool_roles text[];

-- Does a player belong to the current round? Case and spaces don't matter.
create or replace function public.in_auction_pool(p_category text, p_role text, p_categories text[], p_roles text[])
returns boolean language sql immutable set search_path = public as $$
  select (coalesce(cardinality(p_categories), 0) = 0
          or lower(btrim(coalesce(p_category, ''))) in (select lower(btrim(x)) from unnest(p_categories) x))
     and (coalesce(cardinality(p_roles), 0) = 0
          or lower(btrim(coalesce(p_role, ''))) in (select lower(btrim(x)) from unnest(p_roles) x));
$$;
revoke execute on function public.in_auction_pool(text, text, text[], text[]) from public, anon, authenticated;

-- Internal: a random player still waiting in the pool (and in the current round), never the one on stage
create or replace function public.pick_next_player(p_tournament uuid, p_exclude uuid)
returns uuid language sql volatile security definer set search_path = public as $$
  select p.id from public.players p
    left join public.auction_state s on s.tournament_id = p.tournament_id
   where p.tournament_id = p_tournament and p.status = 'available' and p.id is distinct from p_exclude
     and public.in_auction_pool(p.category, p.role, s.pool_categories, s.pool_roles)
   order by random() limit 1;
$$;
revoke execute on function public.pick_next_player(uuid, uuid) from public, anon, authenticated;

-- Organiser picks the round. The "up next" player is re-picked if they are not in the new round.
create or replace function public.set_auction_pool(p_tournament uuid, p_categories text[], p_roles text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  st public.auction_state%rowtype;
  v_categories text[];
  v_roles text[];
begin
  if not public.is_organiser(p_tournament) then raise exception 'Only the organiser can do this'; end if;
  if not public.tournament_active(p_tournament) then raise exception 'This tournament is paused'; end if;
  select array_agg(distinct left(btrim(x), 60)) into v_categories from unnest(p_categories) x where btrim(coalesce(x, '')) <> '';
  select array_agg(distinct left(btrim(x), 60)) into v_roles from unnest(p_roles) x where btrim(coalesce(x, '')) <> '';
  if coalesce(cardinality(v_categories), 0) > 50 or coalesce(cardinality(v_roles), 0) > 20 then raise exception 'Too many choices'; end if;

  select * into st from public.auction_state where tournament_id = p_tournament for update;
  if not found then raise exception 'Tournament not found'; end if;
  update public.auction_state set pool_categories = v_categories, pool_roles = v_roles
   where tournament_id = p_tournament;
  -- updated_at stays: it times the pause after SOLD / UNSOLD
  if not exists (select 1 from public.players p
                  where p.id = st.next_player_id and p.status = 'available' and p.id is distinct from st.player_id
                    and public.in_auction_pool(p.category, p.role, v_categories, v_roles)) then
    update public.auction_state set next_player_id = public.pick_next_player(p_tournament, st.player_id)
     where tournament_id = p_tournament;
  end if;
end $$;
revoke execute on function public.set_auction_pool(uuid, text[], text[]) from public, anon;
grant execute on function public.set_auction_pool(uuid, text[], text[]) to authenticated;

commit;
