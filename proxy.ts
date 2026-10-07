import { NextResponse, type NextRequest } from "next/server";

// Next 16 "proxy" (formerly middleware). Give every visitor a stable anonymous
// id in a first-party cookie. Pins (and any future per-visitor state) are keyed
// on it — no accounts, no PII, just "this browser". Set once, left for a year.
const COOKIE = "yahn_uid";
const ONE_YEAR = 60 * 60 * 24 * 365;
const NEW_UID_HEADER = "x-yahn-new-uid"; // keep in sync with lib/visitor.ts
const WALL_PARAM = "_c"; // marks the one cookie-check hop

/** Pages whose render can miss the cache and read the DB: one cache entry per
 *  game (hundreds across a season), the rankings editor (uncached), and any
 *  board / watch URL with params (other weeks / days). The plain nav pages
 *  (/, /watch, /picks, /grades, /guide) are always served from cache and stay
 *  open to everyone. */
function costly(req: NextRequest): boolean {
  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith("/game/") || pathname.startsWith("/rankings")) return true;
  return search !== "" && ["/", "/watch", "/watch-timeline"].includes(pathname);
}

// The JS door for DB-costly pages. A request without the `yahn_ok` cookie gets
// a tiny static page whose script sets that cookie and reloads - so only a
// client that actually RUNS JavaScript ever reaches a page that can read the
// database. (The first version handed the cookie out on a redirect; crawlers
// that follow redirects and keep cookies walked straight through it - Neon
// showed game pages being rendered at 3am again.) Real browsers pass in one
// blink, once. Carries link-preview tags so a pasted game link still previews.
const OK_COOKIE = "yahn_ok";

function door(reloadTo: string | null): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>the yahngorithm</title>
<meta property="og:title" content="the yahngorithm">
<meta property="og:description" content="College football model vs. market.">
<meta name="robots" content="noindex">
<style>html,body{background:#0b0e14;color:#667085;font-family:system-ui,sans-serif;margin:0}
p{padding:40px 20px;text-align:center;font-size:14px}</style></head><body>
<p>${reloadTo ? "Loading…" : "This page needs JavaScript and cookies turned on."}</p>
${
  reloadTo
    ? `<script>document.cookie="${OK_COOKIE}=1; Max-Age=${ONE_YEAR}; Path=/; SameSite=Lax"+(location.protocol==="https:"?"; Secure":"");location.replace(${JSON.stringify(reloadTo)})</script>`
    : ""
}
</body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export function proxy(req: NextRequest) {
  const hasCookie = !!req.cookies.get(COOKIE)?.value;

  if (costly(req)) {
    const url = req.nextUrl.clone();
    if (req.cookies.get(OK_COOKIE)?.value !== "1") {
      // already sent through the door once and still no cookie: JS or cookies are off
      if (url.searchParams.has(WALL_PARAM)) return door(null);
      url.searchParams.set(WALL_PARAM, "1");
      return door(url.pathname + url.search);
    }
    if (url.searchParams.has(WALL_PARAM)) {
      // passed the door — drop the marker so the address bar stays clean
      url.searchParams.delete(WALL_PARAM);
      return NextResponse.redirect(url, 307);
    }
  }

  if (hasCookie) {
    // returning visitor — make sure a client can't spoof the "new" flag on
    if (!req.headers.has(NEW_UID_HEADER)) return NextResponse.next();
    const headers = new Headers(req.headers);
    headers.delete(NEW_UID_HEADER);
    return NextResponse.next({ request: { headers } });
  }

  const uid = crypto.randomUUID();
  // Make it visible to the current render too, not just subsequent requests.
  req.cookies.set(COOKIE, uid);
  // ...and tell the render this id was minted just now: a brand-new visitor
  // (every cookieless bot, on every hit) can't have pins, so pages skip the
  // pin lookup — and the Neon wake-up it would cost. See lib/visitor.ts.
  const headers = new Headers(req.headers);
  headers.set(NEW_UID_HEADER, "1");
  const res = NextResponse.next({ request: { headers } });
  res.cookies.set(COOKIE, uid, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR,
  });
  return res;
}

export const config = {
  // everything except Next internals and static files
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|xml)$).*)"],
};
