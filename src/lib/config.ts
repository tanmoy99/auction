export const APP_NAME = "CricAuction";

// Team owners sign in with a short login ID; Supabase needs an email, so we add this domain internally.
export const OWNER_EMAIL_DOMAIN = "owners.cricauction.app";

export function loginToEmail(login: string) {
  const value = login.trim().toLowerCase();
  return value.includes("@") ? value : `${value}@${OWNER_EMAIL_DOMAIN}`;
}
