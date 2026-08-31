import { cookies } from "next/headers";
import { createHash, timingSafeEqual } from "crypto";

// Simple password gate for the admin / rankings pages. Not a full auth
// system — a shared secret for a personal tool — but hardened enough that
// the cookie can't be reversed into the password and (if ADMIN_SESSION_SECRET
// is set) can't be forged even by someone who knows the password.
//
// Set BOTH in the deploy env:
//   ADMIN_PASSWORD        — a real password, NOT the "2142" default
//   ADMIN_SESSION_SECRET  — a long random string (e.g. `openssl rand -hex 32`)
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "2142";
export const ADMIN_COOKIE = "yahn_admin";

const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || "";

/** Opaque cookie value — a one-way hash, so it never contains the password
 *  and (with ADMIN_SESSION_SECRET set) can't be recomputed off-box. */
export function adminToken(): string {
  return createHash("sha256")
    .update(`yahn:v2:${ADMIN_PASSWORD}:${SESSION_SECRET}`)
    .digest("hex");
}

/** constant-time string compare (avoids leaking length/prefix via timing) */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function isAdmin(): Promise<boolean> {
  const c = await cookies();
  const v = c.get(ADMIN_COOKIE)?.value;
  return v != null && safeEqual(v, adminToken());
}
