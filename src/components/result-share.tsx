"use client";
import { useState } from "react";
import { Button, Select } from "./ui";

export type SharePerformer = { id: string; name: string; detail: string };

// Picture of the result (or of one player's performance) to share on WhatsApp.
// Only players who did something in the match are offered, best performance first.
export function ResultShare({ matchId, performers }: { matchId: string; performers: SharePerformer[] }) {
  const [player, setPlayer] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-sm font-semibold text-slate-800">Share as an image</p>
      <Select aria-label="Image to share" value={player} onChange={(e) => setPlayer(e.target.value)}>
        <option value="">Match result</option>
        {performers.length > 0 && (
          <optgroup label="A player's performance (best first)">
            {performers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.detail}
              </option>
            ))}
          </optgroup>
        )}
      </Select>
      <Button
        variant="secondary"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          try {
            const res = await fetch(`/api/result/${matchId}${player ? `?player=${player}` : ""}`);
            if (!res.ok) throw Error("A verified result card could not be generated. Please retry.");
            const blob = await res.blob();
            const file = new File([blob], "cricmitra-result.png", { type: "image/png" });
            if (navigator.canShare?.({ files: [file] })) {
              await navigator.share({ files: [file], title: "CricMitra result" });
            } else {
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = file.name;
              a.click();
              URL.revokeObjectURL(url);
            }
          } catch (e) {
            if (!(e instanceof DOMException && e.name === "AbortError")) setMessage(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Download / share image
      </Button>
      {message && (
        <p role="alert" className="text-sm text-rose-700">
          {message}
        </p>
      )}
    </div>
  );
}
