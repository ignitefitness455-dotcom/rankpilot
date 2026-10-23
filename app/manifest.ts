import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RankPilot — AI SEO Agent",
    short_name: "RankPilot",
    description:
      "Evidence-first autonomous AI SEO Agent powered by Gemini 4 Argon for classic Google Search and AI search.",
    start_url: "/en",
    scope: "/",
    display: "standalone",
    background_color: "#0B1020",
    theme_color: "#5B4FE9",
    orientation: "portrait-primary",
    categories: ["business", "productivity", "developer tools"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
