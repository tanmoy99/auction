-- Fix: team owner accounts must never be able to create tournaments.
-- Run once in Supabase SQL Editor if you ran schema.sql before 2026-10-26 (schema.sql already includes this).

create or replace function public.handle_user_role_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.raw_app_meta_data->>'role' = 'owner' then
    update public.profiles set role = 'owner' where id = new.id and role <> 'owner';
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_role_change on auth.users;
create trigger on_auth_user_role_change after update of raw_app_meta_data on auth.users
  for each row execute function public.handle_user_role_change();
revoke execute on function public.handle_user_role_change() from public, anon, authenticated;

-- repair any owner accounts already created with the wrong profile role
update public.profiles p set role = 'owner'
  from auth.users u
 where u.id = p.id and u.raw_app_meta_data->>'role' = 'owner' and p.role <> 'owner';

drop policy if exists "organisers create tournaments" on public.tournaments;
create policy "organisers create tournaments" on public.tournaments for insert to authenticated
  with check (organiser_id = auth.uid()
              and coalesce(auth.jwt()->'app_metadata'->>'role', '') <> 'owner'
              and exists (select 1 from public.profiles where id = auth.uid() and role = 'organiser'));
