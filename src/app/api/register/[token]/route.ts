import { mapRow } from "@/lib/fields";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { readRegistration, validatePlayer, RegistrationError } from "@/lib/registration-validation";
import { limitRegistration, uploadRegistrationPhoto, removeRegistrationPhoto, registrationFailure } from "@/lib/registration-server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request, ctx: RouteContext<"/api/register/[token]">) {
  try {
    const { token } = await ctx.params;
    if (!UUID.test(token)) throw new RegistrationError("Invalid registration link", 404);
    await limitRegistration(req, token);
    const admin = supabaseAdmin();
    const { data: tournament, error: lookupError } = await admin.from("tournaments")
      .select("id, registration_open, suspended").eq("registration_token", token).maybeSingle();
    if (lookupError) throw new RegistrationError("Registration is temporarily unavailable", 503);
    if (!tournament) throw new RegistrationError("Invalid registration link", 404);
    if (!tournament.registration_open || tournament.suspended) throw new RegistrationError("Registration is closed", 403);
    const { record, photo, source } = await readRegistration(req);
    const player = validatePlayer(mapRow(record));
    const uploaded = await uploadRegistrationPhoto(tournament.id, photo);
    const { data, error } = await admin.rpc("register_player", {
      p_token: token, p_player: { ...player, photo_url: uploaded?.url ?? player.photo_url }, p_source: source,
    });
    if (error) {
      // Transport errors may have committed. Do not remove a potentially referenced photo.
      if (/^[0-9A-Z]{5}$/.test(error.code ?? "")) await removeRegistrationPhoto(uploaded?.path);
      if (/Registration is closed/.test(error.message)) throw new RegistrationError("Registration is closed", 403);
      throw new RegistrationError("Registration could not be confirmed. Retry with the same phone number", 503);
    }
    if (!data || typeof data.duplicate !== "boolean" || (!data.duplicate && !data.id)) {
      throw new RegistrationError("Registration could not be confirmed. Retry with the same phone number", 503);
    }
    if (data.duplicate) await removeRegistrationPhoto(uploaded?.path);
    return Response.json({ ok: true, duplicate: !!data?.duplicate, message: data?.duplicate ? "You are already registered" : "Registration received" });
  } catch (error) { return registrationFailure(error); }
}
