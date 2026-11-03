// Which logo the site shows for a team. ESPN/CFBD publish two: a standard one
// and a "dark background" one. The dark one rescues navy/black logos (Akron,
// Utah State...) but turns plenty of others plain white, so it's a per-team
// choice, made by hand at /admin/logos and saved as Team.logoPref.

export type LogoChoice = "light" | "dark";

/** Cache tag for the dark-logo list Cavepicks reads (/api/logo-picks). */
export const LOGO_PICKS_TAG = "logo-picks";

export function teamLogo(t: {
  logoLight: string | null;
  logoDark: string | null;
  logoPref: string | null;
}): string | null {
  return espnLogo(t.logoPref === "dark" ? (t.logoDark ?? t.logoLight) : (t.logoLight ?? t.logoDark));
}

/** CFBD hosts copies of ESPN's logos under the same team ids, but a few copies
 *  are out of date (Nov 2026: Mississippi State still had the old banner M,
 *  plus LIU and East Texas A&M). Cavepicks loads ESPN's own files, so serve
 *  those here too: both sites then always show the same, current logo. */
export function espnLogo(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/^https:\/\/cdn\.collegefootballdata\.com\/(logos|logos-dark)\/500\/(\d+)\.png$/);
  if (!m) return url;
  return `https://a.espncdn.com/i/teamlogos/ncaa/${m[1] === "logos-dark" ? "500-dark" : "500"}/${m[2]}.png`;
}

/** The ESPN team id inside a CFBD/ESPN logo link (".../500/2006.png" -> 2006).
 *  Cavepicks stores ESPN logo links, so this id is how it matches teams. */
export function logoEspnId(url: string | null): number | null {
  const m = url?.match(/\/(\d+)\.png/);
  return m ? Number(m[1]) : null;
}
