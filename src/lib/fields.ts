import { ORGANISER_CATEGORIES, ROLES } from "./types";

export type ImportedPlayer = {
  name: string;
  phone: string | null;
  role: string | null;
  batting_style: string | null;
  bowling_style: string | null;
  age: number | null;
  city: string | null;
  photo_url: string | null;
  category: string | null;
  base_price: number | null;
};

type Field = keyof ImportedPlayer;

// Header keywords (lower-case, letters/digits only) -> field. First match wins, so specific ones go first.
const MATCHERS: [Field, RegExp][] = [
  ["base_price", /baseprice|price|amount/],
  ["batting_style", /batting|batstyle/],
  ["bowling_style", /bowling|bowlstyle/],
  ["photo_url", /photo|image|picture|pic|selfie/],
  ["phone", /phone|mobile|whatsapp|contact|number/],
  ["role", /role|speciality|specialty|skill|playingas|type/],
  ["category", /category|grade|tier|group|pool/],
  ["age", /^age|yourage/],
  ["city", /city|village|town|address|location|area|place|district/],
  ["name", /name/],
];

function fieldFor(header: string): Field | null {
  const key = header.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!key || /timestamp|email|father|team/.test(key)) return null;
  for (const [field, re] of MATCHERS) if (re.test(key)) return field;
  return null;
}

export function normaliseRole(value: string | null) {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v.includes("all")) return "All-rounder";
  if (v.includes("keep") || /\bwk\b/.test(v)) return "Wicket-keeper";
  if (v.includes("bowl")) return "Bowler";
  if (v.includes("bat")) return "Batsman";
  const exact = ROLES.find((r) => r.toLowerCase() === v.trim());
  return exact ?? value.trim();
}

// "U19", "under-19", "Ranji", "local", "Amature" ... -> the standard category name (ORGANISER_CATEGORIES).
// Categories are locked to that list: anything else becomes no category.
export function normaliseCategory(value: string | null) {
  const v = value?.trim();
  if (!v) return null;
  const exact = ORGANISER_CATEGORIES.find((c) => c.toLowerCase() === v.toLowerCase());
  return exact ?? categoryFromSpelling(v);
}

function categoryFromSpelling(value: string) {
  const key = value.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/players?$/, "");
  if (/^(u19|under19|undernineteen)$/.test(key)) return "Under 19 player";
  if (/^(ranji|ranjitrophy|state|statelevel|ranjistate|stateranji)$/.test(key)) return "Ranji / State player";
  if (/^local$/.test(key)) return "Local player";
  if (/^(outside|outsider|nonlocal|outstation)$/.test(key)) return "Outside player";
  if (/^(amateur|amature|ameture|amatuer|amatur)$/.test(key)) return "Amateur player";
  if (/^(professional|pro)$/.test(key)) return "Professional player";
  if (/^special$/.test(key)) return "Special player";
  return null;
}

function toInt(value: string | null) {
  if (!value) return null;
  const n = parseInt(value.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Which field each column header maps to (shown to the organiser before importing)
export function describeColumns(headers: string[]) {
  return headers.map((h) => ({ header: h, field: fieldFor(h) }));
}

// Turn one spreadsheet row / Google Form response into a player
export function mapRow(record: Record<string, unknown>): ImportedPlayer {
  const out: Record<Field, string | null> = {
    name: null, phone: null, role: null, batting_style: null, bowling_style: null,
    age: null, city: null, photo_url: null, category: null, base_price: null,
  };
  for (const [header, raw] of Object.entries(record)) {
    const field = fieldFor(header);
    const value = Array.isArray(raw) ? raw.join(", ").trim() : raw == null ? "" : String(raw).trim();
    if (field && value && !out[field]) out[field] = value;
  }
  return {
    name: out.name ?? "",
    phone: out.phone,
    role: normaliseRole(out.role),
    batting_style: out.batting_style,
    bowling_style: out.bowling_style,
    age: toInt(out.age),
    city: out.city,
    photo_url: out.photo_url,
    category: normaliseCategory(out.category),
    base_price: toInt(out.base_price),
  };
}

export const TEMPLATE_HEADERS = [
  "Name", "Phone", "Role", "Batting Style", "Bowling Style", "Age", "City / Village", "Photo URL", "Category", "Base Price",
];
