begin;
create table if not exists public.registration_uploads (
  path text primary key, url text not null unique,
  state text not null default 'pending' check(state in ('pending','referenced','deleting')),
  created_at timestamptz not null default now()
);
alter table public.registration_uploads enable row level security;
revoke all on public.registration_uploads from anon,authenticated;
grant all on public.registration_uploads to service_role;
create or replace function public.reference_registration_upload() returns trigger
language plpgsql security definer set search_path=public as $$
declare current_state text;
begin
  select state into current_state from public.registration_uploads where url=new.photo_url for update;
  if found then
    if current_state='deleting' then raise exception 'Photo expired. Upload it again'; end if;
    update public.registration_uploads set state='referenced' where url=new.photo_url;
  end if;
  return new;
end $$;
drop trigger if exists reference_registration_upload on public.players;
create trigger reference_registration_upload before insert or update of photo_url on public.players
  for each row execute function public.reference_registration_upload();
create or replace function public.claim_abandoned_uploads() returns table(path text)
language sql security definer set search_path=public as $$
  update public.registration_uploads j set state='deleting'
  where j.path in (select x.path from public.registration_uploads x
    where x.created_at < now()-interval '24 hours' and x.state in ('pending','deleting')
      and not exists(select 1 from public.players p where p.photo_url=x.url)
    order by x.created_at limit 100 for update skip locked)
  returning j.path;
$$;
revoke all on function public.reference_registration_upload(),public.claim_abandoned_uploads() from public,anon,authenticated;
grant execute on function public.claim_abandoned_uploads() to service_role;
commit;
