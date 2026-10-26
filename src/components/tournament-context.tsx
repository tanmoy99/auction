"use client";

import { createContext, useContext } from "react";
import type { useTournamentLive } from "@/lib/hooks";
import type { Tournament } from "@/lib/types";

type LiveData = ReturnType<typeof useTournamentLive> & { tournament: Tournament };

export const TournamentContext = createContext<LiveData | null>(null);

// Live tournament data for pages under /t/[id] (one shared realtime connection)
export function useTournament() {
  const value = useContext(TournamentContext);
  if (!value) throw new Error("useTournament must be used inside /t/[id]");
  return value;
}
