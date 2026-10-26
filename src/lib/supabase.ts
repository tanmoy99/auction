import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anonKey);

// Browser client. Data access is protected by row level security in supabase/schema.sql.
export const supabase = createClient(url || "http://localhost:54321", anonKey || "not-configured", {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Bearer header for calling our own /api routes as the signed-in user
export async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
