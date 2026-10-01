import type { MetadataRoute } from "next";

// Keep crawlers off the pages that cost a database read per URL (one per
// game, every week) and the private ones. A crawler walking ~60 game pages
// keeps Neon awake for the whole crawl — see lib/pipelineCache.ts.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: ["/game/", "/admin", "/rankings", "/api/", "/watch-timeline"] }],
  };
}
