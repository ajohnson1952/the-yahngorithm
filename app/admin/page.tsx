import { isAdmin } from "../../lib/adminAuth";
import { getApiUsage } from "../../lib/webData";
import { LoginForm } from "../rankings/LoginForm";
import { RUNNABLE } from "./scripts";
import { RunPanel } from "./RunPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · the yahngorithm" };

function UsageBar({
  label,
  used,
  budget,
  detail,
}: {
  label: string;
  used: number;
  budget: number;
  detail: string;
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

  const usage = await getApiUsage();

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

      <div className="admin-limits">
        <strong>Monthly API budgets</strong>
        <UsageBar
          label="CFBD"
          used={usage.cfbdCalls}
          budget={usage.cfbdBudget}
          detail="Best-effort count of successful calls this calendar month (CFBD has no quota endpoint, so a failed run may undercount slightly). Ratings ~3, games ~3, polls ~1, grading a few."
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
        />
        <p className="admin-usage-note">
          {usage.updatedAt
            ? `Last updated ${usage.updatedAt.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} CT.`
            : "No usage recorded yet this month."}{" "}
          Resets naturally at the start of each calendar month (a fresh row).
          <span className="dim"> Open-Meteo / ESPN / Kalshi are free, no key — not tracked here.</span>
        </p>
      </div>

      <RunPanel scripts={scripts} />

      <p className="foot">
        Typical weekly order: <span className="mono">pull-ratings → pull-rankings
        → pull-games → pull-lines → pull-kalshi → compute-flags → run-model →
        generate-picks</span>; then Sunday <span className="mono">pull-games →
        grade-picks → compute-trends</span>.
      </p>
    </>
  );
}
