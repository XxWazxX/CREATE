import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components is off: its render staging relies on Node's setTimeout
  // semantics and hangs on Cloudflare Workers (workerd). The app doesn't need
  // it — library data is fetched in the browser, share pages render per request.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
