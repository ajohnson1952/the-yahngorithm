import type { Metadata } from "next";

// Unlinked-from-the-web test bench (reachable from the More menu while it's
// in use): mockups of how Cavepicks — the owner's pick'em game for 7 friends —
// could show up inside the yahngorithm. Static sample data, no DB, nothing
// live. Every caveman badge just opens the Cavepicks home page for now.
export const metadata: Metadata = {
  title: "Lab · the yahngorithm",
  robots: { index: false },
};
export const dynamic = "force-static";

const CAVE_URL = "https://www.cavepicks.com";

function Cave({ size = 18 }: { size?: number }) {
  return (
    <img
      src="/cavepicks.png"
      alt=""
      width={size}
      height={size}
      style={{ borderRadius: 5, verticalAlign: "-4px", flexShrink: 0 }}
    />
  );
}

/** the cross-link itself: the caveman + a short label, opens Cavepicks */
function CaveBadge({ label = "Cavepicks" }: { label?: string }) {
  return (
    <a
      href={CAVE_URL}
      target="_blank"
      rel="noreferrer"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px 4px 5px",
        borderRadius: 999,
        border: "1px solid var(--border-bright)",
        background: "var(--panel-2)",
        color: "var(--text)",
        fontSize: 12,
        fontWeight: 650,
        whiteSpace: "nowrap",
      }}
    >
      <Cave size={20} />
      {label} <span style={{ color: "var(--text-faint)" }}>›</span>
    </a>
  );
}

function Section({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 26 }}>
      <h2 style={{ margin: "0 0 2px" }}>{title}</h2>
      <p className="subhead" style={{ marginBottom: 12 }}>{blurb}</p>
      {children}
    </section>
  );
}

const frame: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  background: "var(--panel)",
  padding: "12px 14px",
};

function Hero({ extra }: { extra?: React.ReactNode }) {
  return (
    <div className="ghero" style={{ margin: 0 }}>
      <div className="ghero-teams">
        <div className="ghero-team">
          <span className="ghero-name">Tennessee</span>
          <span className="ghero-conf">SEC</span>
        </div>
        <span className="ghero-at">@</span>
        <div className="ghero-team">
          <span className="ghero-name">Arkansas</span>
          <span className="ghero-conf">SEC</span>
        </div>
      </div>
      <div className="ghero-meta">Week 6 · 2026 · Sat, Oct 10, 11:00 AM CT · ABC</div>
      <div className="ghero-nums">
        <div className="ghero-num">
          <span className="k">Market spread</span>
          <span className="v mono">TENN -13.5</span>
        </div>
        <div className="ghero-num">
          <span className="k">Model spread</span>
          <span className="v mono">TENN -18.9</span>
        </div>
        <div className="ghero-num">
          <span className="k">Edge</span>
          <span className="v mono neg">-5.4</span>
        </div>
      </div>
      {extra}
    </div>
  );
}

/** "who's on what" bar — how the 7 Cavepicks players split on one market */
function Split({ left, right, l, r }: { left: string; right: string; l: number; r: number }) {
  const total = l + r;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 650 }}>
        <span>
          {left} <span className="mono" style={{ color: "var(--text-dim)" }}>{l}</span>
        </span>
        <span>
          <span className="mono" style={{ color: "var(--text-dim)" }}>{r}</span> {right}
        </span>
      </div>
      <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", marginTop: 4, background: "var(--panel-2)" }}>
        {total > 0 && (
          <>
            <div style={{ width: `${(100 * l) / total}%`, background: "var(--blue)" }} />
            <div style={{ width: `${(100 * r) / total}%`, background: "var(--amber)" }} />
          </>
        )}
      </div>
    </div>
  );
}

export default function LabPage() {
  return (
    <div style={{ paddingBottom: 30 }}>
      <h1>Lab</h1>
      <p className="subhead">
        Mockups of how <Cave size={16} /> Cavepicks could show up here. Sample data, nothing live. (The
        Cavepicks nav link is real now; these two are still ideas.)
      </p>

      <Section
        title="How the cave picked it"
        blurb="A step past linking: show how the 7 players split on this game, next to the model's number. It would need Cavepicks to share its locked picks, and would only count picks that are already locked."
      >
        <div style={frame}>
          <Hero
            extra={
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", textAlign: "left" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-dim)" }}>
                    <Cave size={18} /> The cave · 5 of 7 locked
                  </span>
                  <CaveBadge label="Open" />
                </div>
                <Split left="TENN -13.5" right="ARK +13.5" l={4} r={1} />
                <Split left="Over 57.5" right="Under 57.5" l={1} r={2} />
                <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>
                  Model and the cave agree on Tennessee.
                </div>
              </div>
            }
          />
        </div>
      </Section>

      <Section
        title="Caveman chip on a board card"
        blurb="A small marker on the week board for games somebody in the cave has locked a pick on."
      >
        <div style={{ ...frame, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 650, fontSize: 14 }}>Tennessee</div>
            <div style={{ fontWeight: 650, fontSize: 14 }}>Arkansas</div>
            <div className="kick">Sat, Oct 10, 11:00 AM CT · ABC</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="mono" style={{ fontSize: 13 }}>ARK +13.5</div>
            <div className="mono" style={{ fontSize: 12, color: "var(--text-dim)" }}>model -18.9</div>
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 5, marginTop: 6, padding: "2px 8px 2px 3px",
                borderRadius: 999, background: "var(--panel-2)", border: "1px solid var(--border)", fontSize: 11, fontWeight: 650,
              }}
            >
              <Cave size={16} /> 5 picks
            </span>
          </div>
        </div>
      </Section>

      <p className="foot">Lab page — mockups only. Nothing here reads or saves any data.</p>
    </div>
  );
}
