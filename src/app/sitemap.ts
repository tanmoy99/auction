import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";
import { GUIDES } from "./guides/guide-shell";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/demo`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/guides`, changeFrequency: "monthly", priority: 0.7 },
    ...GUIDES.map((g) => ({ url: SITE_URL + g.href, changeFrequency: "monthly" as const, priority: 0.7 })),
    { url: `${SITE_URL}/signup`, changeFrequency: "yearly", priority: 0.6 },
    { url: `${SITE_URL}/login`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
