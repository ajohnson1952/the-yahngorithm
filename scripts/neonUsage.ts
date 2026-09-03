// ============================================================
// Neon usage snapshot  —  npm run neon-usage
// ============================================================
// Prints compute / data-transfer / storage for the current billing
// period against the FREE-tier caps, with a straight-line projection to
// period end. Use it to decide whether this project can move back to the
// free plan (see docs/STATUS.md — we moved to Launch only because of the
// Sept transfer-leak bug). Same data feeds the /admin panel.
//
// Needs NEON_API_KEY in .env. Read-only. Not part of the pipeline.
// ============================================================

import { fetchNeonProjectUsage, type NeonMetric } from "../lib/neonUsage";

const bar = (frac: number, width = 24) => {
  const n = Math.max(0, Math.min(width, Math.round(frac * width)));
  return "█".repeat(n) + "·".repeat(width - n);
};
const flag = (frac: number) => (frac > 1 ? "OVER ⚠" : frac > 0.7 ? "watch" : "ok");
const fmt = (n: number) => n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0);

function row(label: string, m: NeonMetric) {
  const frac = (m.projected ?? m.used) / m.cap;
  const proj = m.projected == null ? "current" : `proj ~${fmt(m.projected)}/mo`;
  console.log(
    `  ${label.padEnd(9)} ${`${fmt(m.used).padStart(6)} / ${m.cap} ${m.unit}`.padEnd(19)} ` +
      `${proj.padEnd(16)} ${bar(frac)} ${(100 * frac).toFixed(0).padStart(3)}%  ${flag(frac)}`
  );
}

async function main() {
  const u = await fetchNeonProjectUsage();
  if (!u.configured) {
    console.error("NEON_API_KEY not set in .env — https://console.neon.tech/app/settings/api-keys");
    process.exit(1);
  }
  if (u.error) {
    console.error(`Neon API error: ${u.error}`);
    process.exit(1);
  }

  console.log(`\nNeon usage — ${u.projectName}`);
  console.log(
    `period  ${u.periodStart!.slice(0, 10)} → ${u.periodEnd!.slice(0, 10)}   ` +
      `(${u.daysElapsed} of ${u.daysTotal} days, ${Math.round((u.daysElapsed! / u.daysTotal!) * 100)}% in)\n`
  );

  row("compute", u.compute!);
  row("transfer", u.transfer!);
  row("storage", u.storage!);

  console.log(
    `\n  compute active ${u.compute!.activeHours}h wall-clock (avg ${u.compute!.avgCu} CU)`
  );
  console.log(
    `  projection is a straight line from ${u.daysElapsed} days — noisy early, ` +
      `and skewed by heavy manual runs.\n`
  );
}

main();
