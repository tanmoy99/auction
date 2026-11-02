"use client";

import { useState } from "react";
import type { Scoreboard } from "./scorecard";
import { Card, cn } from "./ui";
import { WagonWheel } from "./wagon-wheel";

// a narrow drawing keeps the axis text readable on phones; it scales up on wider screens
const W = 460;
const H = 250;
const PAD = { l: 30, r: 8, t: 14, b: 30 };
const FALLBACK = ["#059669", "#f59e0b", "#0ea5e9", "#e11d48"];

// Overs bowled so far in each innings, with runs and wickets per over
function seriesOf(board: Scoreboard) {
  const used = new Set<string>();
  return board.state.innings.map((inn, i) => {
    const team = board.team(inn.batting_team);
    let color = team?.color ?? FALLBACK[i]!;
    // two sides with the same colour would be impossible to tell apart
    if (used.has(color.toLowerCase())) color = FALLBACK.find((c) => !used.has(c)) ?? FALLBACK[i]!;
    used.add(color.toLowerCase());
    const overs = inn.over_stats.filter((o, n) => n < inn.over_stats.length - 1 || inn.overs[n]?.length);
    return { label: team?.short_name || team?.name || `Innings ${i + 1}`, color, overs };
  });
}

function niceMax(n: number) {
  const steps = [6, 10, 12, 15, 20, 24, 30, 40, 50, 60, 80, 100, 120, 150, 200, 250, 300, 400, 500];
  return steps.find((s) => s >= n) ?? Math.ceil(n / 100) * 100;
}

// bars sit in the middle of each over; the worm line has its points at the end of each over
function Axes({ maxY, overs, ticks, centred }: { maxY: number; overs: number; ticks: number; centred: boolean }) {
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / maxY);
  const x = (o: number) => PAD.l + ((W - PAD.l - PAD.r) * o) / Math.max(overs, 1);
  const every = overs <= 12 ? 1 : overs <= 25 ? 2 : overs <= 60 ? 5 : 10;
  return (
    <g className="text-slate-400" fontSize="11" fill="currentColor">
      {Array.from({ length: ticks + 1 }, (_, i) => (maxY * i) / ticks).map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={v ? 0.25 : 0.6} />
          <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end">
            {Math.round(v)}
          </text>
        </g>
      ))}
      {Array.from({ length: overs }, (_, i) => i + 1)
        .filter((o) => o % every === 0 || o === 1)
        .map((o) => (
          <text key={o} x={x(centred ? o - 0.5 : o)} y={H - PAD.b + 14} textAnchor="middle">
            {o}
          </text>
        ))}
      <text x={W - PAD.r} y={H - 2} textAnchor="end">
        Overs
      </text>
    </g>
  );
}

function Manhattan({ series }: { series: ReturnType<typeof seriesOf> }) {
  const overs = Math.max(...series.map((s) => s.overs.length), 1);
  const maxY = niceMax(Math.max(...series.flatMap((s) => s.overs.map((o) => o.runs)), 6));
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const slot = plotW / overs;
  const bar = Math.min((slot * 0.8) / series.length, 18);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Runs per over">
      <Axes maxY={maxY} overs={overs} ticks={maxY <= 12 ? maxY / 2 : 4} centred />
      {series.map((s, si) =>
        s.overs.map((o, i) => {
          const h = (plotH * o.runs) / maxY;
          const x = PAD.l + slot * i + (slot - bar * series.length) / 2 + bar * si;
          const top = PAD.t + plotH - h;
          return (
            <g key={`${si}-${i}`}>
              <rect x={x} y={top} width={Math.max(bar - 1, 1)} height={h} rx={1.5} fill={s.color}>
                <title>{`${s.label} · over ${i + 1}: ${o.runs} run${o.runs === 1 ? "" : "s"}${o.wickets ? `, ${o.wickets} wkt` : ""}`}</title>
              </rect>
              {Array.from({ length: o.wickets }, (_, w) => (
                <circle key={w} cx={x + bar / 2 - 0.5} cy={top - 5 - w * 8} r={3.2} fill="#e11d48" stroke="white" strokeWidth={1} />
              ))}
            </g>
          );
        }),
      )}
    </svg>
  );
}

