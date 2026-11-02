"use client";

import { useState } from "react";

type Format = "single" | "double" | "groups" | "knockout";

const FORMATS: { id: Format; label: string }[] = [
  { id: "single", label: "League (play once)" },
  { id: "double", label: "League (play twice)" },
  { id: "groups", label: "2 groups + semis & final" },
  { id: "knockout", label: "Straight knockout" },
];

const PLAYOFFS = [
  { matches: 0, label: "No playoffs" },
  { matches: 1, label: "Final only" },
  { matches: 3, label: "Semi-finals + final" },
  { matches: 4, label: "IPL-style playoffs" },
];

function matchesFor(format: Format, teams: number, playoffs: number) {
  const league = (n: number) => (n * (n - 1)) / 2;
  if (format === "single") return league(teams) + playoffs;
  if (format === "double") return 2 * league(teams) + playoffs;
  if (format === "groups") return league(Math.ceil(teams / 2)) + league(Math.floor(teams / 2)) + 3;
  return Math.max(teams - 1, 0);
}

export function MatchCounter() {
  const [teams, setTeams] = useState(8);
  const [format, setFormat] = useState<Format>("single");
  const [playoffs, setPlayoffs] = useState(4);
  const [perDay, setPerDay] = useState(4);
  const total = matchesFor(format, teams, playoffs);
  const days = perDay > 0 ? Math.ceil(total / perDay) : 0;
  const league = format === "single" || format === "double";

  return (
    <div className="not-prose my-6 rounded-3xl border border-emerald-200 bg-emerald-50/50 p-5 sm:p-6">
      <h3 className="text-lg font-black text-slate-900">How many matches will my tournament need?</h3>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Number of teams</span>
          <input
            type="number"
            min={2}
            max={32}
            value={teams}
            onChange={(e) => setTeams(Math.min(32, Math.max(2, Math.floor(Number(e.target.value) || 2))))}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Matches the ground can hold per day</span>
          <input
            type="number"
            min={1}
            max={12}
            value={perDay}
            onChange={(e) => setPerDay(Math.min(12, Math.max(1, Math.floor(Number(e.target.value) || 1))))}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Format</span>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as Format)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 focus:border-emerald-500 focus:outline-none"
          >
            {FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        {league && (
          <label className="block">
            <span className="text-sm font-medium text-slate-700">After the league</span>
            <select
              value={playoffs}
              onChange={(e) => setPlayoffs(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 focus:border-emerald-500 focus:outline-none"
            >
              {PLAYOFFS.map((p) => (
                <option key={p.label} value={p.matches}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-emerald-600 p-4 text-white">
          <p className="text-xs text-emerald-100">Total matches</p>
          <p className="text-3xl font-black">{total}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs text-slate-500">Match days needed</p>
          <p className="text-3xl font-black text-slate-900">{days}</p>
          <p className="text-xs text-slate-500">at {perDay} matches a day</p>
        </div>
      </div>
    </div>
  );
}
