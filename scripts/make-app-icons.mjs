// Home-screen icons (iPhone / Android) from the app logo: full-bleed black square,
// the phone rounds the corners itself. Usage: node scripts/make-app-icons.mjs
import { readFileSync } from "node:fs";
import sharp from "sharp";

const logo = readFileSync(new URL("../src/app/icon.svg", import.meta.url), "utf8");
// Same gradients and bars as the logo, without the rounded frame and its edge.
const defs = logo.match(/<defs>[\s\S]*<\/defs>/)[0];
const bars = logo.match(/<g fill="url\(#metal\)"[\s\S]*?<\/g>/)[0];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}
  <rect width="64" height="64" fill="#000000"/>
  <g transform="translate(32 32) scale(0.92) translate(-32 -32)">${bars}</g>
  <rect width="64" height="64" fill="url(#sheen)" opacity="0.7"/>
</svg>`;

const out = (p) => new URL(p, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
for (const [size, file] of [
  [180, "../src/app/apple-icon.png"],
  [192, "../public/icon-192.png"],
  [512, "../public/icon-512.png"],
]) {
  await sharp(Buffer.from(svg), { density: (72 * size) / 64 * 2 })
    .resize(size, size)
    .flatten({ background: "#000000" })
    .png()
    .toFile(out(file));
  console.log(file.replace("../", ""), size);
}
