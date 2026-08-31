// ============================================================
// Geography + timezone helpers (for the 'travel' situational flag)
// ============================================================

const EARTH_RADIUS_MI = 3958.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in miles between two lat/lng points. */
export function haversineMiles(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_MI * 2 * Math.asin(Math.sqrt(s));
}

/**
 * UTC offset in hours for an IANA timezone at a given instant (handles DST).
 * e.g. tzOffsetHours("America/New_York", <Sept date>) -> -4
 */
export function tzOffsetHours(timeZone: string, at: Date): number | null {
  try {
    const s = at.toLocaleString("en-US", { timeZone, timeZoneName: "shortOffset" });
    const m = s.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
    if (!m) return null;
    const hours = Number(m[1]);
    const mins = m[2] ? Number(m[2]) : 0;
    return hours + (Math.sign(hours) || 1) * (mins / 60);
  } catch {
    return null;
  }
}

/**
 * Body-clock timezone shift a team feels playing away: (venue offset) - (home
 * offset). Positive = playing east of home ("earlier" body clock, e.g. a west-
 * coast team at noon ET feels like 9am). Returns 0 if either zone is unknown.
 */
export function tzShift(
  homeTimeZone: string | null,
  venueTimeZone: string | null,
  at: Date
): number {
  if (!homeTimeZone || !venueTimeZone) return 0;
  const home = tzOffsetHours(homeTimeZone, at);
  const venue = tzOffsetHours(venueTimeZone, at);
  if (home == null || venue == null) return 0;
  return venue - home;
}
