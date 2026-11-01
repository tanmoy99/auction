-- Apply AFTER the new client rollout and after old tabs have reloaded. See docs/LOCAL-REVIEW.md.
begin;
-- Base tables remain writable through existing policies, but full rows are private.
drop policy if exists "tournaments readable" on public.tournaments;
create policy "tournaments readable" on public.tournaments for select to authenticated
  using(organiser_id = auth.uid() or public.is_admin());
drop policy if exists "teams readable" on public.teams;
create policy "teams readable" on public.teams for select to authenticated
  using(owner_user_id = auth.uid() or public.is_organiser(tournament_id));

commit;
