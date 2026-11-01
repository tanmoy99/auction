"use client";
import { useState } from "react";
import { Button, Select } from "./ui";
export function ResultShare({ matchId, players }: { matchId: string; players: { id: string; name: string }[] }) {
  const [player, setPlayer] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <Select aria-label="Result card type" value={player} onChange={(e) => setPlayer(e.target.value)}>
        <option value="">Match result card</option>
        {players.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} performance
          </option>
        ))}
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
        Download / share result
      </Button>
      {message && (
        <p role="alert" className="text-sm text-rose-700">
          {message}
        </p>
      )}
    </div>
  );
}
