export class RegistrationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// Indian mobile numbers: accept national, trunk-prefix and +91 forms, never truncate.
export function normalisePhone(value: string | null, required = true): string | null {
  if (!value?.trim()) {
    if (!required) return null;
    throw new RegistrationError("Enter your 10-digit Indian mobile number");
  }
  if (!/^\+?[\d\s().-]+$/.test(value.trim())) throw new RegistrationError("Enter a valid Indian mobile number");
  let digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) throw new RegistrationError("Enter a valid 10-digit Indian mobile number");
  return `+91${digits}`;
}

export async function readRegistration(req: Request) {
  const limit = 2 * 1024 * 1024 + 32 * 1024;
  if (Number(req.headers.get("content-length")) > limit) throw new RegistrationError("Submission is too large", 413);
  const reader = req.body?.getReader();
  if (!reader) throw new RegistrationError("Empty submission");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new RegistrationError("Submission is too large", 413);
    }
    chunks.push(value);
  }
  const type = req.headers.get("content-type") ?? "";
  const body = new Response(new Blob(chunks), { headers: { "content-type": type } });
  const record: Record<string, unknown> = {};
  let photo: File | null = null;
  try {
    if (type.includes("multipart/form-data")) {
      for (const [key, value] of await body.formData()) {
        if (typeof value === "string") record[key] = value;
        else if (key === "photo" && value.size) photo = value;
      }
    } else if (type.includes("application/json")) {
      const json = await body.json();
      if (!json || Array.isArray(json) || typeof json !== "object") throw new Error();
      Object.assign(record, json);
    } else throw new RegistrationError("Use a form or JSON submission", 415);
  } catch (error) {
    if (error instanceof RegistrationError) throw error;
    throw new RegistrationError("The submission could not be read");
  }
  if (Object.keys(record).length > 40) throw new RegistrationError("Too many fields");
  for (const [key, value] of Object.entries(record)) {
    if (
      key.length > 160 ||
      !(
        typeof value === "string" ||
        typeof value === "number" ||
        value == null ||
        (Array.isArray(value) && value.every((v) => typeof v === "string"))
      )
    )
      throw new RegistrationError("Invalid form field");
    if (String(value ?? "").length > 2048) throw new RegistrationError("A form field is too long");
    if (/^age|yourage/.test(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) {
      const age = String(value ?? "").trim();
      if (age && (!/^\d{1,3}$/.test(age) || Number(age) < 5 || Number(age) > 100))
        throw new RegistrationError("Age must be a whole number between 5 and 100");
    }
  }
  return { record, photo, source: type.includes("multipart/form-data") ? "registration-link" : "google-form" };
}

export async function photoExtension(photo: File) {
  if (photo.size > 2 * 1024 * 1024) throw new RegistrationError("Photo must be under 2 MB");
  const b = new Uint8Array(await photo.slice(0, 16).arrayBuffer());
  if (photo.type === "image/jpeg" && b[0] === 255 && b[1] === 216 && b[2] === 255) return "jpg";
  if (photo.type === "image/png" && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => b[i] === n)) return "png";
  const text = new TextDecoder().decode(b);
  if (photo.type === "image/webp" && text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return "webp";
  throw new RegistrationError("Choose a JPEG, PNG or WebP photo");
}

export function validatePlayer<
  T extends {
    name: string;
    phone: string | null;
    age: number | null;
    role: string | null;
    city: string | null;
    batting_style: string | null;
    bowling_style: string | null;
    photo_url: string | null;
  },
>(player: T, phoneRequired = true): T {
  if (!player.name.trim() || player.name.length > 80) throw new RegistrationError("Name must contain 1–80 characters");
  if (player.age !== null && (!Number.isInteger(player.age) || player.age < 5 || player.age > 100))
    throw new RegistrationError("Age must be between 5 and 100");
  for (const value of [player.city, player.batting_style, player.bowling_style])
    if (value && value.length > 120) throw new RegistrationError("City and playing styles must be under 120 characters");
  if (player.role && !["Batsman", "Bowler", "All-rounder", "Wicket-keeper"].includes(player.role))
    throw new RegistrationError("Choose a supported player role");
  if (player.photo_url) {
    let url: URL;
    try {
      url = new URL(player.photo_url);
    } catch {
      throw new RegistrationError("Invalid photo URL");
    }
    if (url.protocol !== "https:" || url.username || url.password) throw new RegistrationError("Photo URL must use HTTPS");
  }
  return { ...player, phone: normalisePhone(player.phone, phoneRequired) };
}
