"use client";

import { useEffect, useRef, useState } from "react";
import { Gavel, Wifi } from "lucide-react";
import { cn } from "./ui";

// Fades its children up the first time they scroll into view
export function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const show = () => setShown(true);
    // never leave content hidden if the observer can't fire (old phones, screenshots, printing)
    if (typeof IntersectionObserver === "undefined") {
      const id = setTimeout(show, 0);
      return () => clearTimeout(id);
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          show();
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    const fallback = setTimeout(show, 4000);
    return () => {
      io.disconnect();
      clearTimeout(fallback);
    };
  }, []);
  return (
    <div ref={ref} data-shown={shown} className={cn("reveal", className)} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

// A number that counts up when it comes into view
export function CountUp({ to, prefix = "", suffix = "" }: { to: number; prefix?: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / 1400);
        setValue(Math.round(to * (1 - Math.pow(1 - t, 3))));
        if (t < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    });
    io.observe(el);
    // if the animation never runs, still end on the real number
    const fallback = setTimeout(() => setValue(to), 4000);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(fallback);
    };
  }, [to]);
  return (
    <span ref={ref} className="tabular-nums">
      {prefix}
      {value.toLocaleString("en-IN")}
      {suffix}
    </span>
  );
}

// Ticks every `ms`; the demos derive everything from this counter
function useTicker(ms: number) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return tick;
}

const DEMO_TEAMS = [
  { name: "Habra Hurricanes", short: "HAB", color: "#dc2626" },
  { name: "Barasat Bulls", short: "BAR", color: "#2563eb" },
  { name: "Kalyani Kings", short: "KAL", color: "#16a34a" },
  { name: "Naihati Ninjas", short: "NAI", color: "#9333ea" },
];
const DEMO_PLAYERS = [
  { name: "Rahul Das", role: "All-rounder", city: "Habra", initials: "RD", bids: [500, 1000, 1500, 2500, 3500], teams: [0, 1, 0, 2, 0] },
  { name: "Sourav Ghosh", role: "Bowler", city: "Barasat", initials: "SG", bids: [500, 1000, 2000, 3000], teams: [3, 1, 3, 1] },
  { name: "Imran Sheikh", role: "Batsman", city: "Kalyani", initials: "IS", bids: [500, 1500, 2000, 4000, 5000], teams: [2, 0, 2, 3, 2] },
];
const rupee = (n: number) => `₹${n.toLocaleString("en-IN")}`;

