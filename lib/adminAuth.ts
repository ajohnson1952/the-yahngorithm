import { cookies } from "next/headers";

// Simple password gate for the admin / rankings pages. Not real auth —
// a shared secret for a personal tool. Set ADMIN_PASSWORD in the env to
// override the default.
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "2142";
export const ADMIN_COOKIE = "yahn_admin";

/** value we store in the cookie — derived, so it isn't the raw password */
export function adminToken(): string {
  return Buffer.from(`yahn:${ADMIN_PASSWORD}`).toString("base64");
}

export async function isAdmin(): Promise<boolean> {
  const c = await cookies();
  return c.get(ADMIN_COOKIE)?.value === adminToken();
}
