/** @type {import('next').NextConfig} */
const nextConfig = {
  // team logos are small remote PNGs from CFBD's CDN, rendered with plain <img>
  agentRules: false,

  // /admin's "Run" buttons (app/admin/actions.ts) spawn pipeline scripts as
  // child processes via `execFile(tsx, [scriptPath])` — file paths built at
  // runtime, not static imports. Next's build-time file tracer can't see
  // those references, so it prunes tsx (and everything the scripts need)
  // out of the serverless function bundle entirely. Confirmed live on
  // Vercel: "spawn /var/task/node_modules/.bin/tsx ENOENT". This forces
  // those files back into the /admin function's bundle. (Never an issue on
  // Render — a persistent VM just has the whole repo on disk.)
  outputFileTracingIncludes: {
    "/admin": [
      "./node_modules/.bin/tsx",
      "./node_modules/tsx/**",
      "./node_modules/esbuild/**",
      "./node_modules/@esbuild/**",
      "./node_modules/.prisma/**",
      "./node_modules/@prisma/**",
      "./scripts/**",
      "./lib/**",
      "./prisma/schema.prisma",
      "./package.json",
      "./tsconfig.json",
    ],
  },

  // CFB moved under /cfb (Nov 2026) so CBB can live at /cbb. Old links keep
  // working: permanent redirects (query strings like ?week= carry over). "/"
  // is temporary (307) because it may become a sport picker later.
  async redirects() {
    const moved = ["game", "picks", "grades", "guide", "lab", "rankings", "watch", "watch-timeline"];
    return [
      { source: "/", destination: "/cfb", permanent: false },
      ...moved.flatMap((p) => [
        { source: `/${p}`, destination: `/cfb/${p}`, permanent: true },
        { source: `/${p}/:path*`, destination: `/cfb/${p}/:path*`, permanent: true },
      ]),
    ];
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
