import Link from "next/link";
import { Mail, MessageCircle } from "lucide-react";
import { APP_NAME, CONTACT } from "@/lib/config";
import { Logo } from "./app-header";

const columns: { title: string; links: [string, string][] }[] = [
  {
    title: "Product",
    links: [
      ["Live demo", "/demo"],
      ["Create a tournament", "/signup"],
      ["Organiser login", "/login"],
      ["Team owner login", "/login"],
    ],
  },
  {
    title: "Guides",
    links: [
      ["Organise a tournament", "/guides/how-to-organise-cricket-tournament"],
      ["Run a player auction", "/guides/how-to-run-cricket-player-auction"],
      ["Auction rules & calculator", "/guides/cricket-auction-rules"],
      ["Fixtures, points & NRR", "/guides/cricket-tournament-fixtures"],
      ["Live scoring", "/guides/live-cricket-scoring"],
    ],
  },
  {
    title: "Company",
    links: [
      ["Contact us", "/contact"],
      ["All guides", "/guides"],
      ["Privacy and support", "/privacy"],
    ],
  },
];

const features = ["Registration", "Auction", "Fixtures", "Live scoring", "Stats"];

// Public-page footer (landing, guides, contact)
export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden bg-slate-950 text-slate-400">
      <div className="pointer-events-none absolute -top-32 left-1/2 h-64 w-[40rem] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="relative mx-auto max-w-6xl px-4 pt-14 pb-8">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-[1.4fr_1fr_1.2fr_1fr]">
          <div className="col-span-2 lg:col-span-1">
            <Logo dark />
            <p className="mt-4 max-w-xs text-sm leading-relaxed">
              The all-in-one app for local cricket tournaments in India, from registration to lifting the trophy.
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {features.map((f) => (
                <span key={f} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-slate-300">
                  {f}
                </span>
              ))}
            </div>
            <div className="mt-6 flex flex-col gap-2 text-sm">
              <a
                href={CONTACT.whatsappLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 font-semibold text-slate-950 transition hover:bg-emerald-400"
              >
                <MessageCircle className="size-4" /> WhatsApp {CONTACT.whatsapp}
              </a>
              <a href={`mailto:${CONTACT.email}`} className="inline-flex w-fit items-center gap-2 py-1 transition hover:text-white">
                <Mail className="size-4" /> {CONTACT.email}
              </a>
            </div>
          </div>
          {columns.map((c) => (
            <nav key={c.title} aria-label={c.title}>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-white">{c.title}</h2>
              <ul className="mt-4 space-y-2.5 text-sm">
                {c.links.map(([label, href]) => (
                  <li key={label}>
                    <Link href={href} className="transition hover:text-emerald-300">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
              {c.title === "Guides" && (
                <p className="mt-4 flex gap-3 text-sm">
                  <Link href="/guides/hi/cricket-auction-kaise-kare" lang="hi" className="transition hover:text-emerald-300">
                    हिन्दी
                  </Link>
                  <span className="text-slate-700">·</span>
                  <Link href="/guides/bn/cricket-auction-kivabe-korben" lang="bn" className="transition hover:text-emerald-300">
                    বাংলা
                  </Link>
                </p>
              )}
            </nav>
          ))}
        </div>
        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-6 text-xs sm:flex-row">
          <p>
            © 2026 {APP_NAME}. All rights reserved.
          </p>
          <p>
            Made for local cricket in India <span aria-hidden="true">🏏</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
