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
