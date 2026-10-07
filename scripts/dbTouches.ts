// npm run db-touches — what made the site read the database, newest last
// (see lib/dbTouch.ts). Times in Central.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
(async () => {
  const row = await prisma.meta.findUnique({ where: { key: "dbTouchLog" } });
  const log = (row?.value as { t: string; w: string }[] | null) ?? [];
  const ct = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  for (const e of log) console.log(ct(e.t), " ", e.w);
  console.log(`\n${log.length} entries`);
  await prisma.$disconnect();
})();
