"use client";

import { AlertTriangle, FileSpreadsheet, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/input";
import {
  detectColumns,
  guessEmailColumn,
  looksLikeHeader,
  parseArtistRows,
  type ParseResult,
} from "@/lib/artists/parse";
import { importArtists } from "@/lib/data/artists";
import { hasType } from "@/lib/dnd";
import type { Artist } from "@/lib/types";
import { cn, errorMessage } from "@/lib/utils";

export const SPREADSHEET_ACCEPT =
  ".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv";

type Sheet = { name: string; rows: unknown[][] };

/** Reads every sheet of an .xlsx / .xls / .csv file as rows of cells (in the browser). */
async function readSpreadsheet(file: File): Promise<Sheet[]> {
  const XLSX = await import("xlsx");
  const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
  const wb = isCsv
    ? XLSX.read(await file.text(), { type: "string" })
    : XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils
      .sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: "", raw: false })
      .filter((r) => r.some((c) => String(c ?? "").trim())),
  })).filter((s) => s.rows.length);
}

const colLabel = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `C${i + 1}`);

export function ImportArtistsDialog({ existing, onClose }: { existing: Artist[]; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [hasHeader, setHasHeader] = useState(true);
  const [cols, setCols] = useState<{ name: number; email: number }>({ name: -1, email: -1 });
  const [autoDetected, setAutoDetected] = useState(true);
  const [mode, setMode] = useState<"keep" | "update">("keep");
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [over, setOver] = useState(false);

  const sheet = sheets[sheetIndex] ?? null;

  /** Header + column detection for a sheet; falls back to guessing from the data. */
  const detect = (s: Sheet) => {
    const header = looksLikeHeader(s.rows[0] ?? []);
    let c = header ? detectColumns(s.rows[0]) : { name: -1, email: -1 };
    const data = header ? s.rows.slice(1) : s.rows;
    if (c.email < 0) c = { ...c, email: guessEmailColumn(data) };
    if (c.name < 0 && c.email >= 0) {
      const width = Math.max(...s.rows.map((r) => r.length));
      const other = Array.from({ length: width }, (_, i) => i).find((i) => i !== c.email);
      c = { ...c, name: other ?? -1 };
    }
    setHasHeader(header);
    setCols(c);
    setAutoDetected(header && detectColumns(s.rows[0]).name >= 0 && detectColumns(s.rows[0]).email >= 0);
  };

  const load = async (f: File) => {
    if (!/\.(xlsx|xls|csv)$/i.test(f.name)) {
      toast.error("Choisis un fichier .xlsx, .xls ou .csv");
      return;
    }
    setReading(true);
    try {
      const all = await readSpreadsheet(f);
      if (!all.length) throw new Error("Le fichier est vide.");
      // Prefer the sheet where an email column is found.
      const best = Math.max(
        0,
        all.findIndex((s) => guessEmailColumn(s.rows) >= 0),
      );
      setFile(f);
      setSheets(all);
      setSheetIndex(best);
      detect(all[best]);
    } catch (e) {
      toast.error("Lecture impossible", { description: errorMessage(e) });
    } finally {
      setReading(false);
    }
  };

  const result: ParseResult | null = useMemo(() => {
    if (!sheet || cols.email < 0) return null;
    return parseArtistRows(hasHeader ? sheet.rows.slice(1) : sheet.rows, cols.name, cols.email, hasHeader ? 2 : 1);
  }, [sheet, cols, hasHeader]);

  const existingByEmail = useMemo(() => new Map(existing.map((a) => [a.email, a])), [existing]);
  const known = result?.entries.filter((e) => existingByEmail.has(e.email)) ?? [];
  const renamed = known.filter((e) => existingByEmail.get(e.email)!.artist_name !== e.artist_name);
  const fresh = (result?.entries.length ?? 0) - known.length;
  const willWrite = fresh + (mode === "update" ? renamed.length : 0);

  const confirmImport = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const todo = result.entries.filter(
        (e) => !existingByEmail.has(e.email) || (mode === "update" && renamed.includes(e)),
      );
      await importArtists(todo, mode);
      toast.success(
        [
          fresh ? `${fresh} artiste${fresh > 1 ? "s" : ""} ajouté${fresh > 1 ? "s" : ""}` : null,
          mode === "update" && renamed.length ? `${renamed.length} mis à jour` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "Rien de nouveau à importer",
      );
      onClose();
    } catch (e) {
      toast.error("Importation impossible", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const width = sheet ? Math.max(...sheet.rows.slice(0, 50).map((r) => r.length)) : 0;
  const colOptions = Array.from({ length: width }, (_, i) => ({
    i,
    label: `${colLabel(i)}${hasHeader && sheet ? ` — ${String(sheet.rows[0][i] ?? "").slice(0, 30)}` : ""}`,
  }));

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      wide
      title="Importer des artistes"
      description="Fichier .xlsx, .xls ou .csv avec une colonne nom et une colonne e-mail."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button
            variant="primary"
            onClick={() => void confirmImport()}
            disabled={!result || !willWrite}
            loading={saving}
          >
            Confirmer l’importation{willWrite ? ` (${willWrite})` : ""}
          </Button>
        </>
      }
    >
      {!file ? (
        <label
          onDragOver={(e) => {
            if (!hasType(e, "Files")) return;
            e.preventDefault();
            e.stopPropagation();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            if (!hasType(e, "Files")) return;
            e.preventDefault();
            e.stopPropagation();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (f) void load(f);
          }}
          className={cn(
            "border-line-strong hover:bg-hover flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
            over && "border-accent bg-accent/5",
          )}
        >
          {reading ? (
            <span className="text-muted text-[13px]">Lecture du fichier…</span>
          ) : (
            <>
              <Upload className="text-accent size-6" />
              <span className="text-[13.5px] font-medium">Choisir ou déposer un fichier Excel</span>
              <span className="text-faint text-xs">
                Colonnes reconnues : Artiste / Nom / Artist et Email / E-mail / Mail
              </span>
            </>
          )}
          <input
            type="file"
            accept={SPREADSHEET_ACCEPT}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void load(f);
              e.target.value = "";
            }}
          />
        </label>
      ) : (
        <div className="space-y-4">
          <div className="border-line flex items-center gap-2.5 rounded-lg border px-3 py-2">
            <FileSpreadsheet className="text-ok size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-[13px]">{file.name}</span>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                setSheets([]);
              }}
              className="text-muted hover:text-fg text-xs"
            >
              Changer
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {sheets.length > 1 ? (
              <div>
                <Label>Feuille</Label>
                <select
                  value={sheetIndex}
                  onChange={(e) => {
                    const i = Number(e.target.value);
                    setSheetIndex(i);
                    detect(sheets[i]);
                  }}
                  className="border-line bg-raised h-9 w-full rounded-lg border px-2 text-[13px] outline-none"
                >
                  {sheets.map((s, i) => (
                    <option key={s.name} value={i}>
                      {s.name} ({s.rows.length} lignes)
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div>
              <Label>Colonne du nom</Label>
              <select
                value={cols.name}
                onChange={(e) => setCols((c) => ({ ...c, name: Number(e.target.value) }))}
                className="border-line bg-raised h-9 w-full rounded-lg border px-2 text-[13px] outline-none"
              >
                <option value={-1}>— Aucune —</option>
                {colOptions.map((o) => (
                  <option key={o.i} value={o.i}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Colonne de l’e-mail</Label>
              <select
                value={cols.email}
                onChange={(e) => setCols((c) => ({ ...c, email: Number(e.target.value) }))}
                className={cn(
                  "border-line bg-raised h-9 w-full rounded-lg border px-2 text-[13px] outline-none",
                  cols.email < 0 && "border-danger/60",
                )}
              >
                <option value={-1}>— Choisir —</option>
                {colOptions.map((o) => (
                  <option key={o.i} value={o.i}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="text-muted flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
            La première ligne contient les titres des colonnes
          </label>
          {!autoDetected ? (
            <p className="text-accent flex items-start gap-1.5 text-xs">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Colonnes non reconnues automatiquement : vérifie la colonne du nom et celle de l’e-mail.
            </p>
          ) : null}

          {result ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Lignes détectées" value={result.rows} />
                <Stat label="Adresses valides" value={result.entries.length} />
                <Stat label="Nouvelles" value={fresh} accent />
                <Stat label="Déjà dans ta base" value={known.length} />
              </div>

              {result.merged ? (
                <p className="text-muted text-xs">
                  {result.merged} adresse{result.merged > 1 ? "s" : ""} en double dans le fichier (même contact pour
                  plusieurs artistes) : gardée{result.merged > 1 ? "s" : ""} une seule fois, avec tous les noms.
                </p>
              ) : null}

              {result.invalid.length ? (
                <details className="border-danger/30 bg-danger/5 rounded-lg border px-3 py-2 text-xs">
                  <summary className="text-danger cursor-pointer">
                    {result.invalid.length} valeur{result.invalid.length > 1 ? "s" : ""} ignorée
                    {result.invalid.length > 1 ? "s" : ""} (adresse invalide ou absente)
                  </summary>
                  <ul className="text-muted mt-1.5 max-h-32 space-y-0.5 overflow-y-auto">
                    {result.invalid.map((v, i) => (
                      <li key={i}>
                        Ligne {v.row} · {v.name || "sans nom"} : <span className="font-mono">{v.value}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {renamed.length ? (
                <div className="border-line rounded-lg border px-3 py-2.5">
                  <p className="text-[13px]">
                    {renamed.length} adresse{renamed.length > 1 ? "s" : ""} déjà enregistrée
                    {renamed.length > 1 ? "s" : ""} avec un autre nom :
                  </p>
                  <ul className="text-muted mt-1.5 max-h-28 space-y-0.5 overflow-y-auto text-xs">
                    {renamed.slice(0, 100).map((e) => (
                      <li key={e.email} className="truncate">
                        <span className="font-mono">{e.email}</span> : {existingByEmail.get(e.email)!.artist_name} →{" "}
                        <span className="text-fg">{e.artist_name}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex flex-wrap gap-4 text-[13px]">
                    <label className="flex items-center gap-2">
                      <input type="radio" checked={mode === "keep"} onChange={() => setMode("keep")} />
                      Conserver les fiches existantes
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="radio" checked={mode === "update"} onChange={() => setMode("update")} />
                      Mettre à jour avec le fichier
                    </label>
                  </div>
                </div>
              ) : null}

              <div>
                <p className="text-faint mb-1.5 text-[11px] tracking-wider uppercase">Aperçu</p>
                <div className="border-line max-h-60 overflow-y-auto rounded-lg border">
                  <table className="w-full text-left text-[12.5px]">
                    <thead className="bg-panel text-faint sticky top-0">
                      <tr>
                        <th className="px-3 py-1.5 font-medium">Nom de l’artiste</th>
                        <th className="px-3 py-1.5 font-medium">E-mail</th>
                        <th className="px-3 py-1.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-line divide-y">
                      {result.entries.slice(0, 100).map((e) => (
                        <tr key={e.email}>
                          <td className="max-w-48 truncate px-3 py-1.5">{e.artist_name}</td>
                          <td className="text-muted max-w-56 truncate px-3 py-1.5 font-mono text-[11.5px]">
                            {e.email}
                          </td>
                          <td className="text-faint px-3 py-1.5 text-right text-[11px] whitespace-nowrap">
                            {existingByEmail.has(e.email) ? "Existant" : "Nouveau"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {result.entries.length > 100 ? (
                  <p className="text-faint mt-1 text-xs">… et {result.entries.length - 100} autres.</p>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-muted text-[13px]">Choisis la colonne qui contient les adresses e-mail.</p>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="border-line bg-panel rounded-lg border px-3 py-2">
      <p className={cn("text-lg font-semibold tabular-nums", accent && "text-accent")}>{value}</p>
      <p className="text-faint text-[11px]">{label}</p>
    </div>
  );
}
