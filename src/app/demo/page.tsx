"use client";
import Link from "next/link";
import { useState } from "react";
import { AuctionDemo, ScoringDemo, TableDemo } from "@/components/landing";
import { Button, Card, Modal } from "@/components/ui";
export default function Demo() {
  const [tab, setTab] = useState("Fixtures");
  const [open, setOpen] = useState(false);
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <Link href="/" className="text-emerald-700">
        ← CricMitra
      </Link>
      <div>
        <p className="text-sm font-semibold text-emerald-700">Interactive demo · fictional data</p>
        <h1 className="text-3xl font-bold">Riverside Community Cup</h1>
        <p className="mt-2 text-slate-600">
          Four neighbourhood teams. T20 cricket at Riverside Ground. Explore the tournament without creating an account.
        </p>
      </div>
      <nav className="flex flex-wrap gap-2" aria-label="Demo sections">
        {["Fixtures", "Auction", "Scoring", "Points"].map((name) => (
          <Button key={name} variant={tab === name ? "primary" : "secondary"} onClick={() => setTab(name)}>
            {name}
          </Button>
        ))}
      </nav>
      {tab === "Fixtures" && (
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            ["Riverside Royals", "Market Street Mavericks", "Royals won by 18 runs", "162/6 · 144/9"],
            ["Hillview Hawks", "Lakeside Lions", "Lions won by 4 wickets", "138/8 · 139/6"],
            ["Riverside Royals", "Lakeside Lions", "Final · Sunday, 3 pm", "Teams ready"],
          ].map(([a, b, result, score]) => (
            <Card key={a + b} className="space-y-2 p-5">
              <p className="font-semibold">
                {a} v {b}
              </p>
              <p>{score}</p>
              <p className="text-sm text-emerald-700">{result}</p>
            </Card>
          ))}
        </div>
      )}
      {tab === "Auction" && <AuctionDemo />}
      {tab === "Scoring" && <ScoringDemo />}
      {tab === "Points" && <TableDemo />}
      <Button variant="secondary" onClick={() => setOpen(true)}>
        About this demo
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="A safe place to explore">
        <p>
          These simulations run only in this browser. They do not submit registrations, bids or scoring changes to any real tournament.
          Reload to start again.
        </p>
      </Modal>
    </main>
  );
}
