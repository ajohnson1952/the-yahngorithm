import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "../components/Nav";

export const metadata: Metadata = {
  title: "the yahngorithm",
  description:
    "College football model vs. market — where our numbers and the sportsbooks disagree.",
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
            <a href="/" className="brand">
              <img className="brand-avatar" src="/joe.png" alt="" />
              the yahngorithm
            </a>
            <Nav />
          </div>
        </header>
        <main className="wrap">{children}</main>
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
