// Builds public/create.ico (desktop shortcut icon) from src/app/icon.svg, the app logo.
// Usage: node scripts/make-icon.mjs
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const svg = readFileSync(new URL("../src/app/icon.svg", import.meta.url));
const sizes = [256, 48, 32, 16];

const entries = [];
for (const s of sizes) {
  const img = sharp(svg, { density: Math.max(72, (72 * s) / 64) * 4 }).resize(s, s);
  if (s >= 256) {
    entries.push(await img.png().toBuffer());
    continue;
  }
  // Classic DIB entry (header + bottom-up BGRA + AND mask): read by every Windows component.
  const { data } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const maskRow = Math.ceil(s / 32) * 4;
  const buf = Buffer.alloc(40 + s * s * 4 + maskRow * s);
  buf.writeUInt32LE(40, 0);
  buf.writeInt32LE(s, 4);
  buf.writeInt32LE(s * 2, 8);
  buf.writeUInt16LE(1, 12);
  buf.writeUInt16LE(32, 14);
  buf.writeUInt32LE(s * s * 4, 20);
  let o = 40;
  for (let y = s - 1; y >= 0; y--) {
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      buf[o++] = data[i + 2];
      buf[o++] = data[i + 1];
      buf[o++] = data[i];
      buf[o++] = data[i + 3];
    }
  }
  entries.push(buf);
}

const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const at = 6 + 16 * i;
  head[at] = s >= 256 ? 0 : s;
  head[at + 1] = s >= 256 ? 0 : s;
  head.writeUInt16LE(1, at + 4);
  head.writeUInt16LE(32, at + 6);
  head.writeUInt32LE(entries[i].length, at + 8);
  head.writeUInt32LE(offset, at + 12);
  offset += entries[i].length;
});
writeFileSync(new URL("../public/create.ico", import.meta.url), Buffer.concat([head, ...entries]));
console.log("public/create.ico updated");