function Worm({ series }: { series: ReturnType<typeof seriesOf> }) {
  const overs = Math.max(...series.map((s) => s.overs.length), 1);
  const totals = series.map((s) => s.overs.reduce((t, o) => t + o.runs, 0));
  const maxY = niceMax(Math.max(...totals, 10));
  const x = (o: number) => PAD.l + ((W - PAD.l - PAD.r) * o) / overs;
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / maxY);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Cumulative runs">
      <Axes maxY={maxY} overs={overs} ticks={4} centred={false} />
      {series.map((s, si) => {
        let run = 0;
        const pts = [{ o: 0, r: 0, w: 0 }, ...s.overs.map((o, i) => ({ o: i + 1, r: (run += o.runs), w: o.wickets }))];
        return (
          <g key={si}>
            <polyline points={pts.map((p) => `${x(p.o)},${y(p.r)}`).join(" ")} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" />
            {pts
              .filter((p) => p.w)
              .map((p) => (
                <circle key={p.o} cx={x(p.o)} cy={y(p.r)} r={4} fill="#e11d48" stroke="white" strokeWidth={1.2}>
                  <title>{`${s.label}: ${p.r} after ${p.o} overs, ${p.w} wkt in the over`}</title>
                </circle>
              ))}
          </g>
        );
      })}
    </svg>
  );
}

type Tab = "manhattan" | "worm" | "wagon wheel";

// Manhattan (runs per over) and worm (runs over time) for limited overs, and the wagon wheel when the scorer recorded shot directions
export function MatchCharts({ board }: { board: Scoreboard }) {
  const [picked, setTab] = useState<Tab | null>(null);
  const [wheelInnings, setWheelInnings] = useState<number | null>(null);
  const series = seriesOf(board);
  const overCharts = board.rules.format !== "test" && series.some((s) => s.overs.some((o) => o.runs || o.wickets));
  const withShots = board.state.innings.map((inn, i) => ({ inn, i })).filter((x) => x.inn.shots.length);
  const tabs: Tab[] = [...(overCharts ? (["manhattan", "worm"] as const) : []), ...(withShots.length ? (["wagon wheel"] as const) : [])];
  if (!tabs.length) return null;
  const tab = picked && tabs.includes(picked) ? picked : tabs[0]!;
  const wheel = withShots.find((x) => x.i === wheelInnings) ?? withShots.at(-1);
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 text-sm">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn("rounded-md px-3 py-1 font-medium capitalize", tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === "wagon wheel" ? (
          withShots.length > 1 && (
            <div className="flex gap-1 text-xs">
              {withShots.map(({ inn, i }) => (
                <button
                  key={i}
                  onClick={() => setWheelInnings(i)}
                  className={cn("rounded-md px-2 py-1 font-medium", wheel?.i === i ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600")}
                >
                  {board.team(inn.batting_team)?.short_name || board.team(inn.batting_team)?.name}
                  {board.rules.format === "test" ? ` (${i + 1})` : ""}
                </button>
              ))}
            </div>
          )
        ) : (
          <div className="flex flex-wrap justify-end gap-3 text-xs text-slate-600">
            {series.map((s) => (
              <span key={s.label} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm" style={{ background: s.color }} /> {s.label}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-rose-600" /> Wicket
            </span>
          </div>
        )}
      </div>
      <div className="px-2 py-3">
        {tab === "wagon wheel" && wheel ? (
          <div className="px-2">
            <WagonWheel key={wheel.i} inn={wheel.inn} name={board.name} />
          </div>
        ) : (
          <>
            {tab === "manhattan" ? <Manhattan series={series} /> : <Worm series={series} />}
            <p className="mt-1 px-2 text-xs text-slate-500">
              {tab === "manhattan" ? "Runs scored in each over. Red dots are wickets." : "Total runs after each over. Red dots mark overs where wickets fell."}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
