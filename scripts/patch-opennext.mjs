// Runs after `npm install` (locally and in Cloudflare's build).
//
// @opennextjs/cloudflare inlines Next's server manifests into the Worker, but
// its file list predates Next 16.4's `preview-props.json`, so every dynamic
// route crashes with "Unexpected loadManifest(/.next/server/preview-props.json)".
// Add the file to the list until the adapter ships the fix. Idempotent.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const file = "node_modules/@opennextjs/cloudflare/dist/cli/build/patches/plugins/load-manifest.js";
if (!existsSync(file)) process.exit(0);

const src = readFileSync(file, "utf8");
const before = "{*-manifest,required-server-files,prefetch-hints}.json";
const after = "{*-manifest,required-server-files,prefetch-hints,preview-props}.json";

if (src.includes(after)) {
  console.log("[patch-opennext] already applied");
} else if (src.includes(before)) {
  writeFileSync(file, src.replace(before, after));
  console.log("[patch-opennext] added preview-props.json to inlined manifests");
} else {
  console.warn("[patch-opennext] pattern not found — the adapter changed; check if the fix is still needed");
}
