import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { SITE_URL } from "@/lib/config";

// Only the main domain is indexed; the old vercel.app links keep working but stay out of Google (no duplicate results).
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host") ?? "";
  if (host !== new URL(SITE_URL).host) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // organiser, owner and scorer screens, private join/registration links and APIs
      disallow: ["/t/", "/bid/", "/match/*/overlay", "/owner", "/admin", "/dashboard", "/score/", "/join/", "/register/", "/api/", "/auth/", "/reset-password"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
