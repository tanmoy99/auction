"use client";

import { useState } from "react";
import { Copy, ExternalLink, MessageCircle, RefreshCw } from "lucide-react";
import { useTournament } from "@/components/tournament-context";
import { toast } from "@/components/toast";
import { Button, Card, cn } from "@/components/ui";
import { errorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";

function copy(text: string) {
  navigator.clipboard.writeText(text).then(() => toast("Copied", "success"));
}

export default function RegistrationPage() {
  const { tournament: t } = useTournament();
  const [busy, setBusy] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link = `${origin}/register/${t.registration_token}`;
  const webhook = `${origin}/api/register/${t.registration_token}`;
  const isLocal = /localhost|127\.0\.0\.1/.test(origin);

  const script = `// ${t.name} - send every Google Form response to the auction site
function onFormSubmit(e) {
  var data = {};
  for (var question in e.namedValues) {
    data[question] = e.namedValues[question].join(', ');
  }
  UrlFetchApp.fetch('${webhook}', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(data),
    muteHttpExceptions: true
  });
}`;

  async function update(values: Record<string, unknown>, message: string) {
    setBusy(true);
    const { error } = await supabase.from("tournaments").update(values).eq("id", t.id);
    setBusy(false);
    if (error) toast(errorMessage(error), "error");
    else toast(message, "success");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Option 1 · Registration link</h2>
            <p className="mt-1 text-sm text-slate-500">Easiest. Share this link on WhatsApp - players fill a mobile-friendly form with photo.</p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
              t.registration_open ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600",
            )}
          >
            {t.registration_open ? "Open" : "Closed"}
          </span>
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 pl-3 text-sm">
          <span className="min-w-0 flex-1 truncate text-slate-700">{link}</span>
          <Button size="sm" variant="secondary" onClick={() => copy(link)}>
            <Copy className="size-4" />
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={`https://wa.me/?text=${encodeURIComponent(`Register for ${t.name} player auction: ${link}`)}`} target="_blank">
            <Button size="sm">
              <MessageCircle className="size-4" /> Share on WhatsApp
            </Button>
          </a>
          <a href={link} target="_blank">
            <Button size="sm" variant="secondary">
              <ExternalLink className="size-4" /> Open
            </Button>
          </a>
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            onClick={() => update({ registration_open: !t.registration_open }, t.registration_open ? "Registration closed" : "Registration opened")}
          >
            {t.registration_open ? "Close registration" : "Open registration"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              confirm("Create a new link? The old link and Google Form script will stop working.") &&
              update({ registration_token: crypto.randomUUID() }, "New link created")
            }
          >
            <RefreshCw className="size-4" /> New link
          </Button>
        </div>
        <p className="mt-4 text-xs text-slate-500">New registrations show up in the Players tab as Pending until you approve them.</p>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold text-slate-900">Option 2 · Your own Google Form</h2>
        <p className="mt-1 text-sm text-slate-500">
          Already using a Google Form? Responses can flow in automatically. Question titles like <i>Name, Mobile, Role, Batting style,
          Bowling style, Age, Village</i> are recognised.
        </p>
        {isLocal && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Google can&apos;t reach <b>localhost</b>. Set this up after you deploy to Vercel (the link below will then show your real site
            address). While testing locally, use <b>Players → Import → Google Sheet link</b> instead.
          </p>
        )}
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-700">
          <li>
            In the Google Form, open <b>Responses → Link to Sheets</b> and open that sheet.
          </li>
          <li>
            In the sheet: <b>Extensions → Apps Script</b>. Delete everything and paste the code below. Click <b>Save</b>.
          </li>
          <li>
            Left menu <b>Triggers (clock icon) → Add trigger</b>: function <code>onFormSubmit</code>, event source{" "}
            <b>From spreadsheet</b>, event type <b>On form submit</b>. Save and allow the permissions.
          </li>
          <li>Submit a test response - it appears in Players as Pending.</li>
        </ol>
        <div className="relative mt-4">
          <pre className="max-h-64 overflow-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">{script}</pre>
          <Button size="sm" variant="secondary" className="absolute right-2 top-2" onClick={() => copy(script)}>
            <Copy className="size-4" /> Copy
          </Button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Photo uploads in Google Forms are saved to Drive. To show them, share the upload folder as &quot;Anyone with the link can view&quot;.
        </p>
      </Card>
    </div>
  );
}
