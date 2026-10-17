/**
 * Project email ("Studio" layout): every prod has its own link, nothing email
 * clients strip (script / audio / svg), the tracking pixel only in the sent copy,
 * and the size stays under Gmail's ~100 KB clipping limit.
 *
 *   npx tsx scripts/test-email.ts
 */
import { renderProjectEmail, type EmailTrack } from "../src/lib/email/template";
import { durationText, keyText, MAX_EMAIL_TRACKS, waveHeights } from "../src/lib/email/studio-template";

let failures = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || extra === undefined ? "" : ` → ${JSON.stringify(extra)}`}`);
}

const peaks = Array.from({ length: 800 }, (_, i) => Math.abs(Math.sin(i / 7)) * (0.3 + (i % 13) / 20));
const tracks: EmailTrack[] = Array.from({ length: 15 }, (_, n) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  title: `Prod <${n}> & co`,
  bpm: 140 + n,
  key: "D# minor",
  duration: 180 + n,
  peaks,
  coverUrl: `https://create.example/api/p/tok/cover?track=${n}`,
  playUrl: `https://create.example/l/abc?t=${n}`,
}));
const base = {
  projectName: "Werenoi",
  trackCount: tracks.length,
  trackTitles: tracks.map((t) => t.title),
  message: "Salut,\n\nJe t'envoie quelques nouvelles prods.",
  signature: "Merci pour ton écoute.",
  instagram: "@waz_prod",
  senderName: "Waz",
  listenUrl: "https://create.example/l/abc",
  coverUrl: "https://create.example/api/p/tok/cover",
  tracks,
};
const sent = renderProjectEmail({ ...base, trackingPixelUrl: "https://create.example/api/t/o/abc" });
const archived = renderProjectEmail(base);

check("Studio is the default layout", sent.html.includes("Écoute en haute qualité"));
check("under Gmail's clipping limit (15 prods with waveforms)", sent.html.length < 95_000, sent.html.length);
check(`at most ${MAX_EMAIL_TRACKS} prod rows, the rest as a link`, sent.html.includes("+ 3 autres prods"));
check(
  "each shown prod has its own ▶ link",
  tracks.slice(0, MAX_EMAIL_TRACKS).every((t) => sent.html.includes(`href="${t.playUrl}"`)),
);
check("no script, audio or svg (stripped by mail clients)", !/<script|<audio|<svg|<video/i.test(sent.html));
check("titles are escaped", sent.html.includes("Prod &lt;0&gt; &amp; co") && !sent.html.includes("Prod <0>"));
check(
  "tracking pixel in the sent copy only",
  sent.html.includes("/api/t/o/abc") && !archived.html.includes("/api/t/o/"),
);
check(
  "text version lists every shown prod link",
  tracks.slice(0, MAX_EMAIL_TRACKS).every((t) => sent.text.includes(t.playUrl)),
);
check("Instagram in the footer", sent.html.includes("instagram.com/waz_prod/"));
check("key label", keyText("D# minor") === "D# MIN" && keyText("C major") === "C MAJ" && keyText(null) === null);
check("duration label", durationText(192) === "3:12" && durationText(null) === null);
const wave = waveHeights(peaks, "x");
check(
  "waveform from real peaks: 30 bars within 2–26 px",
  wave.length === 30 && wave.every((h) => h >= 2 && h <= 26),
  wave,
);
check("neutral waveform when peaks are missing", waveHeights(null, "x").length === 30);
const simple = renderProjectEmail({ ...base, design: { layout: "simple" } });
check(
  "Simple layout still available",
  !simple.html.includes("Écoute en haute qualité") && simple.html.includes("Werenoi"),
);

console.log(failures ? `\n${failures} check(s) failed` : "\nAll email checks passed");
process.exit(failures ? 1 : 0);
