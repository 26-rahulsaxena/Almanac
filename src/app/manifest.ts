import type { MetadataRoute } from "next";

// Makes Almanac installable (Add to Home Screen). iPhone only allows push notifications for installed apps.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Almanac",
    short_name: "Almanac",
    description: "Your Google Calendar, on one page.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f1ea",
    theme_color: "#1d1b18",
    icons: [
      { src: "/icon/small", sizes: "192x192", type: "image/png" },
      { src: "/icon/large", sizes: "512x512", type: "image/png" },
    ],
  };
}
