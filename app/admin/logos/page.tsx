import Link from "next/link";
import { isAdmin } from "../../../lib/adminAuth";
import { db } from "../../../lib/db";
import { LoginForm } from "../../cfb/rankings/LoginForm";
import { LogoPicker, type LogoTeam } from "./LogoPicker";
import { espnLogo } from "../../../lib/teamLogo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Logos · Admin · the yahngorithm" };

export default async function LogosPage() {
  if (!(await isAdmin())) {
    return (
      <>
        <h1>Logos</h1>
        <p className="subhead">Password required.</p>
        <LoginForm />
      </>
    );
  }

  const rows = await db.team.findMany({
    where: { OR: [{ logoLight: { not: null } }, { logoDark: { not: null } }] },
    select: {
      id: true,
      canonicalName: true,
      conference: true,
      classification: true,
      logoLight: true,
      logoDark: true,
      logoPref: true,
    },
    orderBy: { canonicalName: "asc" },
  });

  const teams: LogoTeam[] = rows.map((t) => ({
    id: t.id,
    name: t.canonicalName,
    group: t.classification === "fbs" ? (t.conference ?? "Other FBS") : "FCS & other divisions",
    light: espnLogo(t.logoLight),
    dark: espnLogo(t.logoDark),
    choice: t.logoPref === "dark" ? "dark" : "light",
  }));

  return (
    <>
      <p className="lp-back">
        <Link href="/admin">← Admin</Link>
      </p>
      <h1>Logos</h1>
      <p className="subhead">
        Each team has two logos: the standard one, and a version made for dark
        backgrounds. Tap whichever looks better. It saves right away and shows
        on the board, game pages and rankings here. Cavepicks keeps its own
        built-in copy: after changing picks, run{" "}
        <code>npm run sync-logos</code> in the Cavepicks project and push it
        (or ask Claude to).
      </p>
      <LogoPicker teams={teams} />
    </>
  );
}
