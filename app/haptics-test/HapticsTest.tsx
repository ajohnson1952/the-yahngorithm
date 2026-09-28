"use client";

import { useEffect, useRef, useState } from "react";

function makeSwitch(): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  label.appendChild(input);
  return { label, input };
}

export function HapticsTest() {
  const [info, setInfo] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const hiddenBody = useRef<HTMLLabelElement>(null);
  const note = (s: string) => setLog((l) => [`${new Date().toLocaleTimeString()} — ${s}`, ...l].slice(0, 8));

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const probe = document.createElement("input");
    probe.setAttribute("switch", "");
    setInfo(
      [
        `standalone: ${standalone}`,
        `vibrate API: ${typeof navigator.vibrate === "function"}`,
        `switch attr supported: ${"switch" in probe}`,
        navigator.userAgent.match(/OS [\d_]+/)?.[0]?.replace(/_/g, ".") ?? navigator.userAgent,
      ].join(" · ")
    );
  }, []);

  const variants: { name: string; run: () => void }[] = [
    {
      name: "A · display:none label in <head> (current helper)",
      run: () => {
        const { label } = makeSwitch();
        label.style.display = "none";
        document.head.appendChild(label);
        label.click();
        label.remove();
      },
    },
    {
      name: "B · display:none label in <body>",
      run: () => {
        const { label } = makeSwitch();
        label.style.display = "none";
        document.body.appendChild(label);
        label.click();
        label.remove();
      },
    },
    {
      name: "C · visually-hidden (not display:none) label in <body>",
      run: () => {
        const { label } = makeSwitch();
        Object.assign(label.style, {
          position: "fixed", left: "0", top: "0", width: "1px", height: "1px",
          opacity: "0", overflow: "hidden", pointerEvents: "none",
        });
        document.body.appendChild(label);
        label.click();
        label.remove();
      },
    },
    {
      name: "D · persistent hidden label (mounted once, React ref)",
      run: () => hiddenBody.current?.click(),
    },
    {
      name: "E · input.click() directly (no label)",
      run: () => {
        const { label, input } = makeSwitch();
        label.style.display = "none";
        document.body.appendChild(label);
        input.click();
        label.remove();
      },
    },
  ];

  return (
    <div style={{ padding: "18px 0 40px" }}>
      <h1>Haptics test</h1>
      <p className="subhead">{info || "…"}</p>

      <h2>1. Real switch — tap it directly</h2>
      <p className="subhead" style={{ marginBottom: 8 }}>
        If THIS doesn&apos;t tick, no web trick will: check Settings → Sounds &amp; Haptics
        → System Haptics, and iOS ≥ 18.
      </p>
      <label style={{ display: "inline-flex", gap: 10, alignItems: "center", fontSize: 15 }}>
        <input type="checkbox" {...{ switch: "" }} style={{ transform: "scale(1.4)" }} />
        native switch
      </label>

      <h2>2. Programmatic variants — tap each, note which ones tick</h2>
      <div style={{ display: "grid", gap: 8 }}>
        {variants.map((v) => (
          <button
            key={v.name}
            type="button"
            onClick={() => {
              try {
                v.run();
                note(`ran ${v.name.slice(0, 1)}`);
              } catch (e) {
                note(`${v.name.slice(0, 1)} threw: ${(e as Error).message}`);
              }
            }}
            style={{
              textAlign: "left", padding: "12px 14px", borderRadius: 10, font: "inherit",
              fontSize: 14, color: "var(--text)", background: "var(--panel)",
              border: "1px solid var(--border)",
            }}
          >
            {v.name}
          </button>
        ))}
      </div>
      <label
        ref={hiddenBody}
        aria-hidden
        style={{ position: "fixed", left: 0, top: 0, width: 1, height: 1, opacity: 0, overflow: "hidden", pointerEvents: "none" }}
      >
        <input type="checkbox" {...{ switch: "" }} />
      </label>

      <ul className="hist" style={{ marginTop: 16 }}>
        {log.map((l, i) => (
          <li key={i}>
            <span className="hist-when">{l}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
