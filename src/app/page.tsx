import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  ClipboardList,
  FileSpreadsheet,
  Gavel,
  KeyRound,
  MonitorPlay,
  Radio,
  ShieldCheck,
  Smartphone,
  Timer,
  Trophy,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { AuctionDemo, CountUp, GavelBadge, Reveal, ScoringDemo, TableDemo } from "@/components/landing";
import { APP_NAME } from "@/lib/config";

const journey = [
  { icon: ClipboardList, title: "Register", text: "Players sign up from a WhatsApp link or your Google Form", color: "from-sky-500 to-cyan-400" },
  { icon: Gavel, title: "Auction", text: "Owners bid live from their phones, the purse is checked on every bid", color: "from-emerald-500 to-lime-400" },
  { icon: CalendarDays, title: "Fixtures", text: "League, groups or knockout, with dates filled in automatically", color: "from-amber-500 to-yellow-300" },
  { icon: Radio, title: "Live score", text: "Ball-by-ball scoring with one tap, live on every screen", color: "from-rose-500 to-orange-400" },
  { icon: Trophy, title: "Stats", text: "Orange cap, purple cap, points table and the champion", color: "from-violet-500 to-fuchsia-400" },
];

const marquee = [
  "₹500 starting bids",
  "Excel & Google Form import",
  "Owner logins",
  "Live bidding",
  "Auto timer",
  "SOLD stamp",
  "Big screen",
  "IPL-style playoffs",
  "Points table & NRR",
  "Ball-by-ball scoring",
  "Scorer PIN links",
  "Guest player approval",
  "Free hit",
  "Live scorecard",
  "Tournament stats",
  "Squads to Excel",
];

const features = [
  { icon: FileSpreadsheet, title: "Players in seconds", text: "Excel / CSV import, Google Sheet link, Google Form or a mobile registration link with photo upload." },
  { icon: Users, title: "Teams & owner logins", text: "Give every owner a login and a purse. Squad limits and minimum squad money are enforced." },
  { icon: Smartphone, title: "Bid from any phone", text: "One big button, jump bids, buzz when outbid. Two taps at the same moment? Only one wins." },
  { icon: Timer, title: "Automatic auction", text: "Timer ends → SOLD or UNSOLD → next player comes up on its own. Or run it all by hand." },
  { icon: MonitorPlay, title: "Big screen", text: "Projector-ready views for the auction and the match, with a giant SOLD stamp and the live score." },
  { icon: CalendarDays, title: "Every fixture format", text: "Single or double league, groups, knockout with byes, finals, semis, quarters or IPL-style playoffs." },
  { icon: Radio, title: "One-tap scoring", text: "Wides, no-balls, byes, wickets, free hit, undo. Strike and overs are handled for you." },
  { icon: KeyRound, title: "Scorer PIN links", text: "Send a volunteer a PIN on WhatsApp. No account needed, and only one phone scores at a time." },
  { icon: UserPlus, title: "Guest players", text: "Scorers request guests on match day. They only play once the organiser approves them." },
  { icon: BarChart3, title: "Tournament stats", text: "Leaderboards for runs, wickets, sixes, strike rate and economy, plus full batting and bowling tables." },
  { icon: Wallet, title: "Made for local cricket", text: "Rupee budgets, bids from ₹500, your own wide and no-ball rules, IST times." },
  { icon: ShieldCheck, title: "Fair and safe", text: "Rules are checked by the database, so nobody can overspend, bid twice or edit someone else's tournament." },
];

