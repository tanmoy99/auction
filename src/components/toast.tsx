"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Info, XCircle } from "lucide-react";

type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; message: string; kind: ToastKind };

const listeners = new Set<(t: ToastItem) => void>();
let nextId = 1;

export function toast(message: string, kind: ToastKind = "info") {
  const item = { id: nextId++, message, kind };
  listeners.forEach((l) => l(item));
}

const icons = {
  success: <CheckCircle2 className="size-5 text-emerald-500" />,
  error: <XCircle className="size-5 text-rose-500" />,
  info: <Info className="size-5 text-sky-500" />,
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener = (t: ToastItem) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 3500);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex max-w-md items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 shadow-lg"
        >
          {icons[t.kind]}
          <span className="pt-0.5">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
