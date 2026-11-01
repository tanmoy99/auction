begin;
create or replace function public.save_player_contact(p_tournament uuid,p_player uuid,p_data jsonb,p_phone text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not public.is_organiser(p_tournament) then raise exception 'Only the organiser can do this'; end if;
  if length(trim(coalesce(p_data->>'name',''))) not between 1 and 80 then raise exception 'Player name must contain 1–80 characters'; end if;
  if p_data->>'role' is not null and p_data->>'role' not in ('Batsman','Bowler','All-rounder','Wicket-keeper') then raise exception 'Unknown player role'; end if;
  if p_data->>'age' is not null and (p_data->>'age')::integer not between 5 and 100 then raise exception 'Age must be between 5 and 100'; end if;
  if greatest(length(p_data->>'city'),length(p_data->>'batting_style'),length(p_data->>'bowling_style')) > 120 then raise exception 'Player fields are too long'; end if;
  if p_player is null then
    insert into public.players(tournament_id,name,role,batting_style,bowling_style,age,city,photo_url,category,base_price,source)
    values(p_tournament,trim(p_data->>'name'),p_data->>'role',p_data->>'batting_style',p_data->>'bowling_style',
      (p_data->>'age')::integer,p_data->>'city',p_data->>'photo_url',p_data->>'category',(p_data->>'base_price')::integer,
      coalesce(p_data->>'source','manual')) returning id into v_id;
  else
    update public.players set name=trim(p_data->>'name'),role=p_data->>'role',batting_style=p_data->>'batting_style',
      bowling_style=p_data->>'bowling_style',age=(p_data->>'age')::integer,city=p_data->>'city',photo_url=p_data->>'photo_url',
      category=p_data->>'category',base_price=(p_data->>'base_price')::integer
    where id=p_player and tournament_id=p_tournament returning id into v_id;
    if not found then raise exception 'Player not found'; end if;
  end if;
  insert into public.player_contacts(player_id,tournament_id,phone) values(v_id,p_tournament,p_phone)
    on conflict(player_id) do update set phone=excluded.phone;
  return v_id;
end $$;
create or replace function public.import_players(p_tournament uuid,p_players jsonb) returns integer
language plpgsql security definer set search_path=public as $$
declare p jsonb; n integer:=0;
begin
  if not public.is_organiser(p_tournament) then raise exception 'Only the organiser can import'; end if;
  if jsonb_typeof(p_players)<>'array' or jsonb_array_length(p_players)>2000 then raise exception 'Import up to 2000 players at a time'; end if;
  for p in select * from jsonb_array_elements(p_players) loop
    perform public.save_player_contact(p_tournament,null,p,p->>'phone'); n:=n+1;
  end loop;
  return n;
end $$;
create or replace function public.reserve_photo(p_path text,p_url text) returns void
language plpgsql security definer set search_path=public as $$
begin
  if not public.photo_path_allowed(p_path) or p_url not like 'https://%/storage/v1/object/public/photos/' || p_path then
    raise exception 'Invalid tournament photo path';
  end if;
  insert into public.registration_uploads(path,url) values(p_path,p_url);
end $$;
create or replace function public.reference_registration_upload() returns trigger
language plpgsql security definer set search_path=public as $$
declare current_state text; photo text := coalesce(to_jsonb(new)->>'photo_url',to_jsonb(new)->>'logo_url');
begin
  select state into current_state from public.registration_uploads where url=photo for update;
  if found then
    if current_state='deleting' then raise exception 'Photo expired. Upload it again'; end if;
    update public.registration_uploads set state='referenced' where url=photo;
  end if;
  return new;
end $$;
drop trigger if exists reference_sponsor_upload on public.sponsors;
create trigger reference_sponsor_upload before insert or update of logo_url on public.sponsors
  for each row execute function public.reference_registration_upload();
drop trigger if exists reference_team_upload on public.teams;
create trigger reference_team_upload before insert or update of logo_url on public.teams
  for each row execute function public.reference_registration_upload();
revoke all on function public.save_player_contact(uuid,uuid,jsonb,text),public.import_players(uuid,jsonb),public.reserve_photo(text,text) from public,anon;
grant execute on function public.save_player_contact(uuid,uuid,jsonb,text),public.import_players(uuid,jsonb),public.reserve_photo(text,text) to authenticated;
create or replace function public.scorer_readiness(p_tournament uuid) returns integer
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_organiser(p_tournament) then raise exception 'Only the organiser can do this'; end if;
  return (select count(*)::integer from public.matches m where m.tournament_id=p_tournament
    and m.status<>'completed' and m.team_a_id is not null and m.team_b_id is not null
    and not exists(select 1 from public.match_scorers sc where sc.match_id=m.id));
end $$;
revoke all on function public.scorer_readiness(uuid) from public,anon;
grant execute on function public.scorer_readiness(uuid) to authenticated;
commit;
