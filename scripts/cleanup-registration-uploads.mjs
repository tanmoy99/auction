// Operator maintenance, never run automatically against production by the test suite.
// Dry-run by default. Explicit --apply claims abandoned jobs before removing storage objects.
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
if (!process.argv.includes("--apply")) {
  const { data, error } = await db
    .from("registration_uploads")
    .select("path,state,created_at")
    .in("state", ["pending", "deleting"])
    .lt("created_at", new Date(Date.now() - 86400000).toISOString());
  if (error) throw error;
  console.log(JSON.stringify(data, null, 2));
} else {
  const { data, error } = await db.rpc("claim_abandoned_uploads");
  if (error) throw error;
  for (const { path } of data ?? []) {
    const { error } = await db.storage.from("photos").remove([path]);
    if (error) {
      console.error("Cleanup failed; retained for retry:", path);
      process.exitCode = 1;
      continue;
    }
    const { error: removeError } = await db.from("registration_uploads").delete().eq("path", path).eq("state", "deleting");
    if (removeError) throw removeError;
  }
}
