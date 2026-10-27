import { createClient } from "@supabase/supabase-js";

// Service-role client: bypasses row level security. Only import this inside /api routes.
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars are missing (see .env.example)");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function userFromRequest(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await supabaseAdmin().auth.getUser(token);
  return data.user ?? null;
}

// Same rule as account_active() in the database: admins always, others unless paused or past their access date
export async function accessOf(userId: string) {
  const { data } = await supabaseAdmin()
    .from("profiles")
    .select("is_admin, suspended, access_until")
    .eq("id", userId)
    .maybeSingle<{ is_admin: boolean; suspended: boolean; access_until: string | null }>();
  const today = new Date().toISOString().slice(0, 10);
  const isAdmin = !!data?.is_admin;
  return { isAdmin, active: isAdmin || (!!data && !data.suspended && (!data.access_until || data.access_until >= today)) };
}
