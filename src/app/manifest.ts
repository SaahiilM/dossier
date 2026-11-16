import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Dossier · Job search",
    short_name: "Dossier",
    description: "Your job search, on your server.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f2ed",
    theme_color: "#eeebe4",
    icons: [
      { src: "/dossier-192.png", sizes: "192x192", type: "image/png" },
      { src: "/dossier-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
