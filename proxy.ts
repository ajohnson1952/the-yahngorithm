import { NextResponse, type NextRequest } from "next/server";

// Next 16 "proxy" (formerly middleware). Give every visitor a stable anonymous
// id in a first-party cookie. Pins (and any future per-visitor state) are keyed
// on it — no accounts, no PII, just "this browser". Set once, left for a year.
const COOKIE = "yahn_uid";
const ONE_YEAR = 60 * 60 * 24 * 365;

export function proxy(req: NextRequest) {
  if (req.cookies.get(COOKIE)?.value) return NextResponse.next();

  const uid = crypto.randomUUID();
  // Make it visible to the current render too, not just subsequent requests.
  req.cookies.set(COOKIE, uid);
  const res = NextResponse.next({ request: { headers: req.headers } });
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
