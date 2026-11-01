"use client";
import { useState } from "react";
import { Button, Modal } from "./ui";
import { publicShareUrl, qrSvg } from "@/lib/qr";
export function QrShare({ path, label = "Share QR" }: { path: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          try {
            const link = publicShareUrl(window.location.origin, path);
            setUrl(link);
            setSvg(qrSvg(link));
            setError("");
            setOpen(true);
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        {label}
      </Button>
      {error && (
        <p role="status" className="text-sm">
          {error}
        </p>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Share public link">
        {/* The SVG is generated locally from the displayed destination. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
          alt="QR code for the public link below"
          className="mx-auto w-64 max-w-full"
        />
        <a href={url} className="my-4 block break-all text-sm text-emerald-700 underline">
          {url}
        </a>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setError("Link copied");
              } catch {
                setError("Copy the displayed link manually");
              }
            }}
          >
            Copy link
          </Button>
          <a href={`data:image/svg+xml,${encodeURIComponent(svg)}`} download="cricmitra-qr.svg">
            <Button variant="secondary">Download QR</Button>
          </a>
        </div>
      </Modal>
    </>
  );
}
