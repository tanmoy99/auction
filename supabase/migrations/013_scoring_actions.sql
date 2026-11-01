begin;
alter table public.matches add column if not exists score_revision bigint not null default 0;
create table if not exists public.scoring_actions (
  match_id uuid not null references public.matches on delete cascade,
  action_id uuid not null,
  device text not null,
  payload jsonb not null,
  revision bigint not null,
  created_at timestamptz not null default now(),
  primary key(match_id,action_id)
);
alter table public.scoring_actions enable row level security;
revoke all on public.scoring_actions from anon, authenticated;

create or replace function public.bump_score_revision() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.matches set score_revision = score_revision + 1
    where id = case when tg_op = 'DELETE' then old.match_id else new.match_id end;
  return null;
end $$;
drop trigger if exists score_event_revision on public.match_events;
create trigger score_event_revision after insert or update or delete on public.match_events
  for each row execute function public.bump_score_revision();
drop trigger if exists score_lineup_revision on public.match_players;
create trigger score_lineup_revision after insert or update or delete on public.match_players
  for each row execute function public.bump_score_revision();
drop trigger if exists score_device_revision on public.match_scorers;
create trigger score_device_revision after update of device_id, pin on public.match_scorers
  for each row when (new.device_id is distinct from old.device_id or new.pin is distinct from old.pin)
  execute function public.bump_score_revision();

create or replace function public.score_config_revision() returns trigger
language plpgsql set search_path = public as $$
begin
  if (to_jsonb(new) - array['score_revision','live_score','status']) is distinct from
     (to_jsonb(old) - array['score_revision','live_score','status'])
     or (new.status is distinct from old.status and (new.status = 'completed' or old.status = 'completed')) then
    new.score_revision := old.score_revision + 1;
  end if;
  return new;
end $$;
drop trigger if exists score_config_revision on public.matches;
create trigger score_config_revision before update on public.matches for each row execute function public.score_config_revision();

create or replace function public.scorer_action(p_match uuid, p_pin text, p_device text,
  p_action uuid, p_revision bigint, p_kind text, p_seq integer, p_data jsonb, p_live jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare m public.matches%rowtype; previous public.scoring_actions%rowtype; payload jsonb; revision bigint;
begin
  -- Same lock order as legacy scorer_ok -> matches. Claims and writes cannot race.
  perform 1 from public.match_scorers where match_id = p_match for update;
  if not public.scorer_ok(p_match,p_pin,p_device) then raise exception 'Wrong PIN'; end if;
  select * into m from public.matches where id = p_match for update;
  payload := jsonb_build_object('revision',p_revision,'kind',p_kind,'seq',p_seq,'data',p_data,'live',p_live);
  select * into previous from public.scoring_actions where match_id=p_match and action_id=p_action;
  if found then
    if previous.device <> p_device or previous.payload <> payload then raise exception 'Action identifier reused with different input'; end if;
    return previous.revision;
  end if;
  if m.status = 'completed' then raise exception 'This match is finished'; end if;
  if m.score_revision <> p_revision then raise exception 'Score changed. Review pending actions before continuing'; end if;
  if p_kind = 'undo' then
    perform public.scorer_undo(p_match,p_pin,p_device,p_seq,p_live);
  elsif p_kind = 'event' then
    perform public.scorer_event(p_match,p_pin,p_device,p_seq,p_data->>'type',p_data,p_live);
  else raise exception 'Unknown scoring action'; end if;
  select score_revision into revision from public.matches where id=p_match;
  insert into public.scoring_actions values(p_match,p_action,p_device,payload,revision,now());
  return revision;
end $$;
revoke all on function public.bump_score_revision(), public.score_config_revision() from public,anon,authenticated;
revoke all on function public.scorer_action(uuid,text,text,uuid,bigint,text,integer,jsonb,jsonb) from public;
grant execute on function public.scorer_action(uuid,text,text,uuid,bigint,text,integer,jsonb,jsonb) to anon,authenticated;
commit;
