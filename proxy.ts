import { NextResponse, type NextRequest } from "next/server";

// Next 16 "proxy" (formerly middleware). Give every visitor a stable anonymous
// id in a first-party cookie. Pins (and any future per-visitor state) are keyed
// on it — no accounts, no PII, just "this browser". Set once, left for a year.
const COOKIE = "yahn_uid";
const ONE_YEAR = 60 * 60 * 24 * 365;
const NEW_UID_HEADER = "x-yahn-new-uid"; // keep in sync with lib/visitor.ts

export function proxy(req: NextRequest) {
  if (req.cookies.get(COOKIE)?.value) {
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
