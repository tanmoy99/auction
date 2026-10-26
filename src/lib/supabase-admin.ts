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
