import Link from "next/link";
export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-10">
      <h1 className="text-2xl font-bold">Privacy and support</h1>
      <p>
        CricMitra stores tournament registrations, player profiles and photos, team information, bids, fixtures and scoring records in
        Supabase. Hosting is provided through Vercel.
      </p>
      <p>
        Approved player profiles, photos, squads, scores and statistics are visible on public tournament pages. Each approved player also has
        a public profile page that brings together the tournaments they played in on CricMitra; entries are matched by mobile number and first
        name inside the database, and the number itself is never shown. Organisers can send an approved player a one-time link to create a player login; the player then signs in with their mobile number and a password to see their own stats. Phone numbers are stored separately for the organiser. Registration links can be used by anyone who receives them; share them only where you intend to accept
        registrations.
      </p>
      <p>
        Pending scoring actions are saved in the scorer’s browser so they can be recovered after a connection failure. Export or resolve
        pending actions before clearing browser data. Audit history records important tournament changes; it does not include passwords or
        scorer PINs.
      </p>
      <p>
        For registration corrections, photo removal, team login recovery or tournament questions, contact the organiser who provided your
        tournament link first. For anything else, including account access, reach us on the{" "}
        <Link className="text-emerald-700 underline" href="/contact">
          contact page
        </Link>{" "}
        (WhatsApp or email).
      </p>
      <p>
        Organisers can manage and delete tournament records. No automatic retention period is promised here. Public links and images can be
        copied by viewers.
      </p>
      <Link className="text-emerald-700 underline" href="/">
        Back to CricMitra
      </Link>
    </main>
  );
}
