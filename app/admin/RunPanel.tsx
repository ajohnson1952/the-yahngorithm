"use client";

import { useState, useTransition } from "react";
import { runScript } from "./actions";

type Result = { ok: boolean; output: string; ms: number };

export function RunPanel({
  scripts,
}: {
  scripts: { name: string; label: string; note: string }[];
}) {
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [, start] = useTransition();

  const fire = (name: string) => {
    setRunning(name);
    start(async () => {
      const res = await runScript(name);
      setResults((r) => ({ ...r, [name]: res }));
      setRunning(null);
    });
  };

  return (
    <div className="admin-grid">
      {scripts.map((s) => {
        const res = results[s.name];
        const busy = running === s.name;
        return (
          <div key={s.name} className="admin-card">
            <div className="admin-card-h">
              <div>
                <div className="admin-card-title">{s.label}</div>
                <div className="admin-card-note">{s.note}</div>
              </div>
              <button
                className="admin-btn"
                onClick={() => fire(s.name)}
                disabled={!!running}
              >
                {busy ? "Running…" : "Run"}
              </button>
            </div>
            {res && (
              <pre className={`admin-out ${res.ok ? "ok" : "err"}`}>
                <span className="admin-out-meta">
                  {res.ok ? "✓" : "✗"} {(res.ms / 1000).toFixed(1)}s
                </span>
                {res.output || "(no output)"}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
