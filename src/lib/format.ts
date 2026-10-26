import type { Slab, Team, Tournament } from "./types";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export function rupees(n: number | null | undefined) {
  return inr.format(n ?? 0);
}

// Same rule as public.bid_step() in supabase/schema.sql
export function bidStep(slabs: Slab[], amount: number) {
  for (const s of slabs) {
    if (s.upto == null || amount < s.upto) return s.step;
  }
  return 500;
}

export function nextBid(t: Tournament, currentBid: number | null, basePrice: number) {
  return currentBid == null ? basePrice : currentBid + bidStep(t.increment_slabs, currentBid);
}

// Highest bid a team may place while keeping money to fill its minimum squad at base price
export function maxBid(t: Tournament, team: Team, squadCount: number) {
  const reserve = Math.max(t.min_squad - squadCount - 1, 0) * t.base_price;
  return Math.max(team.purse - team.spent - reserve, 0);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

// Google Drive share links (e.g. Google Form file uploads) -> direct image URL
export function imageUrl(url: string | null | undefined) {
  if (!url) return null;
  const m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/);
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w600` : url;
}

export function errorMessage(e: unknown) {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Something went wrong";
}
