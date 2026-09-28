import type { MetadataRoute } from "next";

// Web app manifest — lets "Add to Home Screen" launch the site standalone
// (no Safari chrome). iOS takes its icon from app/apple-icon.png (Next emits
// the <link rel="apple-touch-icon"> automatically); these icons are for
// Android / desktop installs. Regenerate from public/joe.png on the #161a2a
// sky color if the avatar ever changes.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "the yahngorithm",
    short_name: "yahngorithm",
    description:
      "College football model vs. market — where our numbers and the sportsbooks disagree.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0b0e14",
    theme_color: "#0b0e14",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