// Looping auction: bids climb across teams, the timer ring resets each bid, SOLD lands, next player
export function AuctionDemo() {
  const tick = useTicker(1100);
  const lengths = DEMO_PLAYERS.map((p) => p.bids.length + 3); // bids, then SOLD for 3 ticks
  const cycle = lengths.reduce((a, b) => a + b, 0);
  let t = tick % cycle;
  let index = 0;
  while (t >= lengths[index]!) {
    t -= lengths[index]!;
    index++;
  }
  const p = DEMO_PLAYERS[index]!;
  const sold = t >= p.bids.length;
  const bidIndex = Math.min(t, p.bids.length - 1);
  const team = DEMO_TEAMS[p.teams[bidIndex]!]!;
  const next = DEMO_PLAYERS[(index + 1) % DEMO_PLAYERS.length]!;

  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div className="absolute -inset-6 rounded-[3rem] bg-emerald-500/30 blur-3xl animate-glow" />
      <div className="relative animate-float rounded-[2.2rem] border border-white/15 bg-slate-900/90 p-3 shadow-2xl shadow-black/50 backdrop-blur">
        <div className="rounded-[1.7rem] bg-white p-4 text-slate-900">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-semibold text-slate-700">
              <span className="size-2.5 rounded-full" style={{ background: DEMO_TEAMS[0]!.color }} /> Habra Hurricanes
            </span>
            <span className="flex items-center gap-1 text-emerald-600">
              <Wifi className="size-3" /> Live
            </span>
          </div>
          <div className="mt-2 grid grid-cols-3 rounded-xl bg-slate-50 py-2 text-center">
            <Mini label="Purse" value="₹38,500" />
            <Mini label="Max bid" value="₹33,000" />
            <Mini label="Squad" value="4/15" />
          </div>

          <div key={index} className="animate-slide-up relative mt-3 overflow-hidden rounded-2xl bg-linear-to-br from-slate-900 to-slate-800 p-4 text-white">
            <div className="flex items-center gap-3">
              <span className="flex size-16 items-center justify-center rounded-2xl bg-white/10 text-xl font-black ring-2 ring-white/10">{p.initials}</span>
              <div className="min-w-0">
                <p className="truncate text-lg font-bold">{p.name}</p>
                <p className="text-xs text-white/60">
                  {p.role} · {p.city}
                </p>
                <p className="text-xs text-white/60">Base ₹500</p>
              </div>
              {!sold && <TimerRing key={`${index}-${bidIndex}`} />}
            </div>
            <div className="mt-4 flex items-end justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">{sold ? "Sold for" : "Current bid"}</p>
                <p key={`${index}-${bidIndex}`} className="animate-bump text-3xl font-black tabular-nums text-emerald-400">
                  {rupee(p.bids[bidIndex]!)}
                </p>
              </div>
              <span className="rounded-lg px-2.5 py-1 text-xs font-bold transition-colors duration-300" style={{ background: team.color }}>
                {team.short}
              </span>
            </div>
            {sold && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/40">
                <span
                  className="animate-stamp rounded-xl border-[6px] bg-slate-950/80 px-6 py-1 text-4xl font-black tracking-widest"
                  style={{ borderColor: team.color, color: team.color }}
                >
                  SOLD
                </span>
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs">
            <span className="font-semibold uppercase tracking-wide text-slate-400">Up next</span>
            <span className="truncate font-medium text-slate-700">{next.name}</span>
            <span className="ml-auto text-slate-400">{next.role}</span>
          </div>

          <button className="shine mt-3 flex h-14 w-full flex-col items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/30" tabIndex={-1}>
            <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-100">Tap to bid</span>
            <span className="text-xl font-extrabold tabular-nums">{rupee((p.bids[bidIndex] ?? 500) + 500)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-xs font-bold tabular-nums">{value}</p>
    </div>
  );
}

function TimerRing() {
  return (
    <svg viewBox="0 0 36 36" className="ml-auto size-12 shrink-0 -rotate-90">
      <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3.5" />
      <circle cx="18" cy="18" r="15" fill="none" stroke="#34d399" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="94.2" className="animate-ring" />
    </svg>
  );
}

const OVER = [
  { label: "1", kind: "run", runs: 1 },
  { label: "4", kind: "four", runs: 4 },
  { label: "•", kind: "dot", runs: 0 },
  { label: "W", kind: "wicket", runs: 0 },
  { label: "6", kind: "six", runs: 6 },
  { label: "2", kind: "run", runs: 2 },
] as const;

// Looping over: balls pop in one by one and the score climbs
export function ScoringDemo() {
  const tick = useTicker(1000);
  const shown = tick % (OVER.length + 2);
  const balls = OVER.slice(0, Math.min(shown, OVER.length));
  const runs = 64 + balls.reduce((s, b) => s + b.runs, 0);
  const wkts = 2 + balls.filter((b) => b.kind === "wicket").length;
  const ballsBowled = 42 + balls.length;
  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div className="absolute -inset-6 rounded-[3rem] bg-sky-500/20 blur-3xl animate-glow" />
      <div className="relative rounded-3xl border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-700">Kalyani Kings</span>
          <span className="flex items-center gap-1.5 rounded-full bg-rose-600 px-2.5 py-0.5 text-[11px] font-bold text-white">
            <span className="size-1.5 animate-pulse rounded-full bg-white" /> LIVE
          </span>
        </div>
        <p key={runs} className="animate-bump mt-1 text-5xl font-black tabular-nums text-slate-900">
          {runs}/{wkts}
          <span className="ml-2 text-lg font-semibold text-slate-400">
            ({Math.floor(ballsBowled / 6)}.{ballsBowled % 6})
          </span>
        </p>
        <p className="mt-1 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-800">Need {Math.max(121 - runs, 0)} from {60 - ballsBowled} balls</p>
        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">This over</p>
        <div className="mt-2 flex h-9 gap-1.5">
          {balls.map((b, i) => (
            <span
              key={`${tick - shown}-${i}`}
              className={cn(
                "animate-pop flex size-9 items-center justify-center rounded-full text-sm font-bold",
                b.kind === "wicket" && "bg-rose-600 text-white",
                b.kind === "four" && "bg-sky-600 text-white",
                b.kind === "six" && "bg-violet-600 text-white",
                b.kind === "run" && "bg-slate-200 text-slate-800",
                b.kind === "dot" && "bg-slate-100 text-slate-400",
              )}
            >
              {b.label}
            </span>
          ))}
        </div>
        <div className="mt-5 grid grid-cols-4 gap-2">
          {["•", "1", "2", "3", "4", "6", "5", "OUT"].map((k) => {
            // the button for the ball that just popped in looks pressed
            const active = shown > 0 && shown <= OVER.length && balls.at(-1)?.label === (k === "OUT" ? "W" : k);
            return (
              <span
                key={k}
                className={cn(
                  "flex h-11 items-center justify-center rounded-xl text-lg font-black transition-transform duration-200",
                  k === "4" ? "bg-sky-600 text-white" : k === "6" ? "bg-violet-600 text-white" : k === "OUT" ? "bg-rose-600 text-sm text-white" : "bg-slate-100 text-slate-700",
                  active && "scale-90 ring-4 ring-emerald-300",
                )}
              >
                {k}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Points table where a row climbs up a place every few seconds
export function TableDemo() {
  const tick = useTicker(2400);
  const swap = tick % 2 === 1;
  const rows = [
    { team: DEMO_TEAMS[0]!, p: 5, w: 4, pts: 8, nrr: "+1.240" },
    swap ? { team: DEMO_TEAMS[2]!, p: 5, w: 3, pts: 6, nrr: "+0.910" } : { team: DEMO_TEAMS[1]!, p: 5, w: 3, pts: 6, nrr: "+0.512" },
    swap ? { team: DEMO_TEAMS[1]!, p: 5, w: 3, pts: 6, nrr: "+0.512" } : { team: DEMO_TEAMS[2]!, p: 4, w: 2, pts: 4, nrr: "+0.130" },
    { team: DEMO_TEAMS[3]!, p: 5, w: 0, pts: 0, nrr: "-2.104" },
  ];
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="absolute -inset-6 rounded-[3rem] bg-amber-400/20 blur-3xl animate-glow" />
      <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <span className="text-sm font-semibold text-slate-900">Points table</span>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Top 4 → IPL playoffs</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Team</th>
              <th className="px-2 py-2 font-medium">P</th>
              <th className="px-2 py-2 font-medium">W</th>
              <th className="px-2 py-2 font-semibold text-slate-700">Pts</th>
              <th className="px-4 py-2 text-right font-medium">NRR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={r.team.short} className={cn("animate-slide-up", i < 2 && "bg-emerald-50/60")} style={{ animationDelay: `${i * 60}ms` }}>
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2 font-medium text-slate-800">
                    <span className="w-3 text-xs text-slate-400">{i + 1}</span>
                    <span className="size-2.5 rounded-full" style={{ background: r.team.color }} />
                    {r.team.name}
                  </span>
                </td>
                <td className="px-2 py-2.5 text-center tabular-nums">{r.p}</td>
                <td className="px-2 py-2.5 text-center tabular-nums">{r.w}</td>
                <td className="px-2 py-2.5 text-center font-bold tabular-nums">{r.pts}</td>
                <td className={cn("px-4 py-2.5 text-right tabular-nums", r.nrr.startsWith("+") ? "text-emerald-700" : "text-rose-600")}>{r.nrr}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 p-4 text-xs">
          {["Qualifier 1", "Eliminator"].map((name, i) => (
            <div key={name} className="rounded-xl border border-amber-200 bg-amber-50/50 p-2.5">
              <p className="font-semibold text-amber-800">{name}</p>
              <p className="mt-1 text-slate-700">{i === 0 ? "1st v 2nd" : "3rd v 4th"}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Little gavel that taps on hover, used in the final call to action
export function GavelBadge() {
  return (
    <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 transition-transform duration-300 hover:-rotate-12">
      <Gavel className="size-7" />
    </span>
  );
}
