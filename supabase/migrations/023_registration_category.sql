-- 023: players choose their category when they register (additive). Same as 011's register_player, plus
-- category: only the 4 standard categories are stored (any spelling/case is mapped to the standard name);
-- anything else, or nothing, is stored as no category, so older forms (e.g. Google Form) keep working.
-- No table is changed and no row is touched; only this function is replaced.
begin;

create or replace function public.register_player(p_token uuid, p_player jsonb, p_source text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.tournaments%rowtype; v_id uuid; mobile text; v_category text;
begin
  select * into t from public.tournaments where registration_token = p_token for share;
  if not found then raise exception 'Invalid registration link'; end if;
  if not t.registration_open or not public.tournament_active(t.id) then raise exception 'Registration is closed'; end if;
  mobile := public.mobile_key(p_player->>'phone');
  if mobile is null then raise exception 'Invalid Indian mobile number'; end if;
  if length(trim(coalesce(p_player->>'name',''))) not between 1 and 80 then raise exception 'Invalid player name'; end if;
  select c into v_category from unnest(array['Special player','Local player','Ranji player','Under 19 player']) c
   where lower(c) = lower(btrim(coalesce(p_player->>'category', '')));
  -- The unique contact index arbitrates concurrent requests. This block rolls BOTH inserts back.
  begin
    insert into public.players(tournament_id,name,role,batting_style,bowling_style,age,city,photo_url,category,base_price,status,source)
    values(t.id,trim(p_player->>'name'),p_player->>'role',p_player->>'batting_style',p_player->>'bowling_style',
      (p_player->>'age')::integer,p_player->>'city',p_player->>'photo_url',v_category,t.base_price,'pending',p_source)
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
