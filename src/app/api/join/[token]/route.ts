import { mapRow } from "@/lib/fields";
import { supabaseAdmin, userFromRequest } from "@/lib/supabase-admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Link = { team_id: string; tournament_id: string; teams: { owner_user_id: string | null } };

// Team join link: the player (or the team owner, signed in) fills the form and goes straight into the squad.
// Only works while the organiser has allowed this team to add players.
export async function POST(req: Request, ctx: RouteContext<"/api/join/[token]">) {
  const { token } = await ctx.params;
  if (!UUID.test(token)) return Response.json({ error: "Invalid team link" }, { status: 404 });

  const admin = supabaseAdmin();
  const { data: link } = await admin
    .from("team_links")
    .select("team_id, tournament_id, teams!inner(owner_user_id)")
    .eq("token", token)
    .maybeSingle<Link>();
  if (!link) return Response.json({ error: "Invalid team link" }, { status: 404 });
  const { data: info } = await admin.rpc("team_link_info", { p_token: token });
  if (!info?.open) return Response.json({ error: "Adding players to this team is closed" }, { status: 403 });
  if (info.full) return Response.json({ error: "This team's squad is full" }, { status: 400 });

  const record: Record<string, unknown> = {};
  let photo: File | null = null;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    for (const [key, value] of await req.formData()) {
      if (typeof value === "string") record[key] = value;
      else if (key === "photo" && value.size > 0) photo = value;
    }
  } else {
    Object.assign(record, await req.json().catch(() => ({})));
  }

  const player = mapRow(record);
  if (!player.name) return Response.json({ error: "Name is required" }, { status: 400 });

  const user = req.headers.has("authorization") ? await userFromRequest(req) : null;
  const source = user && user.id === link.teams.owner_user_id ? "team-owner" : "team-link";
  // the owner may skip the phone number, players joining by link must give one
  if (source === "team-link" && (player.phone ?? "").replace(/\D/g, "").length < 10) {
    return Response.json({ error: "Please enter a valid 10-digit mobile number" }, { status: 400 });
  }

  let photoUrl = player.photo_url;
  let photoPath: string | null = null;
  if (photo) {
    if (photo.size > 2 * 1024 * 1024) return Response.json({ error: "Photo must be under 2 MB" }, { status: 400 });
    photoPath = `${link.tournament_id}/${crypto.randomUUID()}.jpg`;
    const { error } = await admin.storage.from("photos").upload(photoPath, photo, { contentType: photo.type || "image/jpeg" });
    if (error) photoPath = null;
    else photoUrl = admin.storage.from("photos").getPublicUrl(photoPath).data.publicUrl;
  }

  const { data: id, error } = await admin.rpc("add_team_player", {
    p_token: token,
    p_player: { ...player, photo_url: photoUrl },
    p_phone: player.phone,
    p_source: source,
  });
  if (error) {
    if (photoPath) await admin.storage.from("photos").remove([photoPath]);
    return Response.json({ error: error.message }, { status: 400 });
  }
  return Response.json({ ok: true, id, team: info.team, message: `Added to ${info.team}` });
}
