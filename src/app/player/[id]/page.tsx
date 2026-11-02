"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { UserRound } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { CareerView, type Career } from "@/components/player-career";
import { ResourceError } from "@/components/resource-error";
import { EmptyState, PageLoader } from "@/components/ui";
import { supabase } from "@/lib/supabase";

// Public player profile: every CricMitra tournament this player has played in, with career stats
export default function PlayerProfile() {
  const { id } = useParams<{ id: string }>();
  const [career, setCareer] = useState<Career | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    const { data, error } = await supabase.rpc("player_career", { p_player: id });
    if (error) return setError("This profile couldn't be loaded. Check your connection and try again.");
    setCareer((data as Career | null) ?? null);
  }, [id]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  if (error) return <ResourceError message={error} retry={load} />;
  if (career === undefined) return <PageLoader />;
  return (
    <>
      <AppHeader />
      {career ? (
        <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-6">
          <CareerView career={career} />
        </main>
      ) : (
        <EmptyState icon={<UserRound className="size-6" />} title="Player not found" text="This profile doesn't exist, or the player hasn't been approved yet." />
      )}
    </>
  );
}
