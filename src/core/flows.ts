import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { ClassUnit, Comparison, Flow, FlowCall, FlowReport, Sequence, Snapshot } from "../shared/types.js";
import { fileStem, homeFor } from "./areas.js";
import type { Workspace } from "./workspace.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const TRACER = path.resolve(here, "../../readers/ruby/trace.rb");

// ---------- static flows: what the code says it calls ----------

function resolveCall(call: string, from: ClassUnit, snap: Snapshot): { to: string; method: string } | null {
  if (call.startsWith(".")) return { to: from.name, method: call.slice(1) };
  const m = call.match(/^(.+?)([.#])([^.#]+)$/);
  if (!m) return null;
  const [, constant, , method] = m;
  const scope = from.name.split("::");
  for (let i = scope.length; i >= 0; i--) {
    const candidate = [...scope.slice(0, i), constant].join("::");
    if (snap.classes[candidate]) return { to: candidate, method };
  }
  return null;
}

/** Calls a method makes to the application's own classes, followed a few levels down. */
export function staticFlow(snap: Snapshot, className: string, method: string, maxDepth = 2): Flow {
  const calls: FlowCall[] = [];
  const seen = new Set<string>();
  const walk = (cls: string, name: string, depth: number) => {
    const unit = snap.classes[cls];
    const m = unit?.methods.find((x) => x.name === name);
    if (!unit || !m || depth > maxDepth) return;
    for (const call of m.calls) {
      const r = resolveCall(call, unit, snap);
      if (!r) continue;
      const callee = snap.classes[r.to]?.methods.find((x) => x.name === r.method);
      // Self calls to methods that do not exist here are Rails or Ruby built-ins.
      if (r.to === cls && !callee) continue;
      const key = `${cls}>${r.to}.${r.method}`;
      if (seen.has(key)) continue;
      seen.add(key);
      calls.push({ from: cls, to: r.to, method: r.method, source: "static", depth });
      if (calls.length > 40) return;
      if (callee) walk(r.to, r.method, depth + 1);
    }
  };
  walk(className, method, 0);
  return { entry: `${className}#${method}`, calls };
}

/**
 * The sequence diagram for one method: calls seen while tests ran are solid,
 * calls only found in the code are dashed. A flow no test exercised is all
 * dashed.
 */
export function sequenceFor(snap: Snapshot, traced: FlowReport | null, className: string, method: string): Sequence {
  const stat = staticFlow(snap, className, method);
  const observed: FlowCall[] = [];
  for (const flow of traced?.flows ?? []) {
    const entryMatch = flow.entry === `${className}#${method}` || flow.entry === `${className}.${method}`;
    if (entryMatch) {
      observed.push(...flow.calls);
      break;
    }
    const i = flow.calls.findIndex((c) => c.to === className && c.method === method);
    if (i >= 0) {
      const base = flow.calls[i].depth ?? 0;
      observed.push(flow.calls[i]);
      for (const c of flow.calls.slice(i + 1)) {
        if ((c.depth ?? 0) <= base) break;
        observed.push(c);
      }
      break;
    }
  }
  const seen = new Set(observed.map((c) => `${c.from}>${c.to}.${c.method}`));
  const messages = [
    ...observed.slice(0, 30).map((c) => ({ from: c.from, to: c.to, label: c.method === "initialize" ? "new" : c.method, observed: true })),
    ...stat.calls.filter((c) => !seen.has(`${c.from}>${c.to}.${c.method}`)).slice(0, 25).map((c) => ({ from: c.from, to: c.to, label: c.method === "initialize" ? "new" : c.method, observed: false })),
  ];
  const participants = [...new Set([className, ...messages.flatMap((m) => [m.from, m.to])])];
  return { title: `${className}#${method}`, participants, messages, traced: observed.length > 0 };
}

// ---------- traced flows: what really ran ----------

interface TraceConfig {
  appRoot: string;
  command: string;
}

async function traceConfig(ws: Workspace, worktree: string, changed: string[]): Promise<TraceConfig> {
  let cfg: { app_root?: string; test_command?: string } = {};
  try {
    cfg = YAML.parse(await fs.readFile(path.join(homeFor(ws.key), "config.yml"), "utf8")) ?? {};
  } catch {
    // No config: detect.
  }
  let appRoot = cfg.app_root ?? "";
  if (!cfg.app_root) {
    // The Rails app holding most of the changed files.
    const roots = new Map<string, number>();
    for (const f of changed) {
      const m = f.match(/^(.*?)(?:^|\/)(app|lib)\//);
      if (m) roots.set(m[1], (roots.get(m[1]) ?? 0) + 1);
    }
    appRoot = [...roots].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }
  const abs = path.join(worktree, appRoot);
  const rspec = existsSync(path.join(abs, "spec")) && !existsSync(path.join(abs, "test"));
  const command = cfg.test_command ?? (rspec ? "bundle exec rspec {files}" : existsSync(path.join(abs, "bin/rails")) ? "bin/rails test {files}" : "ruby -Itest -e 'ARGV.each { |f| require File.expand_path(f) }' {files}");
  return { appRoot, command };
}

/** Tests that touch the changed classes: the matching test file, then tests that name a changed class. */
async function testsFor(ws: Workspace, c: Comparison, commit: string, appRoot: string, limit = 12): Promise<string[]> {
  const tree = await ws.git.tree(commit);
  const tests = [...tree.keys()].filter((f) => f.startsWith(appRoot) && ws.reader.isTest(f) && /_(test|spec)\.rb$/.test(f));
  const changed = c.classes.filter((k) => k.status !== "unchanged" && k.status !== "removed");
  const stems = new Set(changed.flatMap((k) => k.paths.map(fileStem)));
  const direct = tests.filter((t) => stems.has(fileStem(t)) && !/\/system\//.test(t));
  const names = changed.map((k) => k.name).filter((n) => n.length > 3);
  const blobs = await ws.git.readBlobs(tests.filter((t) => !direct.includes(t)).map((t) => tree.get(t)!));
  const scored = tests
    .filter((t) => !direct.includes(t) && !/\/system\//.test(t))
    .map((t) => {
      const src = blobs.get(tree.get(t)!) ?? "";
      return { t, score: names.filter((n) => src.includes(n)).length };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.t);
  return [...direct, ...scored].slice(0, limit);
}

async function worktreeFor(ws: Workspace, commit: string): Promise<string> {
  const headSha = await ws.git.tryResolve("HEAD");
  const dirty = (await ws.git.git(["status", "--porcelain", "--untracked-files=no"])).trim();
  if (headSha === commit && !dirty) return ws.git.root;
  const dir = path.join(await ws.git.gitDir(), "refract", "worktrees", commit.slice(0, 12));
  if (!existsSync(dir)) await ws.git.git(["worktree", "add", "--detach", dir, commit]);
  return dir;
}

async function flowsCache(ws: Workspace, commit: string): Promise<string> {
  const dir = path.join(await ws.git.gitDir(), "refract", "flows");
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, `${commit}.json`);
}

export async function cachedFlows(ws: Workspace, commit: string): Promise<FlowReport | null> {
  try {
    return JSON.parse(await fs.readFile(await flowsCache(ws, commit), "utf8")) as FlowReport;
  } catch {
    return null;
  }
}

/** Runs the relevant tests at one side of the change with the tracer loaded. */
export async function traceFlows(
  ws: Workspace,
  c: Comparison,
  side: "before" | "after",
  log: (msg: string) => void = () => {},
): Promise<FlowReport> {
  const commit = side === "before" ? c.base.sha : c.head.sha;
  const report: FlowReport = { side, commit, status: "error", tests: [], flows: [] };
  try {
    const worktree = await worktreeFor(ws, commit);
    const cfg = await traceConfig(ws, worktree, c.files.map((f) => f.path));
    const tests = await testsFor(ws, c, commit, cfg.appRoot);
    report.tests = tests;
    if (!tests.length) {
      report.error = "No tests touch the changed classes, so every flow stays dashed.";
      return report;
    }
    const cwd = path.join(worktree, cfg.appRoot);
    const rel = tests.map((t) => path.relative(cfg.appRoot, t));
    const outBase = path.join(path.dirname(await flowsCache(ws, commit)), `${commit}-raw`);
    const cmd = cfg.command.replace("{files}", rel.map((r) => `'${r}'`).join(" "));
    log(`Tracing ${tests.length} test files at ${commit.slice(0, 8)}: ${cmd}`);
    const code = await new Promise<number>((resolve) => {
      const child = spawn("sh", ["-c", cmd], {
        cwd,
        env: {
          ...process.env,
          RUBYOPT: `${process.env.RUBYOPT ?? ""} -r${TRACER}`.trim(),
          REFRACT_TRACE_ROOT: cwd,
          REFRACT_TRACE_OUT: outBase,
          PARALLEL_WORKERS: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const tail: string[] = [];
      const keep = (b: Buffer) => {
        tail.push(b.toString());
        if (tail.length > 40) tail.shift();
      };
      child.stdout.on("data", keep);
      child.stderr.on("data", keep);
      child.on("close", (n) => {
        if (n) report.error = tail.join("").slice(-1500);
        resolve(n ?? 1);
      });
      child.on("error", () => resolve(127));
    });
    const dir = path.dirname(outBase);
    const parts = (await fs.readdir(dir)).filter((f) => f.startsWith(path.basename(outBase)));
    for (const p of parts) {
      const data = JSON.parse(await fs.readFile(path.join(dir, p), "utf8")) as { flows: Flow[] };
      report.flows.push(...data.flows);
      await fs.rm(path.join(dir, p));
    }
    report.status = report.flows.length ? "traced" : "error";
    if (!report.flows.length && !report.error) report.error = `The tests ran (exit ${code}) but recorded no application calls.`;
    if (report.flows.length) await fs.writeFile(await flowsCache(ws, commit), JSON.stringify(report));
    log(`Recorded ${report.flows.length} flows${code ? ` (tests exited ${code})` : ""}`);
  } catch (e) {
    report.error = (e as Error).message;
  }
  return report;
}
