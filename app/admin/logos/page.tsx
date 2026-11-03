import Link from "next/link";
import { isAdmin } from "../../../lib/adminAuth";
import { db } from "../../../lib/db";
import { LoginForm } from "../../rankings/LoginForm";
import { LogoPicker, type LogoTeam } from "./LogoPicker";

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
    light: t.logoLight,
    dark: t.logoDark,
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
        on the board, game pages and rankings here, and on Cavepicks within
        about 15 minutes.
      </p>
      <LogoPicker teams={teams} />
    </>
  );
}
