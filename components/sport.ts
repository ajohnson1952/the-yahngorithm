// Which sport a URL belongs to. CFB lives under /cfb, CBB under /cbb;
// shared pages (/admin, ...) count as CFB for nav purposes.
export type Sport = "cfb" | "cbb";
export const sportOf = (path: string): Sport => (path.startsWith("/cbb") ? "cbb" : "cfb");
export const SPORT_HOME: Record<Sport, string> = { cfb: "/cfb", cbb: "/cbb" };
