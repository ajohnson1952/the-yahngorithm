// ============================================================
// Neon usage snapshot  —  npm run neon-usage
// ============================================================
// Prints compute / data-transfer / storage for the current billing
// period against the FREE-tier caps, with a straight-line projection to
// period end. Use it to decide whether this project can move back to the
// free plan (see docs/STATUS.md — we moved to Launch only because of the
// Sept transfer-leak bug).
//
// Needs NEON_API_KEY in .env (personal key from
// https://console.neon.tech/app/settings/api-keys). Read-only — never
// changes any setting. Not part of the pipeline.
// ============================================================

const API = "https://console.neon.tech/api/v2";
const PROJECT_ID = process.env.NEON_PROJECT_ID ?? "dawn-block-29232776"; // the-yahngorithm

// Neon Free plan allowances (per project / month). Transfer cap per the
// Sept 2026 incident; the others from neon.com/faqs/free-plan-limits-and-quotas.
const FREE = { computeCuH: 100, transferGB: 5, storageGB: 0.5 };

const GB = 1024 ** 3;

async function neon<T>(path: string): Promise<T> {
  const key = process.env.NEON_API_KEY;
  if (!key) {
    console.error("Missing NEON_API_KEY in .env. Add a personal key from");
    console.error("https://console.neon.tech/app/settings/api-keys");
    process.exit(1);
  }
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error(`Neon API ${res.status}: ${(body as { message?: string }).message ?? res.statusText}`);
    process.exit(1);
  }
  return body as T;
}

interface Project {
  name: string;
  synthetic_storage_size?: number;
  compute_time_seconds?: number;
  active_time_seconds?: number;
  data_transfer_bytes?: number;
  consumption_period_start?: string;
  consumption_period_end?: string;
}

const bar = (frac: number, width = 24) => {
  const n = Math.max(0, Math.min(width, Math.round(frac * width)));
  return "█".repeat(n) + "·".repeat(width - n);
};

const flag = (frac: number) =>
  frac > 1 ? "OVER ⚠" : frac > 0.7 ? "watch" : "ok";

function row(label: string, used: number, projected: number | null, cap: number, unit: string) {
  const fracProj = (projected ?? used) / cap;
  const fmt = (n: number) => n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0);
  const projStr =
    projected == null ? "current" : `proj ~${fmt(projected)}/mo`;
  console.log(
    `  ${label.padEnd(9)} ${`${fmt(used).padStart(6)} / ${cap} ${unit}`.padEnd(19)} ` +
      `${projStr.padEnd(16)} ${bar(fracProj)} ${(100 * fracProj).toFixed(0).padStart(3)}%  ${flag(fracProj)}`
  );
}

async function main() {
  const { project: p } = await neon<{ project: Project }>(`/projects/${PROJECT_ID}`);

  const start = new Date(p.consumption_period_start ?? 0);
  const end = new Date(p.consumption_period_end ?? 0);
  const now = new Date();
  const elapsedD = (now.getTime() - start.getTime()) / 86_400_000;
  const totalD = (end.getTime() - start.getTime()) / 86_400_000;
  const scale = elapsedD > 0.05 ? totalD / elapsedD : null; // avoid wild early extrapolation

  const computeCuH = (p.compute_time_seconds ?? 0) / 3600;
  const activeH = (p.active_time_seconds ?? 0) / 3600;
  const transferGB = (p.data_transfer_bytes ?? 0) / GB;
  const storageGB = (p.synthetic_storage_size ?? 0) / GB;

  console.log(`\nNeon usage — ${p.name}`);
  console.log(
    `period  ${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}   ` +
      `(${elapsedD.toFixed(1)} of ${totalD.toFixed(0)} days, ${((elapsedD / totalD) * 100).toFixed(0)}% in)\n`
  );

  row("compute", computeCuH, scale ? computeCuH * scale : null, FREE.computeCuH, "CU-h");
  row("transfer", transferGB, scale ? transferGB * scale : null, FREE.transferGB, "GB");
  row("storage", storageGB, null, FREE.storageGB, "GB");

  console.log(
    `\n  compute active ${activeH.toFixed(1)}h wall-clock` +
      (activeH > 0 ? ` (avg ${(computeCuH / activeH).toFixed(2)} CU)` : "")
  );
  console.log(
    `  projection is a straight line from ${elapsedD.toFixed(1)} days — ` +
      `noisy early, and skewed by any heavy manual runs.\n`
  );
}

main();
