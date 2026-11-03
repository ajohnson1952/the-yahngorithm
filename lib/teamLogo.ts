// Which logo the site shows for a team. ESPN/CFBD publish two: a standard one
// and a "dark background" one. The dark one rescues navy/black logos (Akron,
// Utah State...) but turns plenty of others plain white, so it's a per-team
// choice, made by hand at /admin/logos and saved as Team.logoPref.

export type LogoChoice = "light" | "dark";

export function teamLogo(t: {
  logoLight: string | null;
  logoDark: string | null;
  logoPref: string | null;
}): string | null {
  return t.logoPref === "dark" ? (t.logoDark ?? t.logoLight) : (t.logoLight ?? t.logoDark);
}

/** The ESPN team id inside a CFBD/ESPN logo link (".../500/2006.png" -> 2006).
 *  Cavepicks stores ESPN logo links, so this id is how it matches teams. */
export function logoEspnId(url: string | null): number | null {
  const m = url?.match(/\/(\d+)\.png/);
  return m ? Number(m[1]) : null;
}
