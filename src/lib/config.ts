export const APP_NAME = "CricMitra";
// The address Google should index and link previews should use (share links still use whichever address is open)
export const SITE_URL = "https://cricmitra.com";

// Team owners sign in with a short login ID; Supabase needs an email, so we add this domain internally.
// It keeps the old site name on purpose: existing owner logins were created with it.
export const OWNER_EMAIL_DOMAIN = "owners.cricauction.app";

export function loginToEmail(login: string) {
  const value = login.trim().toLowerCase();
  return value.includes("@") ? value : `${value}@${OWNER_EMAIL_DOMAIN}`;
}
