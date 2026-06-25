// @warrant/verify-js — a deterministic verifier for JS functions.
// It assembles impl + independently-authored property tests + a harness into one
// module, runs it in a sandbox (untrusted code), and parses the per-claim report.
// The spec source defines `properties(): {id, severity?, test}[]`; the impl defines
// the function under test. They share module scope; `__seed` is injected for
// deterministic randomized inputs.

import { spawn } from "node:child_process";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Verifier, Sandbox, SandboxLimits, SandboxResult } from "../../core/src/verifier.ts";
import type { Witness, Claim, Severity } from "../../core/src/witness.ts";

export class SubprocessSandbox implements Sandbox {
  run(entryFile: string, limits: SandboxLimits): Promise<SandboxResult> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [entryFile], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, limits.ms);
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", () => {
        clearTimeout(timer);
        resolve({ stdout, stderr, timedOut });
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        resolve({ stdout, stderr: stderr + String(e), timedOut });
      });
    });
  }
}

const PREAMBLE = `function assert(c, m) { if (!c) throw new Error(m); }\n`;
const SENTINEL = "__WARRANT_REPORT__";

function harness(): string {
  return `
const __out = [];
for (const p of properties()) {
  try { p.test(); __out.push({ id: p.id, severity: p.severity ?? "required", ok: true }); }
  catch (e) { __out.push({ id: p.id, severity: p.severity ?? "required", ok: false, detail: String((e && e.message) || e).replace(/\\s+/g, " ").slice(0, 240) }); }
}
process.stdout.write("\\n${SENTINEL}" + JSON.stringify(__out) + "\\n");
`;
}

type Report = { id: string; severity?: Severity; ok: boolean; detail?: string };

export class JsTestVerifier implements Verifier<string, string> {
  readonly cls = "deterministic" as const;
  private sandbox: Sandbox;
  constructor(sandbox: Sandbox = new SubprocessSandbox()) {
    this.sandbox = sandbox;
  }

  async verify(impl: string, spec: string, seed: number): Promise<Witness> {
    const dir = await mkdtemp(join(tmpdir(), "warrant-"));
    const file = join(dir, "candidate.mjs");
    const src = `${PREAMBLE}const __seed = ${seed | 0};\n// ---- impl ----\n${impl}\n// ---- spec ----\n${spec}\n// ---- harness ----${harness()}`;
    await writeFile(file, src);
    const res = await this.sandbox.run(file, { ms: 10_000, memMb: 256, net: false });
    await rm(dir, { recursive: true, force: true });

    const idx = res.stdout.lastIndexOf(SENTINEL);
    if (idx === -1) {
      const errLine = (
        res.stderr.split("\n").find((l) => /error/i.test(l)) ?? (res.timedOut ? "timed out" : "no report")
      ).trim();
      return { schema: "warrant/v1", seed, loadError: `candidate did not run: ${errLine}`, claims: [] };
    }
    const json = res.stdout.slice(idx + SENTINEL.length).split("\n")[0];
    let report: Report[];
    try {
      report = JSON.parse(json) as Report[];
    } catch {
      return { schema: "warrant/v1", seed, loadError: "unparseable report", claims: [] };
    }
    const claims: Claim[] = report.map((r) => ({
      id: r.id,
      severity: r.severity ?? "required",
      evidence: { kind: "binary", ok: r.ok, detail: r.detail },
    }));
    return { schema: "warrant/v1", seed, claims };
  }
}
