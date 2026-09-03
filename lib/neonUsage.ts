// ============================================================
// Neon project usage — compute / transfer / storage for the
// current billing period, from the Neon API.
// ============================================================
// Read-only. Used by `npm run neon-usage` (CLI) and the /admin panel
// (via getNeonUsage in webData.ts). Not touched by the pipeline.
//
// Needs NEON_API_KEY (personal key, https://console.neon.tech/app/settings/api-keys)
// — in .env locally, and in the Render service env for the /admin panel.
// ============================================================

const API = "https://console.neon.tech/api/v2";
const PROJECT_ID = process.env.NEON_PROJECT_ID ?? "dawn-block-29232776"; // the-yahngorithm

/** Neon Free plan allowances (per project / month). Transfer cap per the
 *  Sept 2026 incident; compute/storage from Neon's free-plan FAQ. */
export const NEON_FREE = { computeCuH: 100, transferGB: 5, storageGB: 0.5 } as const;

const GB = 1024 ** 3;

export interface NeonMetric {
  used: number;
  cap: number;
  /** straight-line projection to period end; null very early in the period */
  projected: number | null;
  unit: "CU-h" | "GB";
}

export interface NeonUsageView {
  configured: boolean;
  error?: string;
  fetchedAt: string;
  projectName?: string;
  periodStart?: string; // ISO
  periodEnd?: string; // ISO
  daysElapsed?: number;
  daysTotal?: number;
  compute?: NeonMetric & { activeHours: number; avgCu: number };
  transfer?: NeonMetric;
  storage?: NeonMetric; // `projected` always null — it's a current size, not accrued
}

interface NeonProject {
  name?: string;
  synthetic_storage_size?: number;
  compute_time_seconds?: number;
  active_time_seconds?: number;
  data_transfer_bytes?: number;
  consumption_period_start?: string;
  consumption_period_end?: string;
}

export async function fetchNeonProjectUsage(): Promise<NeonUsageView> {
  const fetchedAt = new Date().toISOString();
  const key = process.env.NEON_API_KEY;
  if (!key) return { configured: false, fetchedAt };

  let p: NeonProject;
  try {
    const res = await fetch(`${API}/projects/${PROJECT_ID}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json();
    if (!res.ok) {
      return {
        configured: true,
        fetchedAt,
        error: (body as { message?: string }).message ?? `HTTP ${res.status}`,
      };
    }
    p = (body as { project: NeonProject }).project;
  } catch (e) {
    return { configured: true, fetchedAt, error: (e as Error).message };
  }

  const start = new Date(p.consumption_period_start ?? 0);
  const end = new Date(p.consumption_period_end ?? 0);
  const now = Date.now();
  const daysElapsed = (now - start.getTime()) / 86_400_000;
  const daysTotal = (end.getTime() - start.getTime()) / 86_400_000;
  // don't extrapolate wildly in the first hour of the period
  const scale = daysElapsed > 0.05 && daysTotal > 0 ? daysTotal / daysElapsed : null;
  const project = (v: number) => (scale ? Math.round(v * scale * 100) / 100 : null);

  const computeCuH = (p.compute_time_seconds ?? 0) / 3600;
  const activeHours = (p.active_time_seconds ?? 0) / 3600;
  const transferGB = (p.data_transfer_bytes ?? 0) / GB;
  const storageGB = (p.synthetic_storage_size ?? 0) / GB;

  return {
    configured: true,
    fetchedAt,
    projectName: p.name,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    daysElapsed: Math.round(daysElapsed * 10) / 10,
    daysTotal: Math.round(daysTotal),
    compute: {
      used: Math.round(computeCuH * 100) / 100,
      cap: NEON_FREE.computeCuH,
      projected: project(computeCuH),
      unit: "CU-h",
      activeHours: Math.round(activeHours * 10) / 10,
      avgCu: activeHours > 0 ? Math.round((computeCuH / activeHours) * 100) / 100 : 0,
    },
    transfer: {
      used: Math.round(transferGB * 100) / 100,
      cap: NEON_FREE.transferGB,
      projected: project(transferGB),
      unit: "GB",
    },
    storage: {
      used: Math.round(storageGB * 1000) / 1000,
      cap: NEON_FREE.storageGB,
      projected: null,
      unit: "GB",
    },
  };
}
