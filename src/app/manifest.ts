import type { MetadataRoute } from "next";

/** Installable app (iPhone / Android home screen): opens full screen on black. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CREATE",
    short_name: "CREATE",
    description: "Bibliothèque de beats personnelle",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
