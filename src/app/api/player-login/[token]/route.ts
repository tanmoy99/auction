import { mobileKey, playerEmail } from "@/lib/config";
import { RegistrationError } from "@/lib/registration-validation";
import { limitRegistration, registrationFailure } from "@/lib/registration-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Invite = {
  player_id: string;
  expires_at: string;
  used_at: string | null;
  players: { name: string; status: string; tournament_id: string; tournaments: { name: string } };
};

// A valid, unused link for an approved player who has a mobile number, or a RegistrationError
async function readInvite(token: string) {
  if (!UUID.test(token)) throw new RegistrationError("This login link is not valid", 404);
  const admin = supabaseAdmin();
  const { data: invite, error } = await admin
    .from("player_invites")
    .select("player_id, expires_at, used_at, players!inner(name, status, tournament_id, tournaments!inner(name))")
    .eq("token", token)
    .maybeSingle<Invite>();
  if (error) throw new RegistrationError("Please retry in a moment", 503);
  if (!invite) throw new RegistrationError("This login link is not valid", 404);
  if (invite.used_at) throw new RegistrationError("This link has already been used. Log in with your mobile number, or ask the organiser for a new link", 410);
  if (new Date(invite.expires_at) < new Date()) throw new RegistrationError("This link has expired. Ask the organiser for a new one", 410);
  if (invite.players.status === "pending") throw new RegistrationError("This player is not approved yet", 403);
  const { data: active } = await admin.rpc("tournament_active", { p_tournament: invite.players.tournament_id });
  if (!active) throw new RegistrationError("This tournament is paused", 403);
  const { data: contact } = await admin.from("player_contacts").select("phone").eq("player_id", invite.player_id).maybeSingle<{ phone: string | null }>();
  const mobile = mobileKey(contact?.phone ?? "");
  if (!mobile) throw new RegistrationError("The organiser hasn't saved a mobile number for this player", 400);
  const { data: account } = await admin.from("player_accounts").select("user_id, first_name").eq("mobile", mobile).maybeSingle<{ user_id: string; first_name: string }>();
  const firstName = invite.players.name.trim().split(/\s+/)[0]!.toLowerCase();
  return { invite, mobile, account, firstName };
}

// Shown on the set-password page: whose login this is (the number is only partly shown)
export async function GET(_req: Request, ctx: RouteContext<"/api/player-login/[token]">) {
  try {
    const { token } = await ctx.params;
    const { invite, mobile, account, firstName } = await readInvite(token);
    if (account && account.first_name !== firstName) throw new RegistrationError("This mobile number already has a player login under another name. Ask the organiser", 409);
    return Response.json({ name: invite.players.name, tournament: invite.players.tournaments.name, mobile: `•••••${mobile.slice(-5)}`, existing: !!account });
  } catch (error) {
    return registrationFailure(error);
  }
}

// Sets the password: creates the player's login, or resets it if this mobile already has one
export async function POST(req: Request, ctx: RouteContext<"/api/player-login/[token]">) {
  try {
    const { token } = await ctx.params;
    await limitRegistration(req, token);
    const { password } = (await req.json().catch(() => ({}))) as { password?: string };
    if (!password || password.length < 6) throw new RegistrationError("Password must be at least 6 characters", 400);
    const { invite, mobile, account, firstName } = await readInvite(token);
    if (account && account.first_name !== firstName) throw new RegistrationError("This mobile number already has a player login under another name. Ask the organiser", 409);

    const admin = supabaseAdmin();
    // claim the link first so it can only ever be used once
    const { data: claimed } = await admin.from("player_invites").update({ used_at: new Date().toISOString() }).eq("token", token).is("used_at", null).select("token");
    if (!claimed?.length) throw new RegistrationError("This link has already been used. Log in with your mobile number", 410);

    // if saving fails, give the link back so the player can try again
    const release = () => admin.from("player_invites").update({ used_at: null }).eq("token", token);
    if (account) {
      const { error } = await admin.auth.admin.updateUserById(account.user_id, { password });
      if (error) {
        await release();
        throw new RegistrationError("Couldn't save the password. Please try again", 503);
      }
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email: playerEmail(mobile),
        password,
        email_confirm: true,
        app_metadata: { role: "player" },
        user_metadata: { full_name: invite.players.name },
      });
      if (error || !data.user) {
        await release();
        throw new RegistrationError("Couldn't create the login. Please try again", 503);
      }
      const { error: linkError } = await admin.from("player_accounts").insert({ user_id: data.user.id, mobile, first_name: firstName });
      if (linkError) {
        await admin.auth.admin.deleteUser(data.user.id);
        await release();
        throw new RegistrationError("Couldn't create the login. Please try again", 503);
      }
      await admin.from("profiles").upsert({ id: data.user.id, role: "player", full_name: invite.players.name });
    }
    return Response.json({ ok: true, mobile });
  } catch (error) {
    return registrationFailure(error);
  }
}
