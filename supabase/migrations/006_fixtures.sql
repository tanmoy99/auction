-- Fixtures: league / groups / knockout matches, results, points table.
-- Run once in Supabase -> SQL Editor. Safe to run again.

-- Format, points rules, overs and schedule the organiser chose
alter table public.tournaments add column if not exists fixture_settings jsonb;

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments on delete cascade,
  match_no integer not null,
  stage text not null check (stage in ('league', 'group', 'knockout')),
  group_name text,
  round integer not null default 1,
  round_name text not null,
  team_a_id uuid references public.teams on delete set null,
  team_b_id uuid references public.teams on delete set null,
  -- where a knockout slot's team comes from: {"type":"winner","match":12}, {"type":"standing","group":"A","position":1} ...
  a_source jsonb,
  b_source jsonb,
  scheduled_at timestamptz,
  venue text,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed')),
  outcome text check (outcome in ('win', 'tie', 'no_result', 'walkover')),
  winner_team_id uuid references public.teams on delete set null,
  batting_first text check (batting_first in ('a', 'b')),
  a_runs integer check (a_runs >= 0),
  a_wickets integer check (a_wickets between 0 and 20),
  a_balls integer check (a_balls >= 0),
  b_runs integer check (b_runs >= 0),
  b_wickets integer check (b_wickets between 0 and 20),
  b_balls integer check (b_balls >= 0),
  result_text text,
  created_at timestamptz not null default now(),
  unique (tournament_id, match_no)
);

create index if not exists matches_tournament_idx on public.matches (tournament_id, match_no);

alter table public.matches enable row level security;

drop policy if exists "matches readable" on public.matches;
create policy "matches readable" on public.matches for select using (true);
drop policy if exists "organiser manages matches" on public.matches;
create policy "organiser manages matches" on public.matches for all to authenticated
  using (public.is_organiser(tournament_id)) with check (public.is_organiser(tournament_id));

grant select on public.matches to anon, authenticated;
grant insert, update, delete on public.matches to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'matches') then
    alter publication supabase_realtime add table public.matches;
  end if;
end $$;
