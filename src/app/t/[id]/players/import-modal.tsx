"use client";

import { useState } from "react";
import type { WorkBook } from "xlsx";
import { Download, FileSpreadsheet, Link2 } from "lucide-react";
import { toast } from "@/components/toast";
import { Button, Input, Modal, cn } from "@/components/ui";
import { TEMPLATE_HEADERS, describeColumns, mapRow, type ImportedPlayer } from "@/lib/fields";
import { errorMessage, rupees } from "@/lib/format";
import { authHeader, supabase } from "@/lib/supabase";
import type { Tournament } from "@/lib/types";

const FIELD_LABELS: Record<string, string> = {
  name: "Name", phone: "Phone", role: "Role", batting_style: "Batting", bowling_style: "Bowling",
  age: "Age", city: "City", photo_url: "Photo", category: "Category", base_price: "Base price",
};

const digits = (phone: string | null) => (phone ?? "").replace(/\D/g, "").slice(-10);

export function ImportModal({
  tournament,
  existingPhones,
  onClose,
  onImported,
}: {
  tournament: Tournament;
  existingPhones: string[];
  onClose: () => void;
  onImported: () => void;
}) {
  const [mode, setMode] = useState<"file" | "sheet">("file");
  const [sheetUrl, setSheetUrl] = useState("");
  const [rows, setRows] = useState<ImportedPlayer[] | null>(null);
  const [columns, setColumns] = useState<{ header: string; field: string | null }[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [busy, setBusy] = useState(false);

  async function parseWorkbook(wb: WorkBook) {
    const XLSX = await import("xlsx");
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
    if (records.length === 0) throw new Error("The sheet is empty");
    setColumns(describeColumns(Object.keys(records[0]!)));

    const seen = new Set(existingPhones.map(digits).filter(Boolean));
    const out: ImportedPlayer[] = [];
    let dupes = 0;
    for (const record of records) {
      const p = mapRow(record);
      if (!p.name) continue;
      const key = digits(p.phone);
      if (key && seen.has(key)) {
        dupes++;
        continue;
      }
      if (key) seen.add(key);
      out.push(p);
    }
    setSkipped(dupes);
    setRows(out);
  }

  async function onFile(file: File) {
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      await parseWorkbook(XLSX.read(await file.arrayBuffer()));
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function onSheet(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/sheet?url=${encodeURIComponent(sheetUrl)}`, { headers: await authHeader() });
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      const XLSX = await import("xlsx");
      await parseWorkbook(XLSX.read(text, { type: "string" }));
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function downloadTemplate() {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([
      TEMPLATE_HEADERS,
      ["Rahul Sharma", "9876543210", "All-rounder", "Right-hand bat", "Right-arm medium", 24, "Barasat", "", "A", tournament.base_price],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Players");
    XLSX.writeFile(wb, "players-template.xlsx");
  }

  async function importRows() {
    if (!rows?.length) return;
    setBusy(true);
    try {
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const { data, error } = await supabase
          .from("players")
          .insert(
            chunk.map((p) => ({
              name: p.name,
              role: p.role,
              batting_style: p.batting_style,
              bowling_style: p.bowling_style,
              age: p.age,
              city: p.city,
              photo_url: p.photo_url,
              category: p.category,
              base_price: p.base_price ?? tournament.base_price,
              tournament_id: tournament.id,
              source: mode === "sheet" ? "google-sheet" : "excel",
            })),
          )
          .select("id");
        if (error) throw error;
        const contacts = data
          .map((d, j) => ({ player_id: d.id as string, tournament_id: tournament.id, phone: chunk[j]!.phone }))
          .filter((c) => c.phone);
        if (contacts.length) {
          const { error: contactError } = await supabase.from("player_contacts").insert(contacts);
          if (contactError) throw contactError;
        }
      }
      toast(`Imported ${rows.length} players`, "success");
      onImported();
      onClose();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Import players" wide>
      {!rows ? (
        <div className="space-y-5">
          <div className="inline-flex rounded-lg bg-slate-100 p-1 text-sm">
            {(["file", "sheet"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn("rounded-md px-3 py-1.5 font-medium", mode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}
              >
                {m === "file" ? "Excel / CSV file" : "Google Sheet link"}
              </button>
            ))}
          </div>

          {mode === "file" ? (
            <label className="flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-slate-300 px-6 py-12 text-center hover:border-emerald-400 hover:bg-emerald-50/40">
              <FileSpreadsheet className="size-10 text-emerald-600" />
              <span className="mt-3 font-medium text-slate-800">{busy ? "Reading file..." : "Choose an .xlsx, .xls or .csv file"}</span>
              <span className="mt-1 text-sm text-slate-500">First sheet is used. The first row must be the column headings.</span>
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
          ) : (
            <form onSubmit={onSheet} className="space-y-3">
              <p className="text-sm text-slate-600">
                Open your Google Form responses sheet → <b>Share</b> → set <b>Anyone with the link</b> can view → copy the link and paste it here.
              </p>
              <div className="flex gap-2">
                <Input value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." required />
                <Button type="submit" loading={busy}>
                  <Link2 className="size-4" /> Load
                </Button>
              </div>
            </form>
          )}

          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3 text-sm">
            <span className="text-slate-600">Columns like Name, Phone, Role, Batting, Bowling, Age, City, Photo are detected automatically.</span>
            <Button variant="secondary" size="sm" onClick={downloadTemplate}>
              <Download className="size-4" /> Template
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {columns.map((c) => (
              <span
                key={c.header}
                className={cn("rounded-full px-2.5 py-1 text-xs", c.field ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400 line-through")}
                title={c.field ? `Imported as ${FIELD_LABELS[c.field]}` : "Ignored"}
              >
                {c.header}
                {c.field && ` → ${FIELD_LABELS[c.field]}`}
              </span>
            ))}
          </div>
          <p className="text-sm text-slate-600">
            <b>{rows.length}</b> players ready to import
            {skipped > 0 && <> · {skipped} skipped (phone number already exists)</>}
          </p>
          <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  {["Name", "Phone", "Role", "City", "Age", "Base price"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.slice(0, 100).map((r, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 font-medium text-slate-800">{r.name}</td>
                    <td className="px-3 py-2 text-slate-600">{r.phone}</td>
                    <td className="px-3 py-2 text-slate-600">{r.role}</td>
                    <td className="px-3 py-2 text-slate-600">{r.city}</td>
                    <td className="px-3 py-2 text-slate-600">{r.age}</td>
                    <td className="px-3 py-2 text-slate-600">{rupees(r.base_price ?? tournament.base_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 100 && <p className="text-xs text-slate-500">Showing first 100 rows.</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRows(null)}>
              Back
            </Button>
            <Button onClick={importRows} loading={busy} disabled={rows.length === 0}>
              Import {rows.length} players
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
