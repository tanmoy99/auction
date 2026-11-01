"use client";
import Link from "next/link";
import { Button } from "./ui";
export function ResourceError({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-12 text-center">
      <h1 className="text-xl font-semibold">Unable to show this page</h1>
      <p role="alert" className="text-slate-600">
        {message}
      </p>
      <div className="flex justify-center gap-3">
        {retry && <Button onClick={retry}>Retry</Button>}
        <Link href="/" className="rounded-lg border border-slate-200 px-4 py-2 text-sm">
          Back to CricMitra
        </Link>
      </div>
    </div>
  );
}
