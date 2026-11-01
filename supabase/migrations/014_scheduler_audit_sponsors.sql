begin;
-- Called by an explicitly installed one-second pg_cron job, never a minute-level Vercel cron.
create or replace function public.tick_due_auctions() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select s.tournament_id from public.auction_state s join public.tournaments t on t.id=s.tournament_id
    where t.status='live' and not t.suspended and (
      (s.phase='bidding' and t.auto_close and s.ends_at <= now()) or
      (s.phase in ('sold','unsold') and t.auto_next and s.updated_at + make_interval(secs=>t.result_pause_seconds) <= now()))
    order by s.updated_at limit 100
  loop
    perform public.auction_tick(r.tournament_id); n := n+1;
  end loop;
  return n;
end $$;
revoke all on function public.tick_due_auctions() from public,anon,authenticated;
grant execute on function public.tick_due_auctions() to service_role;

create table if not exists public.audit_history (
  id bigint generated always as identity primary key,
  tournament_id uuid not null references public.tournaments on delete cascade,
  actor uuid, actor_kind text not null, at timestamptz not null default now(),
  action text not null, entity_id uuid, before_value jsonb, after_value jsonb
);
alter table public.audit_history enable row level security;
revoke all on public.audit_history from anon,authenticated;
grant select on public.audit_history to authenticated;
drop policy if exists "organiser reads audit" on public.audit_history;
create policy "organiser reads audit" on public.audit_history for select to authenticated using(public.is_organiser(tournament_id));
create or replace function public.record_audit_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare tid uuid; eid uuid; old_value jsonb; new_value jsonb;
begin
  if tg_table_name='players' then
    tid:=new.tournament_id; eid:=new.id;
    old_value:=jsonb_build_object('team_id',old.team_id,'status',old.status,'sold_price',old.sold_price);
    new_value:=jsonb_build_object('team_id',new.team_id,'status',new.status,'sold_price',new.sold_price);
  elsif tg_table_name='matches' then
    tid:=new.tournament_id; eid:=new.id;
    old_value:=jsonb_build_object('status',old.status,'result',old.result_text,'winner',old.winner_team_id,'a_runs',old.a_runs,'b_runs',old.b_runs,'innings',old.innings);
    new_value:=jsonb_build_object('status',new.status,'result',new.result_text,'winner',new.winner_team_id,'a_runs',new.a_runs,'b_runs',new.b_runs,'innings',new.innings);
  elsif tg_table_name='match_scorers' then
    tid:=new.tournament_id; eid:=new.match_id;
    old_value:=jsonb_build_object('device_name',old.device_name);
    new_value:=jsonb_build_object('device_name',new.device_name);
  else
    tid:=new.id; eid:=new.id;
    old_value:=jsonb_build_object('status',old.status);
    new_value:=jsonb_build_object('status',new.status);
  end if;
  if old_value is distinct from new_value or tg_table_name='match_scorers' then
    insert into public.audit_history(tournament_id,actor,actor_kind,action,entity_id,before_value,after_value)
      values(tid,auth.uid(),case when auth.uid() is null then 'database or PIN scorer' else 'account' end,
        tg_table_name || '.changed',eid,old_value,new_value);
  end if;
  return null;
end $$;
revoke all on function public.record_audit_change() from public,anon,authenticated;
drop trigger if exists audit_player on public.players;
create trigger audit_player after update of team_id,status,sold_price on public.players for each row execute function public.record_audit_change();
drop trigger if exists audit_match on public.matches;
create trigger audit_match after update of result_text,winner_team_id,a_runs,b_runs,innings on public.matches for each row execute function public.record_audit_change();
drop trigger if exists audit_takeover on public.match_scorers;
create trigger audit_takeover after update of device_id on public.match_scorers for each row when (old.device_id is distinct from new.device_id) execute function public.record_audit_change();
drop trigger if exists audit_auction on public.tournaments;
create trigger audit_auction after update of status on public.tournaments for each row execute function public.record_audit_change();

create table if not exists public.sponsors (
  id uuid primary key default gen_random_uuid(), tournament_id uuid not null references public.tournaments on delete cascade,
  name text not null check(length(trim(name)) between 1 and 80), logo_url text,
  created_at timestamptz not null default now(),
  check(logo_url is null or logo_url like 'https://%')
);
alter table public.sponsors enable row level security;
drop policy if exists "sponsors public read" on public.sponsors;
create policy "sponsors public read" on public.sponsors for select using(true);
drop policy if exists "organiser manages sponsors" on public.sponsors;
create policy "organiser manages sponsors" on public.sponsors for all to authenticated
  using(public.is_organiser(tournament_id)) with check(public.is_organiser(tournament_id));
grant select on public.sponsors to anon,authenticated;
grant insert,update,delete on public.sponsors to authenticated;
commit;
