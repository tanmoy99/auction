import { mapRow } from "@/lib/fields";
import { supabaseAdmin } from "@/lib/supabase-admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Player self-registration. Called by our /register page (multipart form) and by the
// Google Form Apps Script (JSON of question title -> answer). New players wait as "pending".
export async function POST(req: Request, ctx: RouteContext<"/api/register/[token]">) {
  const { token } = await ctx.params;
  if (!UUID.test(token)) return Response.json({ error: "Invalid registration link" }, { status: 404 });

  const admin = supabaseAdmin();
  const { data: tournament } = await admin
    .from("tournaments")
    .select("id, base_price, registration_open, suspended")
    .eq("registration_token", token)
    .maybeSingle();
  if (!tournament) return Response.json({ error: "Invalid registration link" }, { status: 404 });
  if (!tournament.registration_open || tournament.suspended) return Response.json({ error: "Registration is closed" }, { status: 403 });

  const record: Record<string, unknown> = {};
  let photo: File | null = null;
  let source = "google-form";
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    source = "registration-link";
    for (const [key, value] of await req.formData()) {
      if (typeof value === "string") record[key] = value;
      else if (key === "photo" && value.size > 0) photo = value;
    }
  } else {
    Object.assign(record, await req.json().catch(() => ({})));
  }

  const player = mapRow(record);
  if (!player.name) return Response.json({ error: "Name is required" }, { status: 400 });

  // compare the last 10 digits so "+91 98765 43210" and "9876543210" match
  const lastTen = (phone: string | null) => (phone ?? "").replace(/\D/g, "").slice(-10);
  const phoneDigits = lastTen(player.phone);
  if (phoneDigits.length === 10) {
    const { data: contacts } = await admin.from("player_contacts").select("phone").eq("tournament_id", tournament.id);
    if (contacts?.some((c) => lastTen(c.phone) === phoneDigits)) {
      return Response.json({ ok: true, duplicate: true, message: "You are already registered" });
    }
  }

  let photoUrl = player.photo_url;
  if (photo) {
    if (photo.size > 2 * 1024 * 1024) return Response.json({ error: "Photo must be under 2 MB" }, { status: 400 });
    const path = `${tournament.id}/${crypto.randomUUID()}.jpg`;
    const { error } = await admin.storage.from("photos").upload(path, photo, { contentType: photo.type || "image/jpeg" });
    if (!error) photoUrl = admin.storage.from("photos").getPublicUrl(path).data.publicUrl;
  }

  const { data: created, error } = await admin
    .from("players")
    .insert({
      tournament_id: tournament.id,
      name: player.name.slice(0, 80),
      role: player.role,
      batting_style: player.batting_style,
      bowling_style: player.bowling_style,
      age: player.age,
      city: player.city,
      photo_url: photoUrl,
      category: null,
      base_price: tournament.base_price, // registrants can't set their own price
      status: "pending",
      source,
    })
    .select("id")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  if (player.phone) {
    await admin.from("player_contacts").insert({ player_id: created.id, tournament_id: tournament.id, phone: player.phone });
  }
  return Response.json({ ok: true, message: "Registration received" });
}
