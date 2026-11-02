import type { Metadata } from "next";
import Link from "next/link";
import { GuideShell, type Faq } from "../guide-shell";
import { PurseCalculator } from "./purse-calculator";

const path = "/guides/cricket-auction-rules";

export const metadata: Metadata = {
  title: "Cricket Auction Rules & Purse Calculator for Local Tournaments",
  description:
    "Standard cricket player auction rules for local leagues: team purse, base price, bid increments, squad size, timers and unsold players. Includes a free purse calculator.",
  alternates: { canonical: path },
  openGraph: { title: "Cricket auction rules & purse calculator", url: path },
};

const faqs: Faq[] = [
  {
    q: "What is the minimum squad rule in a cricket auction?",
    a: "Each team must always keep enough purse to buy the rest of its minimum squad at the base price. A team needing 5 more players at ₹500 must keep ₹2,000 back while bidding for the next one.",
  },
  {
    q: "What are standard bid increments?",
    a: "A common ladder for local cricket is +₹500 up to ₹5,000, +₹1,000 up to ₹20,000 and +₹2,000 above that. Smaller steps at low prices keep the bidding going; bigger steps at high prices keep it quick.",
  },
  {
    q: "How long should the bid timer be?",
    a: "20 to 30 seconds per bid works for most auctions. The timer restarts after every new bid, so popular players still get a proper bidding war.",
  },
  {
    q: "Can a team go over its purse?",
    a: "No. A team's total spend can never be more than its purse, and the minimum squad money must always be kept back.",
  },
];

const rules: [string, string, string][] = [
  ["Team purse", "₹1,00,000", "Same for every team. Bigger purse = bigger bids, not better teams."],
  ["Base price", "₹500", "Every player starts here. Keep it low so every player gets bought."],
  ["Bid increments", "+₹500 / +₹1,000 / +₹2,000", "Up to ₹5,000 / up to ₹20,000 / above ₹20,000."],
  ["Squad size", "11 to 15", "Minimum so a team can field an XI, maximum so stars are spread out."],
  ["Bid timer", "30 seconds", "Restarts after every bid. SOLD to the highest bidder when it runs out."],
  ["Unsold players", "Second round", "Brought back at the end, usually bought at base price."],
];

export default function AuctionRules() {
  return (
    <GuideShell
      eyebrow="Guide · Rules"
      title="Cricket auction rules & purse calculator"
      intro="Fair, simple rules for a local cricket player auction, with sensible numbers you can copy and a calculator to check how much a team can bid."
      faqs={faqs}
    >
      <p>
        Most arguments at auction night come from rules that were never written down. Agree these with every team owner before the auction, share them
        in the WhatsApp group, and stick to them.
      </p>

      <h2>Recommended rules for a local tournament</h2>
      <div className="not-prose my-6 overflow-x-auto rounded-2xl border border-slate-200">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Rule</th>
              <th className="px-4 py-3 font-semibold">Typical value</th>
              <th className="px-4 py-3 font-semibold">Why</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rules.map(([rule, value, why]) => (
              <tr key={rule}>
                <td className="px-4 py-3 font-semibold text-slate-900">{rule}</td>
                <td className="px-4 py-3 whitespace-nowrap text-emerald-700">{value}</td>
                <td className="px-4 py-3 text-slate-600">{why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>The minimum squad rule (the one people forget)</h2>
      <p>
        A team must <strong>always keep enough money to finish its minimum squad at the base price</strong>. Without this rule, one team spends
        everything on two stars and cannot field eleven players.
      </p>
      <p>
        <strong>Example:</strong> the purse is ₹1,00,000, the base price ₹500 and the minimum squad 11. A team has bought 4 players for ₹38,000, so it has
        ₹62,000 left and still needs 7 players. If it wins the next one, it still needs 6 more, so it keeps 6 × ₹500 = ₹3,000 back. The highest it can
        bid right now is <strong>₹59,000</strong>.
      </p>

      <PurseCalculator />

      <h2>How to choose the purse</h2>
      <p>
        A simple formula: <strong>base price × maximum squad × 10 to 15</strong>. With a ₹500 base price and 15 players per team, a purse between
        ₹75,000 and ₹1,12,500 gives room for a few bidding wars without one team buying every star. The purse is play money for team balance; it does not
        have to match any real entry fee.
      </p>

      <h2>Other rules to agree in advance</h2>
      <ul>
        <li>
          <strong>Icon or retained players:</strong> if captains keep players, fix the price taken from the purse (or ₹0) and do it before the auction
          starts.
        </li>
        <li>
          <strong>Bidding for your own team only:</strong> one owner login per team, and only that phone can bid for it.
        </li>
        <li>
          <strong>No take-backs:</strong> a bid placed is a bid made. If the timer ends, the player is sold.
        </li>
        <li>
          <strong>Unsold players:</strong> say upfront whether they come back in a second round, and at what price.
        </li>
        <li>
          <strong>Disputes:</strong> name one person (usually the organiser) whose decision is final.
        </li>
      </ul>

      <h2>Let the app enforce the rules</h2>
      <p>
        On <Link href="/">CricMitra</Link> you set the purse, base price, increments, squad size and timer once. Every bid is then checked
        automatically: no team can bid out of turn, overspend, break the minimum squad rule or go past the maximum squad. Read the full{" "}
        <Link href="/guides/how-to-run-cricket-player-auction">step-by-step auction guide</Link> or try the <Link href="/demo">demo</Link>.
      </p>
    </GuideShell>
  );
}
