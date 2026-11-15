// Builds public/create.ico (desktop shortcut icon) from src/app/icon.svg, the app logo.
// One 256 px PNG entry, like the SOCIAL BEATS icon: Windows scales it to every size and
// Explorer displays it reliably (multi-size DIB entries showed up blank on the desktop).
// Usage: node scripts/make-icon.mjs
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const svg = readFileSync(new URL("../src/app/icon.svg", import.meta.url));
const png = await sharp(svg, { density: 1152 }).resize(256, 256).png().toBuffer();

const head = Buffer.alloc(6 + 16);
head.writeUInt16LE(0, 0); // reserved
head.writeUInt16LE(1, 2); // type: icon
head.writeUInt16LE(1, 4); // one image
head[6] = 0; // width 256
head[7] = 0; // height 256
head.writeUInt16LE(1, 10); // planes
head.writeUInt16LE(32, 12); // bits per pixel
head.writeUInt32LE(png.length, 14);
head.writeUInt32LE(head.length, 18);
writeFileSync(new URL("../public/create.ico", import.meta.url), Buffer.concat([head, png]));
console.log("public/create.ico updated");
