"use server";

import { execFile } from "child_process";
import { existsSync } from "fs";
import { promisify } from "util";
import path from "path";
import { isAdmin } from "../../lib/adminAuth";
import { RUNNABLE } from "./scripts";

const run = promisify(execFile);

export async function runScript(
  name: string
): Promise<{ ok: boolean; output: string; ms: number }> {
  if (!(await isAdmin())) return { ok: false, output: "Not signed in.", ms: 0 };
  const s = RUNNABLE[name];
  if (!s) return { ok: false, output: "Unknown script.", ms: 0 };

  const tsx = path.join(process.cwd(), "node_modules", ".bin", "tsx");
  // local: a .env file exists, let tsx load it. Render: env is injected into
  // process.env (which the child inherits), no file.
  const envFileArg = existsSync(path.join(process.cwd(), ".env"))
    ? ["--env-file=.env"]
    : [];
  const started = Date.now();
  try {
    const { stdout, stderr } = await run(
      tsx,
      [...envFileArg, s.file, ...(s.args ?? [])],
      {
        cwd: process.cwd(),
        env: process.env,
        timeout: 175_000,
        maxBuffer: 8 * 1024 * 1024,
      }
    );
    const out = `${stdout}${stderr ? `\n${stderr}` : ""}`.trim();
    return { ok: true, output: out.slice(-8000), ms: Date.now() - started };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const out = [err.stdout, err.stderr, err.message]
      .filter(Boolean)
      .join("\n")
      .trim();
    return { ok: false, output: out.slice(-8000), ms: Date.now() - started };
  }
}
