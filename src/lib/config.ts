export const APP_NAME = "CricMitra";
// The address Google should index and link previews should use (share links still use whichever address is open)
export const SITE_URL = "https://cricmitra.com";

// Both addresses forward to the team's Gmail through Cloudflare Email Routing
export const CONTACT = {
  email: "support@cricmitra.com",
  generalEmail: "hello@cricmitra.com",
  whatsapp: "+91 99325 90516",
  whatsappLink: "https://wa.me/919932590516",
  team: [
    { name: "Subhashis Biswas", role: "CEO" },
    { name: "Tanmoy Bhowmick", role: "CTO" },
  ],
};

// Team owners sign in with a short login ID; Supabase needs an email, so we add this domain internally.
// It keeps the old site name on purpose: existing owner logins were created with it.
export const OWNER_EMAIL_DOMAIN = "owners.cricauction.app";

export function loginToEmail(login: string) {
  const value = login.trim().toLowerCase();
  return value.includes("@") ? value : `${value}@${OWNER_EMAIL_DOMAIN}`;
}

// Players log in with their mobile number, which becomes the account email internally (they don't need an email)
export const PLAYER_EMAIL_DOMAIN = "players.cricauction.app";

// 10-digit Indian mobile, the same rule as public.mobile_key() in the database; null if it isn't one
export function mobileKey(value: string) {
  const d = value.replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(d)) return d;
  if (/^91[6-9]\d{9}$/.test(d)) return d.slice(2);
  if (/^0[6-9]\d{9}$/.test(d)) return d.slice(1);
  return null;
}

export function playerEmail(mobile: string) {
  return `${mobile}@${PLAYER_EMAIL_DOMAIN}`;
}
