import type { Metadata } from "next";
import Link from "next/link";
import { GuideShell, Steps, type Faq } from "../guide-shell";

const path = "/guides/how-to-organise-cricket-tournament";

export const metadata: Metadata = {
  title: "How to Organise a Local Cricket Tournament (Complete Guide)",
  description:
    "A complete checklist for organising a local cricket tournament in India: format, budget, player registration, auction, fixtures, live scoring, points table, stats and prize day.",
  alternates: { canonical: path },
  openGraph: { title: "How to organise a local cricket tournament", url: path },
};

const faqs: Faq[] = [
  {
    q: "How many teams should a local cricket tournament have?",
    a: "6 to 8 teams is the sweet spot for a weekend or two-weekend tournament. With 8 teams in two groups of 4 you get 12 group matches, then semi-finals and a final: 15 matches in total.",
  },
  {
    q: "How many overs should each match be?",
    a: "T10 (10 overs a side) suits one-day tournaments with many matches. T20 suits weekend leagues with fewer matches per day. Longer formats (50 overs or multi-day) suit club cricket with proper grounds and time.",
  },
  {
    q: "Should we use an auction or let captains pick teams?",
    a: "An auction gives balanced teams and makes team selection an event in itself. Captain picks are quicker for small, informal tournaments. Either way, decide before registration closes.",
  },
  {
    q: "How do we share live scores with everyone?",
    a: "Use a live scoring app where the scorer taps each ball on a phone and everyone follows the live scorecard from a link. On CricMitra the scorer only needs a PIN link, and the scorecard, fixtures and points table update automatically.",
  },
];

export default function OrganiseTournament() {
  return (
    <GuideShell
      eyebrow="Guide · Tournament"
      title="How to organise a local cricket tournament"
      intro="The complete checklist, from the first WhatsApp message to lifting the trophy: format, registration, team selection, fixtures, live scoring, stats and prize day."
      faqs={faqs}
    >
      <p>
        A good local tournament feels like a mini-IPL: everyone knows the schedule, the scores are live on every phone, and the points table is never in
        doubt. Here is the whole process, step by step.
      </p>

      <h2>1. Decide the basics</h2>
      <ul>
        <li>
          <strong>Dates and ground:</strong> book the ground first; everything else depends on how many matches it can hold per day.
        </li>
        <li>
          <strong>Number of teams:</strong> 6–8 teams fit a weekend; 10–12 teams need more days or two grounds.
        </li>
        <li>
          <strong>Overs:</strong> T10 for many quick matches in a day, T20 for weekend leagues, 50 overs or multi-day (Test) matches for club cricket.
        </li>
        <li>
          <strong>Entry fee and prizes:</strong> collect the entry fee before the fixtures are announced and fix the prize money in writing.
        </li>
        <li>
          <strong>Local rules:</strong> wides and no-balls (runs and re-bowl), free hit, overs per bowler, tennis ball or leather, and what happens if
          it rains.
        </li>
      </ul>

      <h2>2. Register the players</h2>
      <p>
        Share one registration link in your WhatsApp groups and ask for name, phone, role (batter, bowler, all-rounder, wicket-keeper) and a photo. Close
        registration a few days before team selection so you can check the list for duplicates.
      </p>

      <h2>3. Make the teams</h2>
      <p>
        The fairest and most exciting way is a <strong>player auction</strong>: each team gets the same budget and owners bid for players. Read{" "}
        <Link href="/guides/how-to-run-cricket-player-auction">how to run a cricket player auction</Link> and the{" "}
        <Link href="/guides/cricket-auction-rules">auction rules with a purse calculator</Link>. After the auction, each team picks its captain,
        vice-captain and wicket-keeper.
      </p>

      <h2>4. Make the fixtures</h2>
      <p>
        Choose a format that fits your days: a league (everyone plays everyone), groups followed by knockouts, a straight knockout, or a league with
        IPL-style playoffs. Fix match times and publish the full schedule before the first ball. See{" "}
        <Link href="/guides/cricket-tournament-fixtures">fixture formats, points table and NRR</Link> for which format to choose and how many matches
        each one needs.
      </p>

      <h2>5. Score every ball live</h2>
      <p>
        Paper scorebooks get lost and lead to arguments over the points table. Appoint one scorer per match and score on a phone, so the scorecard,
        result and player stats are saved automatically and everyone can follow along. See the{" "}
        <Link href="/guides/live-cricket-scoring">live cricket scoring guide</Link>.
      </p>

      <h2>6. Keep the points table and stats</h2>
      <p>
        Two points for a win, one for a tie or no result is the usual system, with <strong>net run rate</strong> to separate teams on equal points.
        Track the leading run-scorer (orange cap) and wicket-taker (purple cap) through the tournament; players love checking the leaderboard.
      </p>

      <h2>7. Finals and prize day</h2>
      <Steps
        items={[
          { title: "Put the final on a big screen", text: "A projector or TV with the live score turns a local final into an event." },
          { title: "Share result cards", text: "Post each match result as an image in the WhatsApp group the moment it ends." },
          { title: "Award the individual prizes", text: "Man of the series, orange cap, purple cap, best fielder: use the stats, not memory." },
          { title: "Share the final stats", text: "Send the full batting and bowling tables to every team. It brings them back next season." },
        ]}
      />

      <h2>Run every step in one app</h2>
      <p>
        <Link href="/">CricMitra</Link> is an all-in-one cricket tournament app: player registration, a live auction, automatic fixtures, ball-by-ball
        live scoring, points table with NRR, and tournament stats. It works on any phone, with nothing to install. Try the{" "}
        <Link href="/demo">demo tournament</Link>.
      </p>
    </GuideShell>
  );
}
