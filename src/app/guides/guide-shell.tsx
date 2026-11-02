import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { APP_NAME } from "@/lib/config";

export type Faq = { q: string; a: string };

export const GUIDES = [
  { href: "/guides/how-to-run-cricket-player-auction", title: "How to run a cricket player auction", lang: "English" },
  { href: "/guides/cricket-auction-rules", title: "Cricket auction rules & purse calculator", lang: "English" },
  { href: "/guides/hi/cricket-auction-kaise-kare", title: "क्रिकेट प्लेयर ऑक्शन कैसे करें", lang: "हिन्दी" },
  { href: "/guides/bn/cricket-auction-kivabe-korben", title: "ক্রিকেট প্লেয়ার নিলাম কীভাবে করবেন", lang: "বাংলা" },
];

// Shared layout for the public guide pages: readable article column, FAQ (also given to Google as structured data) and a sign-up prompt
export function GuideShell({
  lang = "en",
  eyebrow,
  title,
  intro,
  faqs = [],
  faqTitle = "Frequently asked questions",
  cta = { title: `Run your next auction on ${APP_NAME}`, text: "Free to start. Set up players, teams and owner logins tonight.", button: "Create your tournament" },
  children,
}: {
  lang?: string;
  eyebrow: string;
  title: string;
  intro: string;
  faqs?: Faq[];
  faqTitle?: string;
  cta?: { title: string; text: string; button: string };
  children: React.ReactNode;
}) {
  const faqData = faqs.length
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      }
    : null;
  return (
    <>
      <AppHeader />
      <main lang={lang} className="flex-1 bg-white">
        {faqData && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqData) }} />}
        <header className="border-b border-slate-200 bg-slate-950 text-white">
          <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
            <Link href="/guides" className="text-sm font-semibold uppercase tracking-widest text-emerald-300 hover:text-emerald-200">
              {eyebrow}
            </Link>
            <h1 className="mt-3 text-3xl font-black leading-tight tracking-tight sm:text-5xl">{title}</h1>
            <p className="mt-4 text-lg text-slate-300">{intro}</p>
          </div>
        </header>
        <article className="guide mx-auto max-w-3xl px-4 py-10">{children}</article>
        {faqs.length > 0 && (
          <section className="mx-auto max-w-3xl px-4 pb-6">
            <h2 className="text-2xl font-black text-slate-900">{faqTitle}</h2>
            <div className="mt-4 divide-y divide-slate-200 rounded-2xl border border-slate-200">
              {faqs.map((f) => (
                <details key={f.q} className="group p-4">
                  <summary className="cursor-pointer list-none font-semibold text-slate-900 marker:hidden">
                    <span className="mr-2 inline-block text-emerald-600 transition group-open:rotate-90">›</span>
                    {f.q}
                  </summary>
                  <p className="mt-2 pl-5 text-slate-600">{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}
        <section className="mx-auto max-w-3xl px-4 py-10">
          <div className="rounded-3xl bg-linear-to-br from-emerald-600 to-lime-500 p-8 text-center text-white">
            <h2 className="text-2xl font-black">{cta.title}</h2>
            <p className="mt-2 text-emerald-50">{cta.text}</p>
            <Link
              href="/signup"
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-6 py-3 font-semibold text-white transition hover:bg-slate-800"
            >
              {cta.button} <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>
        <nav className="mx-auto max-w-3xl px-4 pb-14" lang="en">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-500">More guides</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {GUIDES.map((g) => (
              <li key={g.href}>
                <Link href={g.href} className="block rounded-xl border border-slate-200 p-3 text-slate-800 transition hover:border-emerald-300 hover:bg-emerald-50">
                  <span className="block text-xs text-slate-500">{g.lang}</span>
                  {g.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
    </>
  );
}

export function Steps({ items }: { items: { title: string; text: React.ReactNode }[] }) {
  return (
    <ol className="not-prose my-6 space-y-4">
      {items.map((s, i) => (
        <li key={s.title} className="flex gap-4 rounded-2xl border border-slate-200 p-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 font-bold text-white">{i + 1}</span>
          <div>
            <h3 className="font-bold text-slate-900">{s.title}</h3>
            <div className="mt-1 text-slate-600">{s.text}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