export default function Home() {
  return (
    <>
      <AppHeader />
      <main className="flex-1 overflow-x-hidden">
        {/* Hero */}
        <section className="relative overflow-hidden bg-slate-950 text-white">
          <div className="pointer-events-none absolute -top-40 -left-40 size-[36rem] rounded-full bg-emerald-500/25 blur-3xl animate-glow" />
          <div className="pointer-events-none absolute -right-40 top-20 size-[30rem] rounded-full bg-amber-400/15 blur-3xl animate-glow [animation-delay:2s]" />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.07]"
            style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "48px 48px" }}
          />
          <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 py-16 sm:py-24 lg:grid-cols-[1.1fr_1fr]">
            <div className="text-center lg:text-left">
              <span className="animate-slide-up inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" /> Built for local cricket tournaments in India
              </span>
              <h1 className="animate-slide-up mt-6 text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl [animation-delay:80ms]">
                From auction night to{" "}
                <span className="bg-linear-to-r from-emerald-300 via-lime-200 to-amber-300 bg-clip-text text-transparent">lifting the trophy</span>
              </h1>
              <p className="animate-slide-up mx-auto mt-6 max-w-xl text-lg text-slate-300 lg:mx-0 [animation-delay:160ms]">
                {APP_NAME} runs your whole tournament: player registration, a live IPL-style auction, fixtures, ball-by-ball scoring and stats. All live,
                all from a phone.
              </p>
              <div className="animate-slide-up mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start [animation-delay:240ms]">
                <Link
                  href="/signup"
                  className="shine inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 py-3.5 font-semibold text-slate-950 shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400"
                >
                  Create your tournament free <ArrowRight className="size-4" />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-6 py-3.5 font-semibold text-white transition hover:bg-white/10"
                >
                  Team owner login
                </Link>
              </div>
              <div className="animate-slide-up mt-10 grid grid-cols-3 gap-4 border-t border-white/10 pt-6 text-center lg:text-left [animation-delay:320ms]">
                <div>
                  <p className="text-2xl font-black text-white">
                    <CountUp to={500} prefix="₹" />
                  </p>
                  <p className="text-xs text-slate-400">starting bids</p>
                </div>
                <div>
                  <p className="text-2xl font-black text-white">
                    1 tap
                  </p>
                  <p className="text-xs text-slate-400">per bid, per ball</p>
                </div>
                <div>
                  <p className="text-2xl font-black text-white">
                    0 reloads
                  </p>
                  <p className="text-xs text-slate-400">everything is live</p>
                </div>
              </div>
            </div>
            <AuctionDemo />
          </div>
        </section>

        {/* Marquee */}
        <div className="border-y border-emerald-900/20 bg-emerald-600 py-3 text-white">
          <div className="flex w-max animate-marquee gap-8 whitespace-nowrap">
            {[...marquee, ...marquee].map((m, i) => (
              <span key={i} className="flex items-center gap-8 text-sm font-semibold">
                {m} <span className="text-emerald-300">✦</span>
              </span>
            ))}
          </div>
        </div>

        {/* Journey */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:py-24">
          <Reveal className="text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600">One app, the whole tournament</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">Five steps, zero paperwork</h2>
          </Reveal>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {journey.map((j, i) => (
              <Reveal key={j.title} delay={i * 90}>
                <div className="group relative h-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl">
                  <span className="absolute top-4 right-4 text-4xl font-black text-slate-100 transition group-hover:text-slate-200">{i + 1}</span>
                  <span className={`relative inline-flex size-11 items-center justify-center rounded-xl bg-linear-to-br ${j.color} text-white shadow-md`}>
                    <j.icon className="size-5" />
                  </span>
                  <h3 className="relative mt-4 font-bold text-slate-900">{j.title}</h3>
                  <p className="relative mt-1 text-sm leading-relaxed text-slate-600">{j.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Showcase: scoring */}
        <section className="border-t border-slate-200 bg-white">
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 py-20 sm:py-24 lg:grid-cols-2">
            <Reveal>
              <p className="text-sm font-semibold uppercase tracking-widest text-rose-600">Ball-by-ball scoring</p>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">Every ball, live on every phone</h2>
              <p className="mt-4 text-lg text-slate-600">
                The scorer taps once per ball. The live scorecard, the ground&apos;s big screen and the fixtures page all update in about a second.
                Share the link on WhatsApp and the whole village can follow the chase.
              </p>
              <ul className="mt-6 space-y-3 text-slate-700">
                {[
                  "Wides, no-balls, byes, run outs and free hits, all built in",
                  "A scorer PIN link for volunteers, and only one phone scores at a time",
                  "Guest players join the XI only after the organiser approves them",
                  "Result, points table and player stats update when the match ends",
                ].map((x) => (
                  <li key={x} className="flex gap-3">
                    <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">✓</span>
                    {x}
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal delay={120}>
              <ScoringDemo />
            </Reveal>
          </div>
        </section>

        {/* Showcase: fixtures */}
        <section className="bg-slate-50">
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 py-20 sm:py-24 lg:grid-cols-2">
            <Reveal delay={120} className="order-2 lg:order-1">
              <TableDemo />
            </Reveal>
            <Reveal className="order-1 lg:order-2">
              <p className="text-sm font-semibold uppercase tracking-widest text-amber-600">Fixtures & points table</p>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">Pick a format. We do the rest.</h2>
              <p className="mt-4 text-lg text-slate-600">
                League, groups, knockout, or IPL-style playoffs. Dates and times fill themselves in, net run rate is worked out for you, and winners move
                into the next round on their own.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {["Single / double league", "Groups + knockout", "Knockout with byes", "Semis & final", "Qualifier & Eliminator", "Net run rate"].map((x) => (
                  <span key={x} className="rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200">
                    {x}
                  </span>
                ))}
              </div>
            </Reveal>
          </div>
        </section>

        {/* Feature grid */}
        <section className="border-t border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:py-24">
            <Reveal className="text-center">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600">Everything included</p>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">Built for auction night and match day</h2>
            </Reveal>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f, i) => (
                <Reveal key={f.title} delay={(i % 3) * 90}>
                  <div className="group h-full rounded-2xl border border-slate-200 p-6 transition duration-300 hover:-translate-y-1 hover:border-emerald-300 hover:shadow-lg">
                    <span className="inline-flex rounded-xl bg-emerald-50 p-2.5 text-emerald-600 transition duration-300 group-hover:scale-110 group-hover:bg-emerald-600 group-hover:text-white">
                      <f.icon className="size-5" />
                    </span>
                    <h3 className="mt-4 font-bold text-slate-900">{f.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{f.text}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="bg-slate-950 text-white">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:py-24">
            <Reveal className="text-center">
              <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Ready in 10 minutes</h2>
              <p className="mt-3 text-slate-400">No app to install. Works on any phone, laptop or projector.</p>
            </Reveal>
            <div className="mt-12 grid gap-6 sm:grid-cols-3">
              {[
                { n: "01", title: "Create a tournament", text: "Set the team budget, base price, bid increments and squad size." },
                { n: "02", title: "Add players & teams", text: "Import from Excel or a Google Form and send each owner their login on WhatsApp." },
                { n: "03", title: "Go live", text: "Run the auction, make the fixtures, and share the live score links." },
              ].map((s, i) => (
                <Reveal key={s.n} delay={i * 120}>
                  <div className="h-full rounded-2xl border border-white/10 bg-white/5 p-6">
                    <p className="bg-linear-to-r from-emerald-300 to-amber-300 bg-clip-text text-4xl font-black text-transparent">{s.n}</p>
                    <h3 className="mt-3 text-lg font-bold">{s.title}</h3>
                    <p className="mt-1.5 text-sm text-slate-400">{s.text}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="px-4 py-20">
          <Reveal>
            <div className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl bg-linear-to-br from-emerald-600 via-emerald-500 to-lime-500 px-6 py-14 text-center text-white shadow-2xl shadow-emerald-600/30 sm:px-12">
              <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-white/20 blur-3xl animate-glow" />
              <GavelBadge />
              <h2 className="mt-5 text-3xl font-black tracking-tight sm:text-5xl">Your tournament deserves a big-league feel</h2>
              <p className="mx-auto mt-4 max-w-xl text-emerald-50">Start free. Set up your auction tonight and have the fixtures ready by tomorrow.</p>
              <Link
                href="/signup"
                className="shine mt-8 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-7 py-4 font-semibold text-white shadow-lg transition hover:bg-slate-800"
              >
                Get started free <ArrowRight className="size-4" />
              </Link>
            </div>
          </Reveal>
        </section>
      </main>
      <footer className="border-t border-slate-200 bg-white py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-sm text-slate-500 sm:flex-row">
          <p>
            © {APP_NAME} · Player auctions, fixtures & live scoring for local cricket
          </p>
          <div className="flex gap-4">
            <Link href="/signup" className="hover:text-slate-800">
              Organiser sign up
            </Link>
            <Link href="/login" className="hover:text-slate-800">
              Log in
            </Link>
          </div>
        </div>
      </footer>
    </>
  );
}
