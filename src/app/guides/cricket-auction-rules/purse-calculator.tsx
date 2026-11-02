"use client";

import { useState } from "react";
import { bidStep, rupees } from "@/lib/format";
import type { Slab } from "@/lib/types";

// Same default ladder as a new CricMitra tournament
const SLABS: Slab[] = [
  { upto: 5000, step: 500 },
  { upto: 20000, step: 1000 },
  { upto: null, step: 2000 },
];

function Num({ label, value, onChange, hint }: { label: string; value: number; onChange: (n: number) => void; hint?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 focus:outline-none"
      />
      {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function PurseCalculator() {
  const [purse, setPurse] = useState(100000);
  const [base, setBase] = useState(500);
  const [minSquad, setMinSquad] = useState(11);
  const [bought, setBought] = useState(4);
  const [spent, setSpent] = useState(38000);

  const left = Math.max(purse - spent, 0);
  const stillNeeded = Math.max(minSquad - bought, 0);
  // money kept back for the other players still needed after this one
  const reserve = Math.max(stillNeeded - 1, 0) * base;
  const maxBid = Math.max(left - reserve, 0);
  const canBid = maxBid >= base;

  const ladder: number[] = [];
  for (let b = base; ladder.length < 12; b += bidStep(SLABS, b)) ladder.push(b);

  return (
    <div className="not-prose my-6 rounded-3xl border border-emerald-200 bg-emerald-50/50 p-5 sm:p-6">
      <h3 className="text-lg font-black text-slate-900">Purse calculator: how much can a team bid?</h3>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Num label="Team purse (₹)" value={purse} onChange={setPurse} />
        <Num label="Base price (₹)" value={base} onChange={setBase} />
        <Num label="Minimum squad size" value={minSquad} onChange={setMinSquad} />
        <Num label="Players already bought" value={bought} onChange={setBought} />
        <Num label="Money already spent (₹)" value={spent} onChange={setSpent} />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs text-slate-500">Purse left</p>
          <p className="text-2xl font-black text-slate-900">{rupees(left)}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-xs text-slate-500">Must keep back</p>
          <p className="text-2xl font-black text-amber-600">{rupees(reserve)}</p>
          <p className="text-xs text-slate-500">
            {Math.max(stillNeeded - 1, 0)} more players × {rupees(base)}
          </p>
        </div>
        <div className="rounded-2xl bg-emerald-600 p-4 text-white">
          <p className="text-xs text-emerald-100">Highest bid allowed now</p>
          <p className="text-2xl font-black">{rupees(maxBid)}</p>
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-600">
        {stillNeeded === 0
          ? "The minimum squad is already complete, so the whole remaining purse can be used."
          : canBid
            ? `This team still needs ${stillNeeded} player${stillNeeded === 1 ? "" : "s"} to reach ${minSquad}, so it keeps ${rupees(reserve)} back for the others.`
            : "This team cannot afford a player above the base price. It should only pick players at the base price until its squad is complete."}
      </p>
      <div className="mt-5">
        <p className="text-sm font-medium text-slate-700">Bid ladder from {rupees(base)} (default increments)</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ladder.map((b) => (
            <span key={b} className="rounded-full bg-white px-2.5 py-1 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
              {rupees(b)}
            </span>
          ))}
          <span className="px-1 py-1 text-sm text-slate-500">…</span>
        </div>
      </div>
    </div>
  );
}
