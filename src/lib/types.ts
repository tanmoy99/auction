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
  created_at: string;
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
  created_at: string;
};

export type AuctionState = {
  tournament_id: string;
  player_id: string | null;
  current_bid: number | null;
  leading_team_id: string | null;
  phase: "idle" | "bidding" | "sold" | "unsold";
  ends_at: string | null;
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
