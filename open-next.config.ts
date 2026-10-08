import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// The app never revalidates server-rendered data (library data is fetched in
// the browser, share pages are rendered per request), so prerendered shells
// are served straight from Workers static assets — no R2/KV needed.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
