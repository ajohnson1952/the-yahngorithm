// npm run cfbd-usage - CFBD's own meter read before/after each tick (see
// scripts/tick.ts). "tick" = calls CFBD billed during the tick, "counted" =
// what our scripts reported, "between" = calls billed since the previous tick
// ended (nothing of ours should be calling then). Times in Central.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
type Row = { t: string; before: number; after: number; counted: number; steps: string[] };
(async () => {
  const row = await prisma.meta.findUnique({ where: { key: "cfbdUsageLog" } });
  const log = (row?.value as Row[] | null) ?? [];
  const ct = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  let tick = 0, counted = 0, between = 0;
  console.log("when            tick  counted  between  steps");
  log.forEach((e, i) => {
    const prev = log[i - 1];
    // the meter resets on the 1st, so a drop is a new month, not negative use
    const gap = prev && e.before >= prev.after ? e.before - prev.after : 0;
    const used = e.after - e.before;
    tick += used; counted += e.counted; between += gap;
    const flag = used !== e.counted || gap > 0 ? "  <--" : "";
    console.log(`${ct(e.t).padEnd(14)}  ${String(used).padStart(4)}  ${String(e.counted).padStart(7)}  ${String(gap).padStart(7)}  ${e.steps.join(" ")}${flag}`);
  });
  console.log(`\n${log.length} ticks: ${tick} billed in ticks (${counted} counted), ${between} billed between ticks`);
  await prisma.$disconnect();
})();
