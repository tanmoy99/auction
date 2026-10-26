import Link from "next/link";
import { FileSpreadsheet, Gavel, MonitorPlay, ShieldCheck, Smartphone, Users } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { APP_NAME } from "@/lib/config";

const features = [
  { icon: FileSpreadsheet, title: "Import players in seconds", text: "Upload Excel / CSV, paste a Google Sheet link, or let players fill a Google Form or your own registration link." },
  { icon: Users, title: "Teams with fixed budgets", text: "Register teams, give each owner a login and a purse. Squad limits are enforced automatically." },
  { icon: Smartphone, title: "Bid live from any phone", text: "Owners tap one big button to raise the bid. Simultaneous bids are handled safely - only one wins." },
  { icon: MonitorPlay, title: "Big screen display", text: "Put the live screen on a projector or YouTube stream with the player card, current bid and a SOLD stamp." },
  { icon: Gavel, title: "Auctioneer controls", text: "Pick the next player or a random one, reset the timer, bid for owners in the room, sold / unsold in one tap." },
  { icon: ShieldCheck, title: "Purse safety built in", text: "Teams can't overspend: every bid keeps enough money to complete the minimum squad at base price." },
];

const steps = [
  { n: 1, title: "Create a tournament", text: "Set team budget, base price (e.g. Rs 500), bid increments and squad size." },
  { n: 2, title: "Add players & teams", text: "Import from Excel or Google Form, approve registrations and create owner logins." },
  { n: 3, title: "Go live", text: "Start the auction. Owners bid from their phones and the highest bid joins their squad." },
];

export default function Home() {
  return (
    <>
      <AppHeader />
      <main className="flex-1">
        <section className="relative overflow-hidden border-b border-slate-200 bg-white">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.12),transparent_60%)]" />
          <div className="relative mx-auto max-w-6xl px-4 py-20 text-center sm:py-28">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              Built for local cricket tournaments
            </span>
            <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-6xl">
              Run your player auction <span className="text-emerald-600">live</span>, like the big leagues
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600">
              {APP_NAME} handles player registration, team budgets and real-time bidding - so your auction night is smooth, fair and fun.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/signup" className="rounded-lg bg-emerald-600 px-6 py-3 font-medium text-white shadow-sm hover:bg-emerald-700">
                Create your tournament
              </Link>
              <Link href="/login" className="rounded-lg border border-slate-200 bg-white px-6 py-3 font-medium text-slate-700 hover:bg-slate-50">
                Team owner login
              </Link>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-20">
          <h2 className="text-center text-2xl font-bold text-slate-900 sm:text-3xl">Everything you need on auction day</h2>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-4 inline-flex rounded-lg bg-emerald-50 p-2.5 text-emerald-600">
                  <f.icon className="size-5" />
                </div>
                <h3 className="font-semibold text-slate-900">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-20">
            <h2 className="text-center text-2xl font-bold text-slate-900 sm:text-3xl">How it works</h2>
            <div className="mt-12 grid gap-8 sm:grid-cols-3">
              {steps.map((s) => (
                <div key={s.n} className="text-center">
                  <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-slate-900 text-lg font-bold text-white">{s.n}</div>
                  <h3 className="mt-4 font-semibold text-slate-900">{s.title}</h3>
                  <p className="mt-1.5 text-sm text-slate-600">{s.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-slate-200 py-6 text-center text-sm text-slate-500">
        © {APP_NAME}
      </footer>
    </>
  );
}
