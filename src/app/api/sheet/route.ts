import { userFromRequest } from "@/lib/supabase-admin";

// Fetches a shared Google Sheet as CSV (browsers can't, because of CORS)
export async function GET(req: Request) {
  if (!(await userFromRequest(req))) return new Response("Please log in again", { status: 401 });

  const link = new URL(req.url).searchParams.get("url") ?? "";
  const id = link.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/)?.[1];
  if (!id) return new Response("That doesn't look like a Google Sheets link", { status: 400 });
  const gid = link.match(/[#&?]gid=(\d+)/)?.[1];

  const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ""}`, {
    redirect: "follow",
  });
  const text = await res.text();
  if (!res.ok || text.trimStart().startsWith("<")) {
    return new Response("Could not open the sheet. Set sharing to 'Anyone with the link can view' and try again.", { status: 400 });
  }
  return new Response(text, { headers: { "Content-Type": "text/csv; charset=utf-8" } });
}
