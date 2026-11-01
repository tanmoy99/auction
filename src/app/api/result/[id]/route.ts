import { supabaseAdmin } from "@/lib/supabase-admin";
import { resultCard } from "@/lib/result-card";
export async function GET(req: Request, ctx: RouteContext<"/api/result/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Invalid match" }, { status: 404 });
  const admin = supabaseAdmin();
  const { data: m, error } = await admin
    .from("matches")
    .select("id,tournament_id,team_a_id,team_b_id,status,result_text,a_runs,a_wickets,b_runs,b_wickets,match_type,innings")
    .eq("id", id)
    .maybeSingle();
  if (error) return Response.json({ error: "Result unavailable. Retry later" }, { status: 503 });
  if (!m || m.status !== "completed") return Response.json({ error: "A completed match is required" }, { status: 404 });
  const [t, teams, sponsors] = await Promise.all([
    admin.from("tournaments").select("name").eq("id", m.tournament_id).single(),
    admin.from("teams").select("id,name").eq("tournament_id", m.tournament_id),
    admin.from("sponsors").select("name,logo_url").eq("tournament_id", m.tournament_id).order("created_at"),
  ]);
  if (t.error || teams.error || sponsors.error) return Response.json({ error: "Result unavailable. Retry later" }, { status: 503 });
  const prefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/photos/${m.tournament_id}/`;
  const logos = (
    await Promise.all(
      sponsors.data.slice(0, 3).map(async (sponsor) => {
        if (!sponsor.logo_url?.startsWith(prefix)) return null;
        const filename = sponsor.logo_url.slice(prefix.length);
        if (!/^[a-z0-9-]+\.(jpg|png|webp)$/i.test(filename)) return null;
        const { data } = await admin.storage.from("photos").download(`${m.tournament_id}/${filename}`);
        if (!data || data.size > 2097152 || !["image/jpeg", "image/png", "image/webp"].includes(data.type)) return null;
        return `data:${data.type};base64,${Buffer.from(await data.arrayBuffer()).toString("base64")}`;
      }),
    )
  ).filter((logo): logo is string => !!logo);
  const names = [m.team_a_id, m.team_b_id].map((key) => teams.data?.find((team) => team.id === key)?.name ?? "Team").join(" v ");
  const player = new URL(req.url).searchParams.get("player");
  if (player) {
    if (!/^[0-9a-f-]{36}$/i.test(player)) return Response.json({ error: "Invalid player" }, { status: 400 });
    const { data: stats, error } = await admin
      .from("player_match_stats")
      .select("name,bat_runs,bat_balls,wickets,bowl_runs")
      .eq("match_id", id)
      .eq("match_player_id", player);
    if (error) return Response.json({ error: "Player result unavailable" }, { status: 503 });
    if (!stats?.length) return Response.json({ error: "No verified performance for this player" }, { status: 404 });
    const total = stats.reduce(
      (a, s) => ({
        runs: a.runs + s.bat_runs,
        balls: a.balls + s.bat_balls,
        wickets: a.wickets + s.wickets,
        conceded: a.conceded + s.bowl_runs,
      }),
      { runs: 0, balls: 0, wickets: 0, conceded: 0 },
    );
    return resultCard(
      t.data.name,
      stats[0].name,
      `${total.runs} runs · ${total.wickets} wickets`,
      `${names} · ${total.balls} balls faced · ${total.conceded} runs conceded`,
      sponsors.data.map((s) => s.name),
      logos,
    );
  }
  const detail =
    m.match_type === "test" && Array.isArray(m.innings)
      ? m.innings
          .map(
            (inn: { runs: number; wickets: number; declared?: boolean }, i: number) =>
              `Inn ${i + 1}: ${inn.runs}/${inn.wickets}${inn.declared ? "d" : ""}`,
          )
          .join(" · ")
      : `${m.a_runs ?? 0}/${m.a_wickets ?? 0} · ${m.b_runs ?? 0}/${m.b_wickets ?? 0}`;
  return resultCard(
    t.data.name,
    names,
    m.result_text ?? "Match completed",
    detail,
    sponsors.data.map((s) => s.name),
    logos,
  );
}
