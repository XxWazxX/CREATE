// Runs after `npm install` (locally and in Cloudflare's build). Idempotent.
//
// Two gaps in @opennextjs/cloudflare 1.20.x:
// 1. It inlines Next's server manifests into the Worker, but its file list
//    predates Next 16.4's `preview-props.json`, so every dynamic route crashes
//    with "Unexpected loadManifest(/.next/server/preview-props.json)".
// 2. Its server bundler doesn't treat Cloudflare's built-in `cloudflare:*`
//    modules (e.g. `cloudflare:sockets`, used for SMTP) as runtime externals.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

function patch(file, before, after, label) {
  if (!existsSync(file)) return;
  const src = readFileSync(file, "utf8");
  if (src.includes(after)) console.log(`[patch-opennext] ${label}: already applied`);
  else if (src.includes(before)) {
    writeFileSync(file, src.replace(before, after));
    console.log(`[patch-opennext] ${label}: applied`);
  } else console.warn(`[patch-opennext] ${label}: pattern not found — check if the fix is still needed`);
}

const base = "node_modules/@opennextjs/cloudflare/dist/cli/build";

patch(
  `${base}/patches/plugins/load-manifest.js`,
  "{*-manifest,required-server-files,prefetch-hints}.json",
  "{*-manifest,required-server-files,prefetch-hints,preview-props}.json",
  "preview-props manifest",
);

patch(
  `${base}/bundle-server.js`,
  'external: ["./middleware/handler.mjs"],',
  'external: ["./middleware/handler.mjs", "cloudflare:*"],',
  "cloudflare:* externals",
);
