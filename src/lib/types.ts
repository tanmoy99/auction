import type { FixtureSettings } from "./fixtures";

export type Slab = { upto: number | null; step: number };

export type Tournament = {
  id: string;
  organiser_id: string;
  name: string;
  venue: string | null;
  starts_on: string | null;
  team_budget: number;
  base_price: number;
  min_squad: number;
  max_squad: number;
  bid_timer_seconds: number;
  increment_slabs: Slab[];
  auto_close: boolean;
  auto_next: boolean;
  result_pause_seconds: number;
  registration_open: boolean;
  registration_token: string;
  status: "setup" | "live" | "completed";
  suspended: boolean;
  suspended_reason: string | null;
  fixture_settings: FixtureSettings | null;
  created_at: string;
};

export const AUCTION_STATUS: Record<Tournament["status"], string> = {
  setup: "Not started",
  live: "Running",
  completed: "Finished",
};

export type Team = {
  id: string;
  tournament_id: string;
  name: string;
  short_name: string | null;
  color: string;
  logo_url: string | null;
  owner_name: string | null;
  owner_user_id: string | null;
  owner_login: string | null;
  purse: number;
  spent: number;
  // may the owner add players themselves: owner asks once, organiser approves once
  player_access: "none" | "requested" | "approved";
  created_at: string;
};

export type PlayerStatus = "pending" | "available" | "sold" | "unsold";

export type Player = {
  id: string;
  tournament_id: string;
  name: string;
  role: string | null;
  batting_style: string | null;
  bowling_style: string | null;
  age: number | null;
  city: string | null;
  photo_url: string | null;
  category: string | null;
  base_price: number;
  status: PlayerStatus;
  team_id: string | null;
  sold_price: number | null;
  source: string;
  // set by the team owner (or organiser) for squad players; missing before migration 010
  is_captain?: boolean;
  is_vice_captain?: boolean;
  is_keeper?: boolean;
  created_at: string;
};

// Captain first, then vice-captain, then keeper
export function squadOrder(a: Pick<Player, "is_captain" | "is_vice_captain" | "is_keeper">, b: Pick<Player, "is_captain" | "is_vice_captain" | "is_keeper">) {
  const rank = (p: typeof a) => (p.is_captain ? 0 : p.is_vice_captain ? 1 : p.is_keeper ? 2 : 3);
  return rank(a) - rank(b);
}

export type AuctionState = {
  tournament_id: string;
  player_id: string | null;
  current_bid: number | null;
  leading_team_id: string | null;
  phase: "idle" | "bidding" | "sold" | "unsold";
  ends_at: string | null;
  next_player_id: string | null;
  updated_at: string;
};

export type Bid = {
  id: number;
  tournament_id: string;
  player_id: string;
  team_id: string;
  amount: number;
  created_at: string;
};

export const ROLES = ["Batsman", "Bowler", "All-rounder", "Wicket-keeper"] as const;
export const BATTING_STYLES = ["Right-hand bat", "Left-hand bat"];
export const BOWLING_STYLES = [
  "Right-arm fast",
  "Right-arm medium",
  "Right-arm off spin",
  "Right-arm leg spin",
  "Left-arm fast",
  "Left-arm medium",
  "Left-arm spin",
  "Does not bowl",
];

// What the signed-in user may do (from the my_access() function)
export type Access = {
  is_admin: boolean;
  active: boolean;
  suspended: boolean;
  suspended_reason: string | null;
  access_until: string | null;
};

export type AdminUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: "organiser" | "owner";
  is_admin: boolean;
  suspended: boolean;
  suspended_reason: string | null;
  access_until: string | null;
  admin_note: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  active: boolean;
  tournament_count: number;
  teams: { team: string; tournament_id: string }[];
};

export type AdminTournament = Pick<
  Tournament,
  "id" | "name" | "venue" | "starts_on" | "status" | "suspended" | "suspended_reason" | "created_at" | "organiser_id" | "team_budget"
> & {
  phase: AuctionState["phase"] | null;
  last_activity: string | null;
  active: boolean;
  team_count: number;
  player_count: number;
  pending_count: number;
  sold_count: number;
};
