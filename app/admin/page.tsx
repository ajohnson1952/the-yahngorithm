import { isAdmin } from "../../lib/adminAuth";
import { LoginForm } from "../rankings/LoginForm";
import { RUNNABLE } from "./scripts";
import { RunPanel } from "./RunPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · the yahngorithm" };

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
        <ul>
          <li>
            <span className="mono">CFBD</span> — 1,000 calls. Ratings ~3, games
            ~3, polls ~1, grading a few. Comfortable.
          </li>
          <li>
            <span className="mono">The Odds API</span> — 500 credits. Each line
            pull costs 2. Budget ~1–2 pulls/day in season.
          </li>
          <li>
            <span className="mono">Open-Meteo / ESPN / Kalshi</span> — free, no
            key. Be reasonable with frequency.
          </li>
        </ul>
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
