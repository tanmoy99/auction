import { loginToEmail } from "@/lib/config";
import { supabaseAdmin, userFromRequest } from "@/lib/supabase-admin";

// Organiser creates (or resets) the login for a team owner
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return Response.json({ error: "Please log in again" }, { status: 401 });

  const { teamId, login, password } = (await req.json()) as { teamId?: string; login?: string; password?: string };
  const loginId = (login ?? "").trim().toLowerCase();
  if (!teamId || !/^[a-z0-9._-]{3,30}$/.test(loginId)) {
    return Response.json({ error: "Login ID must be 3-30 letters or numbers" }, { status: 400 });
  }
  if (!password || password.length < 6) {
    return Response.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: team } = await admin
    .from("teams")
    .select("id, name, owner_name, owner_user_id, tournaments!inner(organiser_id)")
    .eq("id", teamId)
    .maybeSingle<{ id: string; name: string; owner_name: string | null; owner_user_id: string | null; tournaments: { organiser_id: string } }>();
  if (!team || team.tournaments.organiser_id !== user.id) {
    return Response.json({ error: "Team not found" }, { status: 404 });
  }

  // login IDs are global (they become the account email), so check every tournament
  const { data: taken } = await admin.from("teams").select("id").eq("owner_login", loginId).neq("id", team.id).limit(1);
  if (taken?.length) return Response.json({ error: friendly("already taken") }, { status: 400 });

  const email = loginToEmail(loginId);
  let ownerId = team.owner_user_id;
  if (ownerId) {
    const { error } = await admin.auth.admin.updateUserById(ownerId, { email, password, email_confirm: true });
    if (error) return Response.json({ error: friendly(error.message) }, { status: 400 });
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role: "owner" },
      user_metadata: { full_name: team.owner_name ?? team.name },
    });
    if (error || !data.user) return Response.json({ error: friendly(error?.message) }, { status: 400 });
    ownerId = data.user.id;
  }

  await admin.from("profiles").upsert({ id: ownerId, role: "owner", full_name: team.owner_name ?? team.name });
  const { error } = await admin.from("teams").update({ owner_user_id: ownerId, owner_login: loginId }).eq("id", team.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ login: loginId });
}

function friendly(message = "Could not create login") {
  // Supabase answers a taken email on update with a generic "Error updating user"
  return /already|registered|exists|taken|error updating user/i.test(message) ? "This login ID is already taken, try another one" : message;
}
