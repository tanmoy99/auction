import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Mail, MessageCircle } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { SiteFooter } from "@/components/site-footer";
import { APP_NAME, CONTACT, SITE_URL } from "@/lib/config";

export const metadata: Metadata = {
  title: "Contact Us",
  description: `Contact ${APP_NAME} on WhatsApp or email for help with your cricket tournament: registration, auction, fixtures, live scoring or setting up a new league.`,
  alternates: { canonical: "/contact" },
};

const whatsappHello = `${CONTACT.whatsappLink}?text=${encodeURIComponent(`Hi, I'd like to know more about ${APP_NAME} for my cricket tournament.`)}`;

const orgData = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: APP_NAME,
  url: SITE_URL,
  email: CONTACT.email,
  employee: CONTACT.team.map((m) => ({ "@type": "Person", name: m.name, jobTitle: m.role })),
  contactPoint: [{ "@type": "ContactPoint", contactType: "customer support", telephone: CONTACT.whatsapp.replace(/\s/g, ""), email: CONTACT.email, availableLanguage: ["English", "Hindi", "Bengali"] }],
};

export default function Contact() {
  return (
    <>
      <AppHeader />
      <main className="flex-1">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgData) }} />
        <section className="bg-slate-950 text-white">
          <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
            <p className="text-sm font-semibold uppercase tracking-widest text-emerald-300">Contact us</p>
            <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">We&apos;re here to help</h1>
            <p className="mt-4 text-lg text-slate-300">
              Setting up a new tournament, stuck on auction night or need help with scoring? Message us. WhatsApp is the quickest way to reach us.
            </p>
          </div>
        </section>

        <section className="mx-auto grid max-w-3xl gap-4 px-4 py-10 sm:grid-cols-2">
          <a
            href={whatsappHello}
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-2xl border border-emerald-200 bg-emerald-50 p-6 transition hover:border-emerald-400 hover:shadow-md"
          >
            <span className="inline-flex rounded-xl bg-emerald-600 p-2.5 text-white">
              <MessageCircle className="size-5" />
            </span>
            <h2 className="mt-4 font-bold text-slate-900">WhatsApp</h2>
            <p className="mt-1 text-lg font-semibold text-emerald-700">{CONTACT.whatsapp}</p>
            <p className="mt-2 inline-flex items-center gap-1 text-sm text-slate-600">
              Chat or call us <ArrowRight className="size-4 transition group-hover:translate-x-1" />
            </p>
          </a>
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <span className="inline-flex rounded-xl bg-slate-900 p-2.5 text-white">
              <Mail className="size-5" />
            </span>
            <h2 className="mt-4 font-bold text-slate-900">Email</h2>
            <a href={`mailto:${CONTACT.email}?subject=${encodeURIComponent(`${APP_NAME} support`)}`} className="mt-2 block group">
              <span className="block break-all text-lg font-semibold text-slate-800 group-hover:text-emerald-700">{CONTACT.email}</span>
              <span className="text-sm text-slate-500">Help with your tournament</span>
            </a>
            <a href={`mailto:${CONTACT.generalEmail}?subject=${encodeURIComponent(`${APP_NAME} enquiry`)}`} className="mt-3 block group">
              <span className="block break-all text-lg font-semibold text-slate-800 group-hover:text-emerald-700">{CONTACT.generalEmail}</span>
              <span className="text-sm text-slate-500">General and business enquiries</span>
            </a>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:col-span-2">
            <h2 className="font-bold text-slate-900">Our team</h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {CONTACT.team.map((m) => (
                <li key={m.name} className="flex items-center gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-700">
                    {m.name
                      .split(" ")
                      .map((w) => w[0])
                      .join("")}
                  </span>
                  <span>
                    <span className="block font-semibold text-slate-900">{m.name}</span>
                    <span className="text-sm text-slate-500">
                      {m.role}, {APP_NAME}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 pb-14">
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="font-bold text-slate-900">When you message us, please include</h2>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-slate-600">
              <li>Your tournament name and your role (organiser, team owner, scorer or player)</li>
              <li>What you were trying to do and what happened, with a screenshot if you can</li>
              <li>For a live match or auction, say so first so we can help you straight away</li>
            </ul>
            <p className="mt-4 text-sm text-slate-500">
              Players: for changes to your registration, photo or team, please contact your tournament organiser first. See also{" "}
              <Link href="/privacy" className="text-emerald-700 underline">
                privacy and support
              </Link>{" "}
              and our{" "}
              <Link href="/guides" className="text-emerald-700 underline">
                guides
              </Link>
              .
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
