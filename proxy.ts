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

export function proxy(req: NextRequest) {
  const hasCookie = !!req.cookies.get(COOKIE)?.value;

  // Cookie check for the DB-costly pages. Crawlers walking game pages
  // overnight were waking Neon dozens of times a night (~2/3 of compute on
  // the Free plan) — most bots don't keep cookies, browsers do. A cookieless
  // request gets the cookie + one redirect back to itself; a browser returns
  // with it (one extra hop on a first-ever visit), a bot comes back without
  // it and gets a tiny 403 that never touches the DB.
  if (costly(req)) {
    const url = req.nextUrl.clone();
    if (!hasCookie) {
      if (url.searchParams.has(WALL_PARAM)) {
        return new NextResponse("Cookies are required to view this page.", {
          status: 403,
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        });
      }
      url.searchParams.set(WALL_PARAM, "1");
      const res = NextResponse.redirect(url, 307);
      res.cookies.set(COOKIE, crypto.randomUUID(), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: ONE_YEAR,
      });
      return res;
    }
    if (url.searchParams.has(WALL_PARAM)) {
      // passed the check — drop the marker so the address bar stays clean
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
