import Link from "next/link";

// Static placeholder until the CBB board exists — no DB reads, so bots and
// visitors can't wake Neon here.
export const metadata = { title: "College basketball · the yahngorithm" };

export default function CbbHome() {
  return (
    <div className="cbb-soon">
      <h1>College basketball</h1>
      <p className="subhead">Being built now. Here&apos;s what&apos;s coming, in order:</p>
      <ul>
        <li>
          <strong>Criteria Club</strong>: FanDuel favorites of 5–10 points that KenPom gives a 70%+ win
          chance, built into a moneyline parlay.
        </li>
        <li>
          <strong>Edge board</strong>: KenPom and Torvik vs. FanDuel spreads and totals.
        </li>
        <li>
          <strong>Matchup flags</strong>: 3-point luck, turnover pressure, rebounding.
        </li>
      </ul>
      <p className="subhead">
        Football is still here: <Link href="/cfb" style={{ color: "var(--blue)" }}>this week&apos;s CFB board →</Link>
      </p>
    </div>
  );
}
