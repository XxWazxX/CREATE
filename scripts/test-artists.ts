/**
 * Checks the artist spreadsheet parser (column detection, email splitting,
 * validation, duplicate merging).
 *
 *   npx tsx scripts/test-artists.ts [optional/path/to/file.xlsx]
 */
import * as XLSX from "xlsx";
import {
  detectColumns,
  guessEmailColumn,
  looksLikeHeader,
  mergeNames,
  parseArtistRows,
  splitEmails,
} from "../src/lib/artists/parse";

let failures = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || extra === undefined ? "" : ` → ${JSON.stringify(extra)}`}`);
}

const headers: [unknown[], { name: number; email: number }][] = [
  [["Nom de l'artiste", "E-mail"], { name: 0, email: 1 }],
  [["Artiste", "Email"], { name: 0, email: 1 }],
  [["Artist", "Mail"], { name: 0, email: 1 }],
  [["Nom", "Adresse e-mail"], { name: 0, email: 1 }],
  [["E-mail(s) de contact", "Nom du rappeur"], { name: 1, email: 0 }],
  [["Colonne A", "Colonne B"], { name: -1, email: -1 }],
];
for (const [h, want] of headers) {
  const got = detectColumns(h);
  check(`detects columns of ${JSON.stringify(h)}`, got.name === want.name && got.email === want.email, got);
}
check("header row recognised", looksLikeHeader(["Nom", "E-mail"]));
check("data row is not a header", !looksLikeHeader(["Nom", "nom@label.com"]));
check(
  "email column guessed from data",
  guessEmailColumn([
    ["A", "a@x.com"],
    ["B", "b@y.fr"],
  ]) === 1,
);
check(
  "splits several addresses in one cell",
  JSON.stringify(splitEmails("a@x.com; B@Y.com,c@z.io  <d@w.fr>")) ===
    JSON.stringify(["a@x.com", "B@Y.com", "c@z.io", "d@w.fr"]),
  splitEmails("a@x.com; B@Y.com,c@z.io  <d@w.fr>"),
);
check(
  "merges names without repeats",
  mergeNames(["Kodak Black", "Rick Ross", "kodak black"]) === "Kodak Black / Rick Ross",
);

const r = parseArtistRows(
  [
    ["Artiste A", "a@label.com; manager@agence.com"],
    ["Artiste B", "MANAGER@agence.com"],
    ["Artiste C", "pas-un-mail"],
    ["", ""],
    ["", "sansnom@x.com"],
    ["Artiste D", ""],
  ],
  0,
  1,
);
check("one entry per valid address", r.entries.length === 3, r.entries);
check(
  "shared address keeps both names, lower-cased",
  r.entries.find((e) => e.email === "manager@agence.com")?.artist_name === "Artiste A / Artiste B",
  r.entries,
);
check(
  "invalid values reported with their row",
  r.invalid.some((i) => i.value === "pas-un-mail" && i.row === 4),
  r.invalid,
);
check(
  "row without address reported",
  r.invalid.some((i) => i.name === "Artiste D"),
  r.invalid,
);
check("empty rows skipped", r.rows === 5, r.rows);
check("merged count", r.merged === 1, r.merged);
check(
  "unnamed address uses the email as name",
  r.entries.find((e) => e.email === "sansnom@x.com")?.artist_name === "sansnom@x.com",
);

const file = process.argv[2];
if (file) {
  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const cols = detectColumns(rows[0]);
  const res = parseArtistRows(rows.slice(1), cols.name, cols.email);
  console.log(`\n${file}: columns`, cols, {
    rows: res.rows,
    entries: res.entries.length,
    invalid: res.invalid.length,
    merged: res.merged,
  });
  console.log(res.invalid.map((i) => `  ligne ${i.row} ${i.name}: ${i.value}`).join("\n"));
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll artist import checks passed");
process.exit(failures ? 1 : 0);
