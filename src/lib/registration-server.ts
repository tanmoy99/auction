import { createHash } from "node:crypto";
import { supabaseAdmin } from "./supabase-admin";
import { RegistrationError, photoExtension } from "./registration-validation";

export async function limitRegistration(req: Request, token: string) {
  const address = process.env.VERCEL ? (req.headers.get("x-vercel-forwarded-for") ?? "unknown") : "local";
  const addressKey = createHash("sha256").update(`address:${address}`).digest("hex");
  const overall = await supabaseAdmin().rpc("registration_allow", { p_key: addressKey, p_limit: 300 });
  if (overall.error) throw new RegistrationError("Registration is temporarily unavailable. Please retry later", 503);
  if (!overall.data) throw new RegistrationError("Too many submissions. Please wait a minute and retry", 429);
  const key = createHash("sha256").update(`${token}:${address}`).digest("hex");
  const { data, error } = await supabaseAdmin().rpc("registration_allow", { p_key: key, p_limit: 30 });
  if (error) throw new RegistrationError("Registration is temporarily unavailable. Please retry later", 503);
  if (!data) throw new RegistrationError("Too many submissions. Please wait a minute and retry", 429);
}

export async function uploadRegistrationPhoto(tournamentId: string, photo: File | null) {
  if (!photo) return null;
  const extension = await photoExtension(photo);
  const admin = supabaseAdmin();
  const path = `${tournamentId}/${crypto.randomUUID()}.${extension}`;
  const url = admin.storage.from("photos").getPublicUrl(path).data.publicUrl;
  const { error: ledgerError } = await admin.from("registration_uploads").insert({ path, url });
  if (ledgerError) throw new RegistrationError("Photo upload is temporarily unavailable. Please retry", 503);
  const { error } = await admin.storage.from("photos").upload(path, photo, { contentType: photo.type });
  if (error) throw new RegistrationError("Photo upload failed. Please retry your submission", 503);
  return { path, url };
}

export async function removeRegistrationPhoto(path: string | undefined) {
  if (!path) return;
  const { error } = await supabaseAdmin().storage.from("photos").remove([path]);
  if (error) console.error("Registration photo cleanup required", { path });
}

export function registrationFailure(error: unknown) {
  return Response.json(
    { error: error instanceof RegistrationError ? error.message : "Registration could not be completed. Please retry" },
    { status: error instanceof RegistrationError ? error.status : 503 },
  );
}
