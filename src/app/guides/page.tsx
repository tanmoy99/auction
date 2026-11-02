import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { GUIDES } from "./guide-shell";

export const metadata: Metadata = {
  title: "Cricket Tournament Guides: Organising, Auction, Fixtures & Scoring",
  description: "Free guides for running a local cricket tournament from start to finish: organising, player auction, fixtures and NRR, live scoring and stats. In English, Hindi and Bengali.",
  alternates: { canonical: "/guides" },
};

export default function Guides() {
  return (
    <>
      <AppHeader />
      <main className="flex-1">
        <section className="bg-slate-950 text-white">
          <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
            <p className="text-sm font-semibold uppercase tracking-widest text-emerald-300">Guides</p>
            <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">Everything to run a cricket tournament</h1>
            <p className="mt-4 text-lg text-slate-300">Registration, auction, fixtures, live scoring and stats: practical guides in English, हिन्दी and বাংলা.</p>
          </div>
        </section>
        <section className="mx-auto grid max-w-3xl gap-4 px-4 py-10">
          {GUIDES.map((g) => (
            <Link
              key={g.href}
              href={g.href}
              className="group flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-emerald-300 hover:shadow-md"
            >
              <span>
                <span className="block text-xs font-semibold uppercase tracking-wide text-emerald-600">{g.lang}</span>
                <span className="mt-1 block text-lg font-bold text-slate-900">{g.title}</span>
              </span>
              <ArrowRight className="size-5 shrink-0 text-slate-400 transition group-hover:translate-x-1 group-hover:text-emerald-600" />
            </Link>
          ))}
        </section>
      </main>
    </>
  );
}
