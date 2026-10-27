import { accessOf, supabaseAdmin, userFromRequest } from "@/lib/supabase-admin";

// Site admin only: delete an account or set a new password
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return Response.json({ error: "Please log in again" }, { status: 401 });
  if (!(await accessOf(user.id)).isAdmin) return Response.json({ error: "Admins only" }, { status: 403 });

  const { action, userId, password } = (await req.json()) as { action?: string; userId?: string; password?: string };
  if (!userId) return Response.json({ error: "User missing" }, { status: 400 });
  if (userId === user.id) return Response.json({ error: "You can't do this to your own account" }, { status: 400 });
  const admin = supabaseAdmin();

  if (action === "password") {
    if (!password || password.length < 6) return Response.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true });
  }

  if (action === "delete") {
    // an organiser's tournaments are removed with the account; a team owner's team stays, without a login
    await admin.from("teams").update({ owner_user_id: null, owner_login: null }).eq("owner_user_id", userId);
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
