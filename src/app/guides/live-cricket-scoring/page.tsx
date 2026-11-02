import type { Metadata } from "next";
import Link from "next/link";
import { GuideShell, Steps, type Faq } from "../guide-shell";

const path = "/guides/live-cricket-scoring";

export const metadata: Metadata = {
  title: "Live Cricket Scoring from Your Phone: Ball-by-Ball Guide",
  description:
    "How to score a local cricket match ball by ball on a phone and share a live scorecard: scorer setup, extras, wickets, free hits, T10/T20/50-over and Test matches, and common mistakes.",
  alternates: { canonical: path },
  openGraph: { title: "Live cricket scoring from your phone", url: path },
};

const faqs: Faq[] = [
  {
    q: "Can I score a cricket match live on my phone for free?",
    a: "Yes. On CricMitra the organiser sends the scorer a PIN link. The scorer taps each ball and everyone with the match link sees the live scorecard, with nothing to install.",
  },
  {
    q: "What if the internet drops during the match?",
    a: "Keep scoring. CricMitra saves each ball on the scorer's phone and sends it as soon as the connection comes back. Don't clear the browser or switch phones until the pending balls are saved.",
  },
  {
    q: "Can two people score the same match?",
    a: "Only one phone scores at a time, so the score never gets mixed up. If the scorer's phone dies, another phone can take over with the same PIN.",
  },
  {
    q: "Does it work for Test or multi-day matches?",
    a: "Yes. Test matches support two innings per side, declarations and the follow-on, alongside T10, T20 and 50-over one-day matches.",
  },
];

export default function LiveScoringGuide() {
  return (
    <GuideShell
      eyebrow="Guide · Scoring"
      title="Live cricket scoring from your phone"
      intro="Score every ball on a phone and let players, families and fans follow a live scorecard from a link, with no scorebook to lose."
      faqs={faqs}
    >
      <p>
        Live scoring changes a local match. Families watch from home, the points table updates by itself, and nobody argues about the score at the end
        because every ball is recorded. All you need is one phone and a volunteer.
      </p>

      <h2>Before the match</h2>
      <Steps
        items={[
          { title: "Pick a scorer", text: "One calm volunteer per match who knows the basic rules. They do not need an account." },
          { title: "Send the scorer link", text: "The organiser shares the match's scorer link and PIN on WhatsApp." },
          { title: "Set the playing XIs", text: "Choose the eleven players for each side, including captain and wicket-keeper, then record the toss." },
          { title: "Share the live link", text: "Post the public match link in the team groups so everyone can follow the score." },
        ]}
      />

      <h2>Scoring each ball</h2>
      <ul>
        <li>
          <strong>Runs:</strong> tap 0, 1, 2, 3, 4 or 6. Strike changes automatically on odd runs and at the end of the over.
        </li>
        <li>
          <strong>Wide and no-ball:</strong> tap the extra, plus any runs taken. Your tournament&apos;s own rules decide the penalty runs and whether the
          ball is bowled again.
        </li>
        <li>
          <strong>Byes and leg byes:</strong> runs that go to the team but not the batter.
        </li>
        <li>
          <strong>Wicket:</strong> choose how the batter got out (bowled, caught, LBW, run out, stumped…) and who comes in next.
        </li>
        <li>
          <strong>Free hit:</strong> after a no-ball, the next ball is a free hit and only a run out can dismiss the batter.
        </li>
        <li>
          <strong>Mistake?</strong> Tap undo to remove the last ball, then score it again.
        </li>
      </ul>

      <h2>Match formats</h2>
      <p>
        Use <strong>T10</strong> for quick tournament matches, <strong>T20</strong> for most weekend leagues, and <strong>50 overs</strong> for one-day
        club cricket, each with its own limit on overs per bowler. For longer club cricket, <strong>Test (multi-day) matches</strong> have two innings
        per side, declarations and the follow-on.
      </p>

      <h2>Common scoring mistakes</h2>
      <ul>
        <li>Forgetting to change the bowler at the end of the over.</li>
        <li>Scoring runs off a no-ball as extras instead of to the batter.</li>
        <li>Wrong batter on strike after a run out. Check who crossed.</li>
        <li>Two people scoring on two phones and getting different totals. Use one scorer.</li>
      </ul>

      <h2>After the match</h2>
      <p>
        When the last ball is scored, the result is decided and the points table, batting and bowling figures and tournament leaderboards update straight
        away. Share the result card in the WhatsApp group while everyone is still at the ground.
      </p>

      <h2>Score your next match on CricMitra</h2>
      <p>
        <Link href="/">CricMitra</Link> gives every match a scorer PIN link, one-tap ball-by-ball scoring, offline protection, a live scorecard and a
        big-screen view, all connected to your <Link href="/guides/cricket-tournament-fixtures">fixtures and points table</Link>. Try it in the{" "}
        <Link href="/demo">demo</Link>.
      </p>
    </GuideShell>
  );
}
