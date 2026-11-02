import type { Metadata } from "next";
import Link from "next/link";
import { GuideShell, Steps, type Faq } from "../guide-shell";

const path = "/guides/how-to-run-cricket-player-auction";

export const metadata: Metadata = {
  title: "How to Run a Cricket Player Auction (Step-by-Step Guide)",
  description:
    "A complete step-by-step guide to running an IPL-style player auction for your local cricket tournament: budgets, base price, bid increments, owner logins, auction night and after.",
  alternates: {
    canonical: path,
    languages: { en: path, hi: "/guides/hi/cricket-auction-kaise-kare", bn: "/guides/bn/cricket-auction-kivabe-korben" },
  },
  openGraph: { title: "How to run a cricket player auction", url: path },
};

const faqs: Faq[] = [
  {
    q: "How much purse should each team get in a local cricket auction?",
    a: "Multiply your base price by the maximum squad size, then multiply by 10 to 15. For a ₹500 base price and 15 players, ₹75,000 to ₹1,00,000 per team works well: enough for a few big bids without one team buying every star.",
  },
  {
    q: "What is a good base price for players?",
    a: "Most local tournaments start at ₹500 or ₹1,000. Keep it low so every player gets bought; the bidding pushes the good players up on its own.",
  },
  {
    q: "What happens to unsold players?",
    a: "Put them in a second round at the end. Most teams still need players by then and will pick them up at the base price.",
  },
  {
    q: "Can we keep icon players or captains without auctioning them?",
    a: "Yes. Assign them to their team before the auction at a fixed price (or ₹0). The price is taken from the team purse so every team still plays by the same budget.",
  },
  {
    q: "Do owners need to install an app to bid?",
    a: "Not on CricMitra. Owners log in on any phone browser with the login ID you send them on WhatsApp and bid with one tap.",
  },
];

export default function HowToRunAuction() {
  return (
    <GuideShell
      eyebrow="Guide · Auction"
      title="How to run a cricket player auction"
      intro="Everything you need to run an IPL-style auction for your local league or tournament, from setting budgets to auction night and announcing the squads."
      faqs={faqs}
    >
      <p>
        A player auction turns team selection into the most exciting night of your tournament. Teams get a fixed budget (the <strong>purse</strong>),
        players come up one by one, and team owners bid until the timer runs out. Done well, it gives you balanced teams and a big crowd before a
        ball is bowled. Here is how to do it.
      </p>

      <h2>1. Decide the auction rules before anything else</h2>
      <p>Write these down and share them with every owner at least a day before the auction:</p>
      <ul>
        <li>
          <strong>Team purse:</strong> the same budget for every team, for example ₹1,00,000.
        </li>
        <li>
          <strong>Base price:</strong> the starting bid for every player, usually ₹500 or ₹1,000.
        </li>
        <li>
          <strong>Bid increments:</strong> how much each new bid goes up. A common ladder is +₹500 up to ₹5,000, +₹1,000 up to ₹20,000, then
          +₹2,000.
        </li>
        <li>
          <strong>Squad size:</strong> a minimum (e.g. 11) and a maximum (e.g. 15) players per team.
        </li>
        <li>
          <strong>Bid timer:</strong> how long a bid stays open before the player is SOLD, typically 20–30 seconds.
        </li>
        <li>
          <strong>Icon or retained players:</strong> whether captains or owners keep certain players before the auction, and at what price.
        </li>
      </ul>
      <p>
        Not sure what numbers to pick? Use our <Link href="/guides/cricket-auction-rules">auction rules guide and purse calculator</Link>.
      </p>

      <h2>2. Collect player registrations</h2>
      <p>
        Share one registration link in your WhatsApp groups. Ask for name, phone number, role (batter, bowler, all-rounder, wicket-keeper),
        batting and bowling style, and a photo. Photos matter: owners bid more confidently when they can see who is coming up.
      </p>
      <p>
        If you already collect names in a Google Form or Excel sheet, keep doing that and import the sheet. Set a registration deadline two or three
        days before the auction so you have time to check the list.
      </p>

      <h2>3. Set up teams and owners</h2>
      <p>
        Add each team with its name, short name and colour, and decide who bids for it. Every owner should bid from their own phone. Calling out bids
        in a noisy room leads to arguments; a phone tap with a time stamp does not.
      </p>

      <h2>4. Prepare the auction night</h2>
      <Steps
        items={[
          { title: "Book a room with a projector or TV", text: "A big screen showing the player, the current bid and the leading team makes the night." },
          { title: "Order the player list", text: "Start with a few popular players to build excitement, then mix experienced and new players." },
          { title: "Do a 5-minute test bid", text: "Have every owner log in and place a test bid before the real auction starts. Fix login problems now, not mid-auction." },
          { title: "Choose an auctioneer", text: "One person runs the screen, announces each player and calls SOLD. Keep the energy up and the pace quick." },
        ]}
      />

      <h2>5. Run the auction</h2>
      <p>For each player:</p>
      <ol>
        <li>Bring the player up on the big screen with photo, role and base price.</li>
        <li>Owners bid. Each bid must be the next step on the increment ladder, and a team cannot bid more than it can afford.</li>
        <li>When the timer runs out, the highest bidder wins: <strong>SOLD</strong>. If nobody bids, the player is <strong>UNSOLD</strong>.</li>
        <li>Move on quickly. A good pace is 60–90 seconds per player.</li>
      </ol>
      <p>
        <strong>The most important rule:</strong> a team must always keep enough money to complete its minimum squad at the base price. If a team
        needs 5 more players at ₹500, it must keep ₹2,500 back and cannot spend it on one big bid. This stops a team ending up with too few players.
      </p>

      <h2>6. Unsold players and the second round</h2>
      <p>
        When the main list is finished, bring the unsold players back for a quick second round. Teams that still need players will usually buy them at
        the base price.
      </p>

      <h2>7. After the auction</h2>
      <ul>
        <li>Finish the auction and share the final squads with each team&apos;s spend and remaining purse.</li>
        <li>Let owners choose their captain, vice-captain and wicket-keeper.</li>
        <li>Make the fixtures and send everyone the schedule link.</li>
      </ul>

      <h2>Do it all from one app</h2>
      <p>
        <Link href="/">CricMitra</Link> was built for exactly this. Players register from a WhatsApp link, owners bid from their phones, the purse
        and minimum squad rule are checked on every bid, and the big screen shows a giant SOLD stamp. After the auction the same app makes the fixtures
        and runs ball-by-ball live scoring. See it in the <Link href="/demo">demo tournament</Link>.
      </p>
    </GuideShell>
  );
}
