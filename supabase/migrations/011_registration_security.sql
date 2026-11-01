-- Apply in a transaction. Existing duplicates stop this migration without deleting data.
begin;

create or replace function public.mobile_key(phone text) returns text
language sql immutable set search_path = public as $$
  select case
    when d ~ '^[6-9][0-9]{9}$' then d
    when d ~ '^91[6-9][0-9]{9}$' then substring(d from 3)
    when d ~ '^0[6-9][0-9]{9}$' then substring(d from 2)
  end from (select regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g') d) s;
$$;

do $$ begin
  if exists (select 1 from public.player_contacts
    where public.mobile_key(phone) is not null
    group by tournament_id, public.mobile_key(phone) having count(*) > 1) then
    raise exception 'Duplicate mobile numbers exist. Review player_contacts grouped by tournament_id and mobile_key(phone), resolve explicitly, then rerun 011. No records have been deleted.';
  end if;
end $$;
create unique index if not exists contacts_tournament_mobile_unique
  on public.player_contacts(tournament_id, public.mobile_key(phone))
  where public.mobile_key(phone) is not null;

create or replace function public.guard_contact() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from public.players where id = new.player_id and tournament_id = new.tournament_id) then
    raise exception 'Contact must belong to the player tournament';
  end if;
  if nullif(trim(new.phone),'') is not null then
    if public.mobile_key(new.phone) is null or new.phone !~ '^[+0-9 ().-]+$' then raise exception 'Invalid Indian mobile number'; end if;
    new.phone := '+91' || public.mobile_key(new.phone);
  end if;
  return new;
end $$;
drop trigger if exists guard_contact on public.player_contacts;
create trigger guard_contact before insert or update on public.player_contacts for each row execute function public.guard_contact();
revoke all on function public.guard_contact() from public, anon, authenticated;

create or replace function public.photo_path_allowed(path text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if path !~ '^[0-9a-fA-F-]{36}/[^/]+$' then return false; end if;
  return public.is_organiser(split_part(path, '/', 1)::uuid);
exception when invalid_text_representation then return false;
end $$;
revoke all on function public.photo_path_allowed(text) from public, anon;
grant execute on function public.photo_path_allowed(text) to authenticated;
drop policy if exists "photos upload" on storage.objects;
drop policy if exists "photos update" on storage.objects;
drop policy if exists "photos delete" on storage.objects;
create policy "photos upload" on storage.objects for insert to authenticated
  with check(bucket_id = 'photos' and public.photo_path_allowed(name));
create policy "photos update" on storage.objects for update to authenticated
  using(bucket_id = 'photos' and public.photo_path_allowed(name))
  with check(bucket_id = 'photos' and public.photo_path_allowed(name));
create policy "photos delete" on storage.objects for delete to authenticated
  using(bucket_id = 'photos' and public.photo_path_allowed(name));

-- Service-only, shared across server instances. Keys are hashes, never raw addresses.
create table if not exists public.registration_limits (
  key text primary key, window_at timestamptz not null, requests integer not null
);
alter table public.registration_limits enable row level security;
revoke all on public.registration_limits from anon, authenticated;
create or replace function public.registration_allow(p_key text, p_limit integer default 20) returns boolean
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.registration_limits as r values (p_key, now(), 1)
  on conflict(key) do update set
    requests = case when r.window_at < now() - interval '1 minute' then 1 else r.requests + 1 end,
    window_at = case when r.window_at < now() - interval '1 minute' then now() else r.window_at end
  returning requests into n;
  delete from public.registration_limits where window_at < now() - interval '1 day';
  return n <= p_limit;
end $$;
revoke all on function public.registration_allow(text, integer) from public, anon, authenticated;
grant execute on function public.registration_allow(text, integer) to service_role;

create or replace function public.register_player(p_token uuid, p_player jsonb, p_source text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.tournaments%rowtype; v_id uuid; mobile text;
begin
  select * into t from public.tournaments where registration_token = p_token for share;
  if not found then raise exception 'Invalid registration link'; end if;
  if not t.registration_open or not public.tournament_active(t.id) then raise exception 'Registration is closed'; end if;
  mobile := public.mobile_key(p_player->>'phone');
  if mobile is null then raise exception 'Invalid Indian mobile number'; end if;
  if length(trim(coalesce(p_player->>'name',''))) not between 1 and 80 then raise exception 'Invalid player name'; end if;
  -- The unique contact index arbitrates concurrent requests. This block rolls BOTH inserts back.
  begin
    insert into public.players(tournament_id,name,role,batting_style,bowling_style,age,city,photo_url,base_price,status,source)
    values(t.id,trim(p_player->>'name'),p_player->>'role',p_player->>'batting_style',p_player->>'bowling_style',
      (p_player->>'age')::integer,p_player->>'city',p_player->>'photo_url',t.base_price,'pending',p_source)
    returning id into v_id;
    insert into public.player_contacts values(v_id,t.id,'+91' || mobile);
  exception when unique_violation then
    if exists(select 1 from public.player_contacts where tournament_id=t.id and public.mobile_key(phone)=mobile) then
      return jsonb_build_object('duplicate',true);
    end if;
    raise;
  end;
  return jsonb_build_object('id',v_id,'duplicate',false);
end $$;
revoke all on function public.register_player(uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.register_player(uuid,jsonb,text) to service_role;
commit;
