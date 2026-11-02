import type { Metadata } from "next";
import Link from "next/link";
import { GuideShell, type Faq } from "../guide-shell";
import { MatchCounter } from "./match-counter";

const path = "/guides/cricket-tournament-fixtures";

export const metadata: Metadata = {
  title: "Cricket Tournament Fixtures: League, Knockout, IPL Playoffs & NRR",
  description:
    "Choose the right fixture format for your cricket tournament: league, groups, knockout or IPL-style playoffs. How many matches each needs, points table rules and how net run rate (NRR) is calculated.",
  alternates: { canonical: path },
  openGraph: { title: "Cricket tournament fixtures, points table & NRR", url: path },
};

const faqs: Faq[] = [
  {
    q: "How is net run rate (NRR) calculated?",
    a: "NRR = (total runs scored ÷ total overs faced) − (total runs conceded ÷ total overs bowled), across all league matches. If a team is bowled out, it counts as having faced its full quota of overs.",
  },
  {
    q: "How many matches are there in a league of 8 teams?",
    a: "If every team plays every other team once, 8 teams play 28 matches (8 × 7 ÷ 2). Playing twice doubles it to 56.",
  },
  {
    q: "How do IPL-style playoffs work?",
    a: "The top four play off. 1st vs 2nd in Qualifier 1: the winner goes straight to the final. 3rd vs 4th in the Eliminator: the loser is out. The loser of Qualifier 1 then plays the winner of the Eliminator in Qualifier 2 for the other place in the final.",
  },
  {
    q: "What if the number of teams is not a power of 2 in a knockout?",
    a: "The top seeds get a bye into the second round. For example, with 6 teams the top 2 seeds skip round one and the other 4 play for the remaining 2 places.",
  },
];

const formats: [string, string, string][] = [
  ["League (round robin)", "Everyone plays everyone once (or twice).", "Fairest; best when you have enough days."],
  ["Groups + knockout", "Teams split into groups; the top teams go to semi-finals and a final.", "Many teams, limited days."],
  ["Straight knockout", "Lose once and you are out. Byes fill an uneven bracket.", "One-day tournaments with many teams."],
  ["League + IPL playoffs", "A league, then Qualifier 1, Eliminator, Qualifier 2 and the Final.", "Gives the top two teams a second chance."],
];

export default function FixturesGuide() {
  return (
    <GuideShell
      eyebrow="Guide · Fixtures"
      title="Cricket tournament fixtures, points table & NRR"
      intro="Pick the right format for your teams and days, count how many matches you need, and understand exactly how the points table and net run rate work."
      faqs={faqs}
    >
      <h2>Which format should you choose?</h2>
      <div className="not-prose my-6 overflow-x-auto rounded-2xl border border-slate-200">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Format</th>
              <th className="px-4 py-3 font-semibold">How it works</th>
              <th className="px-4 py-3 font-semibold">Best for</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {formats.map(([name, how, best]) => (
              <tr key={name}>
                <td className="px-4 py-3 font-semibold text-slate-900">{name}</td>
                <td className="px-4 py-3 text-slate-600">{how}</td>
                <td className="px-4 py-3 text-slate-600">{best}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>How many matches will you need?</h2>
      <p>
        A league where everyone plays once needs <strong>teams × (teams − 1) ÷ 2</strong> matches. A straight knockout needs <strong>teams − 1</strong>.
        Use the calculator to see the total and how many match days your ground needs.
      </p>
      <MatchCounter />

      <h2>Points table rules</h2>
      <ul>
        <li>
          <strong>Win:</strong> 2 points. <strong>Tie or no result:</strong> 1 point each. <strong>Loss:</strong> 0.
        </li>
        <li>Teams level on points are separated by number of wins, then by net run rate.</li>
        <li>Announce these rules before the tournament, especially what happens if a match is washed out.</li>
      </ul>

      <h2>Net run rate (NRR), explained</h2>
      <p>
        <strong>NRR = (runs scored ÷ overs faced) − (runs conceded ÷ overs bowled)</strong>, added up across all league matches. A positive NRR means a
        team scores faster than its opponents.
      </p>
      <p>
        <strong>Example:</strong> a team scores 150 in 20 overs and then bowls the opponent out for 120 in 18 overs. Because the opponent was all out, it
        counts as 20 overs. NRR = 150 ÷ 20 − 120 ÷ 20 = 7.50 − 6.00 = <strong>+1.50</strong>.
      </p>
      <p>
        Overs are counted ball by ball: 18.3 overs means 18 overs and 3 balls, which is 18.5 overs in the calculation. This is where most hand-made
        points tables go wrong.
      </p>

      <h2>Scheduling tips</h2>
      <ul>
        <li>Give every team a break between matches on the same day.</li>
        <li>Spread the strongest teams&apos; matches across the days so the last day still matters.</li>
        <li>Keep the knockout matches for the last day, with the final under lights or on the big screen if you can.</li>
      </ul>

      <h2>Let the app do the maths</h2>
      <p>
        On <Link href="/">CricMitra</Link> you pick the format and the start date, and the fixtures, match times, points table and NRR are worked out
        for you. Winners move into the next round automatically. Live scores come straight from the scorer&apos;s phone; see the{" "}
        <Link href="/guides/live-cricket-scoring">live scoring guide</Link>.
      </p>
    </GuideShell>
  );
}
