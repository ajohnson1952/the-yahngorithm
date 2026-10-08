// /lab only: three candidate sets of shared accent colours for Cavepicks and
// the yahngorithm (green = win / good, red = loss / bad, amber = the model's
// pick, blue = buttons and links). This same file sits on both apps' lab
// pages so each set can be judged against each app's own background. Static.

type Palette = { key: string; name: string; note: string; green: string; red: string; amber: string; blue: string };

const SETS: Palette[] = [
  {
    key: "A", name: "Bright (Cavepicks today)",
    note: "The loudest set. Reads instantly on a phone in daylight; the red is close to a warning red.",
    green: "#3ddc7a", red: "#ff4b4b", amber: "#e0a94a", blue: "#6c97ff",
  },
  {
    key: "B", name: "Soft (the yahngorithm today)",
    note: "Calmer and a little dustier. Easier on the eye across a full board of numbers, less punchy for a win.",
    green: "#46c46a", red: "#f0616d", amber: "#e0a83a", blue: "#4c9aff",
  },
  {
    key: "C", name: "Blend",
    note: "In between: Cavepicks' green pulled back a touch, a red that is firm without shouting, a slightly warmer amber.",
    green: "#3fd07a", red: "#f8565c", amber: "#e6ac44", blue: "#5b98ff",
  },
];

const text = "#e9edf0";
const dim = "#8a959a";
const mono: React.CSSProperties = { fontFamily: "var(--font-mono), ui-monospace, monospace" };

function Swatch({ c, label }: { c: string; label: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ height: 26, borderRadius: 6, background: c }} />
      <div style={{ ...mono, fontSize: 10, color: dim, marginTop: 3 }}>
        {label}
        <br />
        {c}
      </div>
    </div>
  );
}

function chip(c: string): React.CSSProperties {
  return {
    ...mono, display: "inline-block", padding: "0 6px", borderRadius: 999, fontSize: 11, fontWeight: 700,
    color: c, border: `1px solid ${c}`, whiteSpace: "nowrap",
  };
}

function Sample({ p }: { p: Palette }) {
  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <Swatch c={p.green} label="win" />
        <Swatch c={p.red} label="loss" />
        <Swatch c={p.amber} label="model" />
        <Swatch c={p.blue} label="action" />
      </div>
      <div style={{ borderTop: "1px solid var(--border)", margin: "10px 0" }} />
      <div style={{ fontSize: 13, color: p.green, marginBottom: 4 }}>
        <span style={mono}>SPRD</span> TENN @ ARK &mdash; ARK +13.5 (-114, FD) <span style={chip(p.green)}>+2</span>
      </div>
      <div style={{ fontSize: 13, color: p.red, marginBottom: 4 }}>
        <span style={mono}>SPRD</span> UGA @ AUB &mdash; AUB +3 (-110, FD) <span style={chip(p.red)}>&minus;1.5</span>
      </div>
      <div style={{ fontSize: 13, color: text, marginBottom: 8 }}>
        <span style={{ ...mono, color: dim }}>TOTL</span> OSU @ ILL &mdash; o47.5 (-110, DK){" "}
        <span style={chip(p.green)}>+3</span>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span
          style={{
            display: "inline-flex", alignItems: "center", padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700,
            color: p.amber, border: `1px solid ${p.amber}80`, background: `${p.amber}1a`,
          }}
        >
          Yahngo: TENN -18.9 ›
        </span>
        <span style={{ padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 700, background: p.blue, color: "#0b0e14" }}>
          LOCK PICK
        </span>
        <span style={{ fontSize: 13, color: p.blue, fontWeight: 700 }}>View game ›</span>
        <span style={{ ...mono, fontSize: 13, color: text }}>
          12-9 <span style={{ color: p.green }}>+2.4u</span> <span style={{ color: p.red }}>&minus;0.8</span>
        </span>
      </div>
    </div>
  );
}

export default function AccentMock() {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontWeight: 800, fontSize: 15, color: text }}>🎨 Shared accent colours</div>
      <p style={{ fontSize: 13, color: dim, margin: "4px 0 0" }}>
        Three candidate sets. Whichever is chosen becomes the green, red, amber and blue in both apps. This
        same card is on the other app&apos;s lab page too, so check each set against both backgrounds.
      </p>
      {SETS.map((p) => (
        <div key={p.key}>
          <div style={{ borderTop: "1px solid var(--border)", margin: "14px 0 10px" }} />
          <strong style={{ fontSize: 13, color: text }}>
            {p.key} &middot; {p.name}
          </strong>
          <p style={{ fontSize: 11, color: dim, margin: "2px 0 0" }}>{p.note}</p>
          <Sample p={p} />
        </div>
      ))}
    </div>
  );
}
