/**
 * Artist import: turns spreadsheet rows (name + email columns) into clean
 * address-book entries. Pure functions — shared by the import dialog and tests.
 *
 * One entry per email: a cell holding several addresses ("a@x.com; b@y.com")
 * gives several entries with the same artist name, and an address listed for
 * several artists (a shared manager, a label) is kept once with all the names.
 */

/** Same rule as the database check (supabase/migrations/0003_artists.sql). */
export const ARTIST_EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;

export const MAX_NAME_LENGTH = 200;

export type ArtistEntry = { artist_name: string; email: string };

export type ParseResult = {
  entries: ArtistEntry[];
  /** Data rows read (header excluded, empty rows skipped). */
  rows: number;
  /** Values found in the email column that aren't valid addresses. */
  invalid: { row: number; name: string; value: string }[];
  /** Addresses listed more than once in the file (merged into one entry). */
  merged: number;
  /** Rows with an email but no name (the address is used as the name). */
  unnamed: number;
};

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const NAME_HEADER = /^(nom|name|artiste?s?|artist|rappeur|rapper|chanteur|chanteuse|beatmaker|contact)( |$)/;
const EMAIL_HEADER = /(^| )(e ?mails?|mails?|courriel|adresse e ?mail|adresse mail)( |$)/;

/** Finds the name and email columns from a header row; -1 when not recognised. */
export function detectColumns(header: unknown[]): { name: number; email: number } {
  const cells = header.map((c) => fold(String(c ?? "")));
  const email = cells.findIndex((c) => EMAIL_HEADER.test(c));
  const name = cells.findIndex((c, i) => i !== email && NAME_HEADER.test(c));
  return { name, email };
}

/** True when the first row looks like column titles rather than data. */
export function looksLikeHeader(row: unknown[]): boolean {
  const { name, email } = detectColumns(row);
  return (name >= 0 || email >= 0) && !row.some((c) => ARTIST_EMAIL_RE.test(String(c ?? "").trim()));
}

/** Guesses the email column from the data when there is no recognisable header. */
export function guessEmailColumn(rows: unknown[][]): number {
  const width = Math.max(0, ...rows.map((r) => r.length));
  let best = -1;
  let bestHits = 0;
  for (let c = 0; c < width; c++) {
    const hits = rows.filter((r) => splitEmails(String(r[c] ?? "")).some((e) => ARTIST_EMAIL_RE.test(e))).length;
    if (hits > bestHits) {
      best = c;
      bestHits = hits;
    }
  }
  return best;
}

export function splitEmails(cell: string): string[] {
  return cell
    .split(/[;,\s]+/)
    .map((s) =>
      s
        .trim()
        .replace(/^mailto:/i, "")
        .replace(/^[<("']+|[>)"'.]+$/g, ""),
    )
    .filter(Boolean);
}

export function cleanName(v: unknown): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

/** Joins names for one shared address: "Kodak Black / Rick Ross", without repeats. */
export function mergeNames(names: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names.flatMap((x) => x.split(" / "))) {
    const k = n.trim().toLowerCase();
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(n.trim());
    }
  }
  return out.join(" / ").slice(0, MAX_NAME_LENGTH);
}

export function parseArtistRows(dataRows: unknown[][], nameCol: number, emailCol: number, firstRow = 2): ParseResult {
  const byEmail = new Map<string, string[]>();
  const invalid: ParseResult["invalid"] = [];
  let rows = 0;
  let merged = 0;
  let unnamed = 0;

  dataRows.forEach((r, i) => {
    const name = nameCol >= 0 ? cleanName(r[nameCol]) : "";
    const cell = String(r[emailCol] ?? "").trim();
    if (!name && !cell) return;
    rows++;
    for (const raw of splitEmails(cell)) {
      if (!ARTIST_EMAIL_RE.test(raw) || raw.length > 254) {
        invalid.push({ row: i + firstRow, name, value: raw });
        continue;
      }
      const email = raw.toLowerCase();
      if (!name) unnamed++;
      const names = byEmail.get(email);
      if (names) {
        merged++;
        names.push(name || email);
      } else byEmail.set(email, [name || email]);
    }
    if (!cell) invalid.push({ row: i + firstRow, name, value: "(aucune adresse)" });
  });

  const entries = [...byEmail].map(([email, names]) => ({ email, artist_name: mergeNames(names) }));
  return { entries, rows, invalid, merged, unnamed };
}
