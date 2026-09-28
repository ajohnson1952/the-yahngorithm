import Link from "next/link";
import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { Nav } from "../components/Nav";
import { BottomNav } from "../components/BottomNav";
import { PullToRefresh } from "../components/PullToRefresh";

export const metadata: Metadata = {
  title: "the yahngorithm",
  description:
    "College football model vs. market — where our numbers and the sportsbooks disagree.",
  // iOS home-screen web app: launches standalone, status bar drawn over the
  // (dark) top bar — globals.css pads .topbar by safe-area-inset-top for it.
  appleWebApp: {
    capable: true,
    title: "yahngorithm",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0e14",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Cloudflare Web Analytics — cookieless page views. Only injected when
  // CF_BEACON_TOKEN is set in the env (so: prod only, no rebuild to toggle).
  const cfBeacon = process.env.CF_BEACON_TOKEN;

  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="wrap topbar-inner">
            <Link href="/" className="brand">
              <img className="brand-avatar" src="/joe.png" alt="" />
              the yahngorithm
            </Link>
            <Nav />
          </div>
        </header>
        <main className="wrap">{children}</main>
        <BottomNav />
        <PullToRefresh />
        <Analytics />
        {cfBeacon && (
          <script
            type="module"
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({ token: cfBeacon })}
          />
        )}
      </body>
    </html>
  );
}
