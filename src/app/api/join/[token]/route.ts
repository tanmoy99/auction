import { mapRow } from "@/lib/fields";
import { accessOf, supabaseAdmin, userFromRequest } from "@/lib/supabase-admin";

import { readRegistration, validatePlayer, RegistrationError } from "@/lib/registration-validation";
import { limitRegistration, uploadRegistrationPhoto, removeRegistrationPhoto, registrationFailure } from "@/lib/registration-server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Link = { team_id: string; tournament_id: string; teams: { owner_user_id: string | null } };

// Team join link: the player (or the team owner, signed in) fills the form and goes straight into the squad.
// Only works while the organiser has allowed this team to add players.
export async function POST(req: Request, ctx: RouteContext<"/api/join/[token]">) {
  try {
  const { token } = await ctx.params;
  if (!UUID.test(token)) return Response.json({ error: "Invalid team link" }, { status: 404 });

  await limitRegistration(req, token);
  const admin = supabaseAdmin();
  const { data: link } = await admin
    .from("team_links")
    .select("team_id, tournament_id, teams!inner(owner_user_id)")
    .eq("token", token)
    .maybeSingle<Link>();
  if (!link) return Response.json({ error: "Invalid team link" }, { status: 404 });
  const { data: info } = await admin.rpc("team_link_info", { p_token: token });
  if (!info?.open) return Response.json({ error: "Adding players to this team is closed" }, { status: 403 });
  if (info.full) return Response.json({ error: "This team's squad is full" }, { status: 400 });

  const { record, photo } = await readRegistration(req);
  const mapped = mapRow(record);
  const user = req.headers.has("authorization") ? await userFromRequest(req) : null;
  if (user && !(await accessOf(user.id)).active) throw new RegistrationError("Your login is paused. Contact the organiser", 403);
  const source = user && user.id === link.teams.owner_user_id ? "team-owner" : "team-link";
  const player = validatePlayer(mapped, source !== "team-owner");
  const uploaded = await uploadRegistrationPhoto(link.tournament_id, photo);
  const { data: id, error } = await admin.rpc("add_team_player", {
    p_token: token,
    p_player: { ...player, photo_url: uploaded?.url ?? player.photo_url },
    p_phone: player.phone,
    p_source: source,
  });
  if (error) {
    if (/^[0-9A-Z]{5}$/.test(error.code ?? "")) await removeRegistrationPhoto(uploaded?.path);
    if (error.code === "23505" || /already registered/.test(error.message)) throw new RegistrationError("This phone is already registered in this tournament", 409);
    if (/Squad is full/.test(error.message)) throw new RegistrationError("This team's squad is full", 409);
    if (/closed|paused/.test(error.message)) throw new RegistrationError("Adding players is currently closed", 403);
    throw new RegistrationError("Registration could not be confirmed. Please retry", 503);
  }
  if (!id) throw new RegistrationError("Registration could not be confirmed. Please retry", 503);
  return Response.json({ ok: true, id, team: info.team, message: `Added to ${info.team}` });
  } catch (error) { return registrationFailure(error); }
}
