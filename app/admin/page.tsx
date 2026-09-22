import { isAdmin } from "../../lib/adminAuth";
import {
  getApiUsage,
  getDataFreshness,
  getNeonUsage,
  type FreshnessRow,
} from "../../lib/webData";
import type { NeonUsageView, NeonMetric } from "../../lib/neonUsage";
import { LoginForm } from "../rankings/LoginForm";
import { RUNNABLE, RUN_ALL_ORDER } from "./scripts";
import { RunPanel } from "./RunPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · the yahngorithm" };
// Without this, the /admin route (and the runScript server action it hosts —
// see actions.ts) runs on Vercel's implicit default function duration, which
// can be as short as 10s on Hobby. That's unrelated to runScript's own
// 175s execFile timeout, so Vercel could kill a still-running pipeline
// script well before the app's own timeout ever fires, surfacing an ugly
// platform-level error instead of a clean handled result. 60s is a
// conservative floor — bump it if Vercel's current plan ceiling allows more
// and a slower script (pull-advanced, run-model, a Tuesday weekly step)
// still doesn't finish in time.
export const maxDuration = 60;

function UsageBar({
  label,
  used,
  budget,
  detail,
  updatedAt,
}: {
  label: string;
  used: number;
  budget: number;
  detail: string;
  updatedAt: Date | null;
}) {
  const pct = Math.min(100, Math.round((used / budget) * 100));
  const hot = pct >= 90 ? "hot" : pct >= 70 ? "warm" : "";
  return (
    <div className="usage-row">
      <div className="usage-top">
        <span className="usage-label">{label}</span>
        <span className="usage-num mono">
          {used.toLocaleString()} / {budget.toLocaleString()}
        </span>
      </div>
      <div className="usage-track">
        <div className={`usage-fill ${hot}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="usage-detail">{detail}</div>
      <div className="usage-detail dim">
        {updatedAt
          ? `Last call ${updatedAt.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} CT.`
          : "No calls recorded yet this month."}
      </div>
    </div>
  );
}

const nfmt = (n: number) => n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0);

/** Like UsageBar, but the fill tracks the straight-line PROJECTION to period
 *  end (the "will I blow the cap" number), with the raw figure alongside it. */
function NeonBar({
  label,
  m,
  detail,
}: {
  label: string;
  m: NeonMetric;
  detail: string;
}) {
  const shown = m.projected ?? m.used;
  const raw = (shown / m.cap) * 100;
  const hot = raw >= 100 ? "hot" : raw >= 70 ? "warm" : "";
  return (
    <div className="usage-row">
      <div className="usage-top">
        <span className="usage-label">{label}</span>
        <span className="usage-num mono">
          {nfmt(m.used)}
          {m.projected != null ? ` → ~${nfmt(m.projected)}` : ""} / {m.cap} {m.unit}
        </span>
      </div>
      <div className="usage-track">
        <div
          className={`usage-fill ${hot}`}
          style={{ width: `${Math.min(100, Math.round(raw))}%` }}
        />
      </div>
      <div className="usage-detail">{detail}</div>
    </div>
  );
}

function NeonPanel({ u }: { u: NeonUsageView }) {
  if (!u.configured) {
    return (
      <div className="admin-limits">
        <strong>Neon — database host</strong>
        <p className="admin-usage-note">
          Set <span className="mono">NEON_API_KEY</span> in the Render service env
          (a personal key from console.neon.tech) to show compute / transfer /
          storage here. Works locally already via <span className="mono">.env</span>.
        </p>
      </div>
    );
  }
  if (u.error || !u.compute || !u.transfer || !u.storage) {
    return (
      <div className="admin-limits">
        <strong>Neon — database host</strong>
        <p className="admin-usage-note">
          Neon API error: {u.error ?? "no data returned"}.
        </p>
      </div>
    );
  }
  const pctIn = Math.round((u.daysElapsed! / u.daysTotal!) * 100);
  return (
    <div className="admin-limits">
      <strong>Neon — database host (bars vs Free-tier caps)</strong>
      <NeonBar
        label="Compute"
        m={u.compute}
        detail={`${u.compute.activeHours}h active this period, avg ${u.compute.avgCu} CU. Pinned min=max 0.25 CU, 5-min autosuspend.`}
      />
      <NeonBar
        label="Data transfer"
        m={u.transfer}
        detail="Egress to clients — pipeline reads + cached web. The metric that forced the Sept Launch upgrade."
      />
      <NeonBar
        label="Storage"
        m={u.storage}
        detail="Current DB size (a level, not accrued). 6-hour history retention."
      />
      <p className="admin-usage-note">
        Period {u.periodStart!.slice(0, 10)} → {u.periodEnd!.slice(0, 10)} ·{" "}
        {u.daysElapsed} of {u.daysTotal} days ({pctIn}%). On the{" "}
        <strong>Launch</strong> plan (usage-based, ~$5/mo); the bars project
        against the <em>Free</em> caps to judge when to move back. Projections are
        straight-line — noisy early, skewed by heavy manual runs.{" "}
        <span className="dim">
          Checked{" "}
          {new Date(u.fetchedAt).toLocaleString("en-US", {
            timeZone: "America/Chicago",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}{" "}
          CT · cached 10 min.
        </span>
      </p>
    </div>
  );
}

function ago(d: Date | null): string {
  if (!d) return "never";
  const sec = (Date.now() - d.getTime()) / 1000;
  if (sec < 90) return "just now";
  const min = sec / 60;
  if (min < 90) return `${Math.round(min)}m ago`;
  const hr = min / 60;
  if (hr < 36) return `${Math.round(hr)}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function freshnessState(r: FreshnessRow): "" | "warm" | "hot" {
  if (!r.at) return "hot";
  const hr = (Date.now() - r.at.getTime()) / 3.6e6;
  if (hr > r.warnHrs * 2) return "hot";
  if (hr > r.warnHrs) return "warm";
  return "";
}

function FreshnessPanel({ rows }: { rows: FreshnessRow[] }) {
  const worst = rows.map(freshnessState);
  const allFresh = worst.every((s) => s === "");
  return (
    <div className="admin-limits">
      <strong>Data freshness — when each source last updated</strong>
      <table className="fresh-table">
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.label} className={freshnessState(r)}>
              <td className="fresh-label">{r.label}</td>
              <td className="fresh-age mono">{ago(r.at)}</td>
              <td className="fresh-abs mono">
                {r.at
                  ? r.at.toLocaleString("en-US", {
                      timeZone: "America/Chicago",
                      weekday: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : "—"}
              </td>
              <td className="fresh-src">{r.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="admin-usage-note">
        {allFresh
          ? "Everything is current — the automation is running."
          : "Amber / red rows are past their expected refresh window. If several are stale, the GitHub Actions schedule may not be firing — use “Run everything” below, or check the Actions tab."}{" "}
        Times shown in CT.
      </p>
    </div>
  );
}

export default async function AdminPage() {
  const admin = await isAdmin();

  if (!admin) {
    return (
      <>
        <h1>Admin</h1>
        <p className="subhead">Manual pipeline runs. Password required.</p>
        <LoginForm />
      </>
    );
  }

  const [usage, freshness, neon] = await Promise.all([
    getApiUsage(),
    getDataFreshness(),
    getNeonUsage(),
  ]);

  const scripts = Object.entries(RUNNABLE).map(([name, s]) => ({
    name,
    label: s.label,
    note: s.note,
  }));

  return (
    <>
      <h1>Admin</h1>
      <p className="subhead">
        Fire a pipeline step by hand. The scheduled runs still happen on their
        own — these are for catching up or forcing a refresh. Each runs on the
        server against the live database.
      </p>

      <FreshnessPanel rows={freshness} />

      <div className="admin-limits">
        <strong>Monthly API budgets</strong>
        <UsageBar
          label="CFBD"
          used={usage.cfbdCalls}
          budget={usage.cfbdBudget}
          detail={
            usage.cfbdRemaining != null
              ? `${usage.cfbdRemaining} calls remaining this month, from CFBD's own \`x-calllimit-remaining\` header — exact. The bar's total (${usage.cfbdBudget.toLocaleString()}) is inferred as calls-so-far + that remaining count, not a fixed plan number CFBD publishes anywhere.`
              : "No remaining-count reading yet this month (CFBD only sends it in response headers) — showing a best-effort call count against a rough guessed budget until the next successful call reports it."
          }
          updatedAt={usage.cfbdUpdatedAt}
        />
        <UsageBar
          label="The Odds API"
          used={usage.oddsUsed}
          budget={usage.oddsBudget}
          detail={
            usage.oddsRemaining != null
              ? `Exact — from the API's own header. ${usage.oddsRemaining} credits remaining. Each line pull costs 2.`
              : "No pull yet this month — will populate after the next pull-lines run."
          }
          updatedAt={usage.oddsUpdatedAt}
        />
        <p className="admin-usage-note">
          Resets naturally at the start of each calendar month (a fresh row). Each bar's "last
          call" is that API only — CFBD and Odds run on separate schedules (see the freshness
          panel above for Betting lines specifically), so one can move while the other sits idle.
          <span className="dim"> Open-Meteo / ESPN / Kalshi are free, no key — not tracked here.</span>
        </p>
      </div>

      <NeonPanel u={neon} />

      <RunPanel scripts={scripts} runAllOrder={RUN_ALL_ORDER} />

      <p className="foot">
        Typical weekly order: <span className="mono">pull-ratings → pull-rankings
        → pull-games → pull-lines → pull-kalshi → compute-flags → run-model →
        generate-picks</span>; then Sunday <span className="mono">pull-games →
        grade-picks → compute-trends</span>.
        <span className="dim"> pull-ratings alone won't refresh SP+ for a team
        already on Bill C's sheet — that only happens on a local upload
        (<span className="mono">load-billc</span>, not runnable from here);
        pull-ratings just covers the fallback + pace/SRS underneath it.</span>
      </p>
    </>
  );
}
