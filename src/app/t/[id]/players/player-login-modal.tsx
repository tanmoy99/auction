"use client";

import { useEffect, useState } from "react";
import { Copy, MessageCircle } from "lucide-react";
import { toast } from "@/components/toast";
import { Button, Modal, Spinner } from "@/components/ui";
import { mobileKey } from "@/lib/config";
import { errorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { Player } from "@/lib/types";

// One-time link (valid 7 days) that lets an approved player set a password and see their own stats
export function PlayerLoginModal({ player, phone, tournament, onClose }: { player: Player; phone: string; tournament: string; onClose: () => void }) {
  const [link, setLink] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("player_invite", { p_player: player.id }).then(({ data, error }) => {
      if (error) setFailed(errorMessage(error));
      else setLink(`${window.location.origin}/player-login/${data as string}`);
    });
  }, [player.id]);

  const mobile = mobileKey(phone);
  const message = link
    ? `Hi ${player.name.split(" ")[0]}, here is your CricMitra player login for ${tournament}.\nSet your password here (link works once, for 7 days):\n${link}\nAfter that, log in at ${window.location.origin}/login with your mobile number to see your stats and matches.`
    : "";

  return (
    <Modal open onClose={onClose} title={`Player login for ${player.name}`}>
      {failed ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{failed}</p>
      ) : !link ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Send this link to the player. They choose a password, then log in with their mobile number to see their own stats, tournaments and next
            matches. The link works once and expires in 7 days. If they forget their password, just send a new link.
          </p>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2">
            <span className="min-w-0 flex-1 truncate text-sm text-slate-600">{link}</span>
            <Button
              variant="secondary"
              size="sm"
              title="Copy message"
              onClick={() => navigator.clipboard.writeText(message).then(() => toast("Copied", "success"), () => toast("Couldn't copy", "error"))}
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <a href={`https://wa.me/${mobile ? `91${mobile}` : ""}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer" className="block">
            <Button className="w-full">
              <MessageCircle className="size-4" /> Send on WhatsApp{mobile ? ` to ${phone}` : ""}
            </Button>
          </a>
        </div>
      )}
    </Modal>
  );
}
