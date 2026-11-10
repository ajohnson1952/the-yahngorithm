import Link from "next/link";
import { isAdmin } from "../../../../lib/adminAuth";
import { db } from "../../../../lib/db";
import { LoginForm } from "../../../cfb/rankings/LoginForm";
import { TeamsReview, type ReviewTeam, type Unmatched } from "./TeamsReview";

// Admin-only, and it touches the DB only after the password check, so bots
// can't wake Neon with it.
export const dynamic = "force-dynamic";
export const metadata = { title: "CBB team names · Admin · the yahngorithm" };

export default async function CbbTeamsPage() {
  if (!(await isAdmin())) {
    return (
      <>
        <h1>CBB team names</h1>
        <p className="subhead">Password required.</p>
        <LoginForm />
      </>
    );
  }

  const [teams, meta] = await Promise.all([
    // ~400 teams + ~1,500 aliases, a few columns each — small
    db.cbbTeam.findMany({
      select: {
        id: true,
        name: true,
        conference: true,
        division: true,
        aliases: { select: { id: true, source: true, alias: true, confidence: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.meta.findUnique({ where: { key: "cbbUnmatchedNames" } }),
  ]);

  const rows: ReviewTeam[] = teams.map((t) => ({
    id: t.id,
    name: t.name,
    conference: t.conference,
    d1: t.division === "d1",
    aliases: t.aliases,
  }));
  const unmatched = (meta?.value ?? {}) as Unmatched;

  return (
    <>
      <p className="lp-back">
        <Link href="/admin">← Admin</Link>
      </p>
      <h1>CBB team names</h1>
      <p className="subhead">
        How FanDuel (Odds API) and KenPom spell each team. Green = confirmed and
        used by the pipeline. Amber = a suggestion waiting for you. Nothing
        amber gets used until it&apos;s confirmed. A wrong one? Reject it, then
        fix it in <code>data/cbb/manualAliases.json</code> and rerun{" "}
        <code>npm run cbb:match-names</code> (or ask Claude).
      </p>
      <TeamsReview teams={rows} unmatched={unmatched} />
    </>
  );
}
