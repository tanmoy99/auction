"use client";

import { useState } from "react";
import { ZONES, type InningsState } from "@/lib/scoring";
import { cn } from "./ui";

// Field seen from behind the batter: straight down the ground is up, off side on the right for a right-hander
const C = 100;
const R = 92;
const point = (deg: number, r: number) => [C + r * Math.sin((deg * Math.PI) / 180), C - r * Math.cos((deg * Math.PI) / 180)] as const;

function wedge(i: number, r = R) {
  const a = ZONES[i]!.angle;
  const [x1, y1] = point(a - 22.5, r);
  const [x2, y2] = point(a + 22.5, r);
  return `M${C},${C} L${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2} Z`;
}

function Ground({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <circle cx={C} cy={C} r={R} fill="#15803d" />
      <circle cx={C} cy={C} r={R * 0.55} fill="none" stroke="white" strokeOpacity={0.35} strokeDasharray="3 3" />
      {ZONES.map((z) => {
        const [x, y] = point(z.angle - 22.5, R);
        return <line key={z.label} x1={C} y1={C} x2={x} y2={y} stroke="white" strokeOpacity={0.12} />;
      })}
      <rect x={C - 4} y={C - 34} width={8} height={36} rx={1} fill="#d6c08a" />
      {children}
      <circle cx={C} cy={C} r={R} fill="none" stroke="white" strokeWidth={1.5} strokeOpacity={0.8} />
    </>
  );
}

// Scorer: tap where the shot went (or skip)
export function ZonePicker({ runs, onPick }: { runs: number; onPick: (zone: number | null) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-center text-sm text-slate-600">
        Where did the <b>{runs}</b> go? Tap the part of the field.
      </p>
      <svg viewBox="0 -10 200 210" className="mx-auto w-full max-w-xs touch-manipulation select-none" role="group" aria-label="Pick shot direction">
        <Ground>
          {ZONES.map((z, i) => {
            const [lx, ly] = point(z.angle, R * 0.72);
            return (
              <g
                key={z.label}
                role="button"
                aria-label={z.label}
                tabIndex={0}
                onClick={() => onPick(i)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPick(i)}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                className="cursor-pointer outline-none"
              >
                <path d={wedge(i)} fill={hover === i ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.001)"} stroke="white" strokeOpacity={0.5} />
                <text x={lx} y={ly + 3} textAnchor="middle" fontSize={9} fontWeight={700} fill="white" pointerEvents="none">
                  {z.label}
                </text>
              </g>
            );
          })}
        </Ground>
        <text x={C} y={-2} textAnchor="middle" fontSize={8} fill="#64748b">
          Bowler ↑
        </text>
      </svg>
      <button onClick={() => onPick(null)} className="w-full rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
        Skip
      </button>
      <p className="text-center text-xs text-slate-400">Seen from behind the batter. Names are for a right-hander.</p>
    </div>
  );
}

const LEN: Record<number, number> = { 1: 0.38, 2: 0.55, 3: 0.72, 4: 1, 5: 0.85, 6: 1.08 };
const COLOR = (runs: number) => (runs === 6 ? "#a78bfa" : runs === 4 ? "#38bdf8" : "#fde68a");

// Viewer: every scoring shot with a direction, filtered by batter
export function WagonWheel({ inn, name }: { inn: InningsState; name: (id: string) => string }) {
  const [who, setWho] = useState<string>("all");
  const batters = [...new Set(inn.shots.map((s) => s.batter))];
  const shots = who === "all" ? inn.shots : inn.shots.filter((s) => s.batter === who);
  const byZone = ZONES.map((_, i) => shots.filter((s) => s.zone === i).reduce((t, s) => t + s.runs, 0));
  const total = byZone.reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-3">
      <select
        value={who}
        onChange={(e) => setWho(e.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        aria-label="Batter"
      >
        <option value="all">All batters</option>
        {batters.map((b) => (
          <option key={b} value={b}>
            {name(b)}
          </option>
        ))}
      </select>
      <svg viewBox="-12 -12 224 224" className="mx-auto w-full max-w-sm" role="img" aria-label="Wagon wheel">
        <Ground>
          {shots.map((s, i) => {
            const z = ZONES[s.zone]!;
            // spread shots in the same part a little so they don't sit on one line
            const spread = ((i * 37) % 31) - 15;
            const [x, y] = point(z.angle + spread, R * (LEN[s.runs] ?? 0.6));
            return <line key={i} x1={C} y1={C} x2={x} y2={y} stroke={COLOR(s.runs)} strokeWidth={s.runs >= 4 ? 1.8 : 1.2} strokeLinecap="round" />;
          })}
          <circle cx={C} cy={C} r={2.5} fill="white" />
        </Ground>
        {ZONES.map((z, i) => {
          const [x, y] = point(z.angle, R + 8);
          return (
            <text key={z.label} x={x} y={y + 3} textAnchor="middle" fontSize={8.5} fontWeight={700} fill="#334155">
              {byZone[i]}
            </text>
          );
        })}
      </svg>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-slate-600">
        {[
          ["#fde68a", "1–3"],
          ["#38bdf8", "Four"],
          ["#a78bfa", "Six"],
        ].map(([c, l]) => (
          <span key={l} className="flex items-center gap-1.5">
            <span className="h-1 w-4 rounded" style={{ background: c }} /> {l}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
        {ZONES.map((z, i) => (
          <div key={z.label} className={cn("rounded-lg px-1 py-1.5", byZone[i] ? "bg-emerald-50 text-emerald-900" : "bg-slate-50 text-slate-400")}>
            <p className="font-bold tabular-nums">{byZone[i]}</p>
            <p className="truncate">{z.label}</p>
          </div>
        ))}
      </div>
      <p className="text-center text-xs text-slate-500">
        {total} runs from {shots.length} shot{shots.length === 1 ? "" : "s"} with a direction. Seen from behind the batter.
      </p>
    </div>
  );
}
