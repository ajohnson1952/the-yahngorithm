"use client";

import { useState, useTransition } from "react";
import { runScript } from "./actions";

type Result = { ok: boolean; output: string; ms: number };

export function RunPanel({
  scripts,
  runAllOrder,
}: {
  scripts: { name: string; label: string; note: string }[];
  runAllOrder: string[];
}) {
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [chain, setChain] = useState<{ i: number; total: number; label: string } | null>(null);
  const [, start] = useTransition();

  const labelFor = (name: string) =>
    scripts.find((s) => s.name === name)?.label ?? name;

  const fire = (name: string) => {
    setRunning(name);
    start(async () => {
      const res = await runScript(name);
      setResults((r) => ({ ...r, [name]: res }));
      setRunning(null);
    });
  };

  const fireAll = () => {
    setResults({});
    start(async () => {
      for (let i = 0; i < runAllOrder.length; i++) {
        const name = runAllOrder[i];
        setChain({ i: i + 1, total: runAllOrder.length, label: labelFor(name) });
        setRunning(name);
        const res = await runScript(name);
        setResults((r) => ({ ...r, [name]: res }));
        if (!res.ok) {
          setChain(null);
          setRunning(null);
          return; // stop the chain on the first failure
        }
      }
      setChain(null);
      setRunning(null);
    });
  };

  return (
    <div className="admin-run">
      <div className="admin-runall">
        <button className="admin-btn lg" onClick={fireAll} disabled={!!running}>
          {chain ? `Running ${chain.i}/${chain.total}…` : "Run everything"}
        </button>
        <span className="admin-runall-note">
          {chain
            ? chain.label
            : "Full weekly pipeline in order, stops on the first failure. ~2–4 min."}
        </span>
      </div>

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
    </div>
  );
}
