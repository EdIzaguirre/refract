import http from "node:http";
import fs from "node:fs/promises";
import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { BranchHistory, Comparison, FlowReport, LensReport, PlanComparison, ServerEvent, Snapshot, Story, Timeline, ViewInfo } from "../shared/types.js";
import { cachedLenses, runLenses } from "../core/lenses.js";
import { cachedFlows, sequenceFor, traceFlows } from "../core/flows.js";
import { draftAreas } from "../core/draft-areas.js";
import { cachedStory, measuredStory, writeStory } from "../core/story.js";
import { Workspace } from "../core/workspace.js";
import { loadPlan, type Plan } from "../core/plan.js";
import { planInfo, planStory } from "../core/plan-preview.js";
import { MAX_PLANS } from "../core/plan-compare.js";

async function mtimeOf(file: string): Promise<number> {
  try {
    return (await fs.stat(file)).mtimeMs;
  } catch {
    return -1;
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(here, "../web");

/** What one view shows: a range or watched branch, a plan, or several plans side by side. */
export interface ViewOptions {
  spec?: string;
  /** A branch to follow; undefined means follow the current branch if there is one. */
  watch?: string | null;
  quietSeconds: number;
  /**
   * A plan by name. Without a range it opens the preview: the plan drawn
   * against today's code. With a range it is the plan the branch is checked
   * against. Without it, the branch's own plan is checked when there is one.
   */
  plan?: string;
  /** With plan: up to three more plans for the same goal, laid beside the first ("design it twice"). */
  vs?: string[];
  /** The branch or commit plans are drawn against, instead of the default branch. */
  base?: string;
}

export interface ServerOptions extends ViewOptions {
  port: number;
  open: boolean;
}

/** A view as the command line asks for it: the repository it is in, and what to show. */
interface ViewRequest extends ViewOptions {
  repo: string;
}

/** Tells this build apart from an older Refract still running, so a rebuilt Refract takes over. */
const BUILD = String(statSync(fileURLToPath(import.meta.url)).mtimeMs);

const hubFile = () => path.join(process.env.REFRACT_HOME ?? path.join(os.homedir(), ".refract"), "server.json");

/**
 * Refract is one window. The first `refract` starts the server; every later
 * one (a plan, plans side by side, another branch or repository) hands its
 * view to that server and exits, and the tab already open switches to it.
 */
export async function launch(ws: Workspace, opts: ServerOptions): Promise<void> {
  const request: ViewRequest = { repo: ws.git.root, spec: opts.spec, watch: opts.watch, quietSeconds: opts.quietSeconds, plan: opts.plan, vs: opts.vs, base: opts.base };
  const running = await findRunning(opts.port);
  if (running && running.build === BUILD) return handOff(running.port, request, opts.open);

  const hub = new Hub();
  hub.add(ws);
  const first = await hub.open(request);
  // An older Refract is running: take over its port and the views it had open.
  const restore = running ? await quit(running.port) : [];
  const server = http.createServer((req, res) => {
    route(hub, req, res).catch((e: Error) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    });
  });
  const port = await listen(server, running?.port ?? opts.port);
  hub.port = port;
  await fs.mkdir(path.dirname(hubFile()), { recursive: true });
  await fs.writeFile(hubFile(), JSON.stringify({ port, pid: process.pid }));
  const forget = () => {
    try {
      if (JSON.parse(readFileSync(hubFile(), "utf8")).pid === process.pid) unlinkSync(hubFile());
    } catch {
      // Already gone.
    }
  };
  process.on("exit", forget);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => process.exit(0));

  const url = hub.url(first.id);
  process.stdout.write(`Refract is showing ${ws.key} at ${url}\n`);
  first.describe();
  process.stdout.write(`Run refract again (a plan, another branch) and it opens here, in the same tab. Ctrl-C to stop.\n`);
  if (opts.open) openBrowser(url);
  for (const r of restore) hub.open(r, { behind: true }).catch((e: Error) => process.stdout.write(`Could not reopen a view: ${e.message}\n`));
}

/** Stops the running Refract, if there is one. */
export async function stopRunning(port: number): Promise<boolean> {
  const running = await findRunning(port);
  if (!running) return false;
  await quit(running.port);
  return true;
}

async function findRunning(port: number): Promise<{ port: number; build: string } | null> {
  const ports: number[] = [];
  try {
    ports.push(JSON.parse(await fs.readFile(hubFile(), "utf8")).port);
  } catch {
    // Not started yet, or stopped.
  }
  if (!ports.includes(port)) ports.push(port);
  for (const p of ports) {
    try {
      const res = await fetch(`http://127.0.0.1:${p}/api/hub`, { signal: AbortSignal.timeout(1000) });
      const body = (await res.json()) as { refract?: boolean; build?: string };
      if (body.refract) return { port: p, build: String(body.build) };
    } catch {
      // Nothing there, or not Refract.
    }
  }
  return null;
}

async function handOff(port: number, request: ViewRequest, open: boolean) {
  const res = await fetch(`http://127.0.0.1:${port}/api/views`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
  const body = (await res.json()) as { error?: string; url: string; title: string; shown: boolean };
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  process.stdout.write(`Refract is showing ${body.title} at ${body.url}\n`);
  if (body.shown) process.stdout.write(`Your Refract tab switched to it; the header lists everything open.\n`);
  else if (open) openBrowser(body.url);
}

/** Asks a running Refract to stop, and returns the views it had open. */
async function quit(port: number): Promise<ViewRequest[]> {
  let views: ViewRequest[] = [];
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/hub/quit`, { method: "POST" });
    views = ((await res.json()) as { views: ViewRequest[] }).views ?? [];
  } catch {
    // It stopped before answering.
  }
  // Wait for its port to come free.
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/hub`, { signal: AbortSignal.timeout(250) });
      await new Promise((r) => setTimeout(r, 100));
    } catch {
      break;
    }
  }
  return views;
}

function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "EADDRINUSE" && port < 4200) resolve(listen(server, port + 1));
      else reject(e);
    });
    server.listen(port, "127.0.0.1", () => resolve(port));
  });
}

function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // No browser here; the URL is printed.
  }
}

/** Everything open in this Refract, most recently opened first, and the tabs looking at it. */
class Hub {
  port = 0;
  private views: LiveState[] = [];
  private opening = new Map<string, Promise<LiveState>>();
  private repos = new Map<string, Promise<Workspace>>();
  /** Every open tab, newest last: the newest is the one a new view goes to. */
  private tabs: http.ServerResponse[] = [];

  add(ws: Workspace) {
    this.repos.set(ws.git.root, Promise.resolve(ws));
  }

  url(id: string) {
    return `http://127.0.0.1:${this.port}/?v=${id}`;
  }

  list(): ViewInfo[] {
    return this.views.map((v) => v.info());
  }

  get(id: string | null): LiveState | undefined {
    return (id && this.views.find((v) => v.id === id)) || this.views[0];
  }

  /** Opens a view, or brings back the same one when it is already open. */
  async open(r: ViewRequest, { behind = false } = {}): Promise<LiveState> {
    let ws = this.repos.get(r.repo);
    if (!ws) {
      ws = Workspace.open(r.repo);
      ws.catch(() => this.repos.delete(r.repo));
      this.repos.set(r.repo, ws);
    }
    const w = await ws;
    // Without a range, "this branch" means whichever is checked out now.
    const current = r.spec || r.watch || (r.plan && r.watch === undefined) ? null : await w.git.currentBranch();
    const id = createHash("sha1")
      .update(JSON.stringify([w.git.root, r.spec, r.watch, r.plan, r.vs, r.base, current]))
      .digest("hex")
      .slice(0, 8);
    const found = this.views.find((v) => v.id === id);
    if (found) {
      if (!behind) this.views = [found, ...this.views.filter((v) => v !== found)];
      this.changed();
      return found;
    }
    let p = this.opening.get(id);
    if (!p) {
      p = (async () => {
        const live = new LiveState(w, r, id);
        await live.init();
        live.start();
        this.views = behind ? [...this.views, live] : [live, ...this.views];
        this.changed();
        return live;
      })();
      p.finally(() => this.opening.delete(id)).catch(() => {});
      this.opening.set(id, p);
    }
    return p;
  }

  /** Shows the other side of a view's work, opening it if needed. */
  async twin(id: string): Promise<LiveState> {
    const v = this.views.find((x) => x.id === id);
    if (!v) throw new Error("That view is no longer open.");
    const found = this.views.find((x) => x.isTwinOf(v));
    if (found) return found;
    const r = v.twinRequest();
    if (!r) throw new Error("This view has no other side to show.");
    return this.open(r);
  }

  close(id: string) {
    const v = this.views.find((x) => x.id === id);
    if (!v) return;
    v.stop();
    this.views = this.views.filter((x) => x !== v);
    this.changed();
  }

  /** Points the newest tab at a view; false when no tab is open. */
  show(id: string): boolean {
    const tab = this.tabs[this.tabs.length - 1];
    if (!tab) return false;
    tab.write(`data: ${JSON.stringify({ type: "open", payload: { id } })}\n\n`);
    return true;
  }

  /** A tab's event stream: the open views, and everything about the view it shows. */
  subscribe(res: http.ServerResponse, view: LiveState | undefined) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(`retry: 2000\n\n`);
    this.tabs.push(res);
    const detach = view?.attach(res);
    const ping = setInterval(() => res.write(`: ping\n\n`), 20_000);
    res.on("close", () => {
      clearInterval(ping);
      this.tabs = this.tabs.filter((t) => t !== res);
      detach?.();
    });
  }

  private changed() {
    const data = `data: ${JSON.stringify({ type: "views", payload: this.list() })}\n\n`;
    for (const t of this.tabs) t.write(data);
  }

  /** What to reopen in a newer Refract. */
  requests(): ViewRequest[] {
    return this.views.map((v) => v.request);
  }
}

class LiveState {
  base = "";
  /** The branch the base was taken from (dev, main, or the left side of a range). */
  baseFrom: string | null = null;
  history: BranchHistory | undefined;
  headName: string | null = null;
  head = "";
  watching: string | null = null;
  commits: Timeline["commits"] = [];
  status = "Starting";
  lastCommitAt = Date.now();
  private clients = new Set<http.ServerResponse>();
  private timers: NodeJS.Timeout[] = [];
  private comparisons = new Map<string, Promise<Comparison>>();
  private lenses = new Map<string, LensReport>();
  private flows = new Map<string, Promise<FlowReport>>();
  private lensedHeads = new Set<string>();
  private stories = new Map<string, Story>();
  private drafting = false;
  /** The plan in play, if any, and whether the page draws it (preview) or checks the branch against it. */
  plan: Plan | null = null;
  planPath: string | null = null;
  preview = false;
  private planMtime = 0;
  /** With --vs: every plan being compared, and the comparison itself. */
  group: { name: string; path: string; plan: Plan; mtime: number }[] | null = null;
  private pair: Promise<PlanComparison> | null = null;
  /** The plan's name, whether it is drawn (preview) or the branch is checked against it. */
  planName: string | null = null;
  /** In a preview: a branch of the plan's name exists, so the code it became can be shown. */
  private built = false;
  /** In a preview, the planned snapshot that request flows read. */
  private planned: Snapshot | null = null;

  constructor(
    readonly ws: Workspace,
    readonly request: ViewRequest,
    readonly id: string,
  ) {}

  get opts(): ViewOptions {
    return this.request;
  }

  /** How the open views list names this one. */
  info(): ViewInfo {
    const base = { id: this.id, repo: this.ws.key, live: Boolean(this.watching) };
    if (this.group) return { ...base, kind: "plans", title: this.group.map((g) => g.name).join(" · ") };
    if (this.preview) return { ...base, kind: "plan", title: this.headName ?? "plan", twin: this.built ? "code" : undefined };
    return { ...base, kind: "branch", title: this.watching ?? this.headName ?? this.head.slice(0, 9), twin: this.plan ? "design" : undefined };
  }

  /** The other side of the same work: a branch's design, or the branch a design became. */
  twinRequest(): ViewRequest | null {
    const t = this.info().twin;
    if (!t || !this.planName) return null;
    const { repo, quietSeconds } = this.request;
    return t === "design" ? { repo, quietSeconds, plan: this.planName } : { repo, quietSeconds, watch: this.planName };
  }

  /** Whether another open view is this one's twin. */
  isTwinOf(v: LiveState): boolean {
    if (this.group || v.group || this.ws !== v.ws || !this.planName || this.planName !== v.planName) return false;
    return this.preview !== v.preview;
  }

  /** Says in the terminal what this view shows. */
  describe() {
    if (this.group) process.stdout.write(`Comparing ${this.group.map((g) => g.path).join(", ")}; edit any of them and the page follows.\n`);
    else if (this.preview) process.stdout.write(`Previewing the plan in ${this.planPath}; edit it and the page follows.\n`);
    else if (this.plan) process.stdout.write(`Checking ${this.watching ?? this.headName} against the plan in ${this.planPath}.\n`);
    if (this.watching) process.stdout.write(`Watching ${this.watching}; new commits appear as they land.\n`);
  }

  async init() {
    if (this.opts.plan && this.opts.vs?.length) return this.initGroup([this.opts.plan, ...this.opts.vs]);
    if (this.opts.plan && !this.opts.spec && this.opts.watch === undefined) return this.initPreview(this.opts.plan);
    const range = await this.ws.range(this.opts.spec ?? this.opts.watch ?? undefined);
    this.base = range.base;
    this.baseFrom = range.from;
    this.headName = range.head;
    this.head = await this.ws.git.resolve(range.head);
    this.watching = this.opts.watch !== undefined ? (this.opts.watch ?? range.branch) : range.branch;
    this.commits = await this.ws.git.commitsBetween(this.base, this.head);
    await this.readHistory();
    // The plan this branch is checked against: the one named, else the branch's own, when it exists.
    const planName = this.opts.plan ?? this.watching ?? (range.branch || null);
    if (planName) {
      this.planName = planName;
      this.planPath = this.ws.planPath(planName);
      this.plan = await loadPlan(this.planPath, planName);
    }
    this.setStatus(`Measuring ${this.commits.length} commit${this.commits.length === 1 ? "" : "s"}`);
    await this.compare(this.head);
    this.setStatus("Ready");
    void this.tellStory(this.head);
    this.maybeDraftAreas();
  }

  /** A plan before any code: the base is today's code, and the after side is the plan. */
  private async initPreview(name: string) {
    this.preview = true;
    this.planPath = this.ws.planPath(name);
    this.plan = await loadPlan(this.planPath, name);
    if (!this.plan) throw new Error(`No plan at ${this.planPath}. Draft one with /refract plan in Claude Code, or write it by hand (refract plan format shows how).`);
    this.planName = name;
    this.built = Boolean(await this.ws.git.tryResolve(`refs/heads/${name}`));
    const { base, from } = await this.ws.planBase(name, this.opts.base);
    this.base = base;
    this.baseFrom = from;
    this.head = this.base;
    this.headName = name;
    this.watching = null;
    this.commits = [];
    this.history = undefined;
    this.setStatus("Drawing the plan");
    await this.compare(this.head);
    this.setStatus("Ready");
  }

  /** Several plans for one goal: all drawn against the same code, compared side by side. */
  private async initGroup(names: string[]) {
    if (names.length > MAX_PLANS) throw new Error(`Refract compares up to ${MAX_PLANS} plans at a time; you named ${names.length}.`);
    this.group = [];
    for (const name of names) {
      const path = this.ws.planPath(name);
      const plan = await loadPlan(path, name);
      if (!plan) throw new Error(`No plan at ${path}. Draft them with /refract plan --two in Claude Code, or write them by hand (refract plan format shows how).`);
      this.group.push({ name, path, plan, mtime: await mtimeOf(path) });
    }
    const { base, from } = await this.ws.planBase(names[0], this.opts.base);
    this.base = this.head = base;
    this.baseFrom = from;
    this.headName = names[0];
    this.preview = true;
    this.setStatus("Drawing the plans");
    await this.plans();
    this.setStatus("Ready");
  }

  /** The plans side by side, recomputed when any file changes. */
  plans(): Promise<PlanComparison> | null {
    if (!this.group) return null;
    if (!this.pair) {
      this.pair = this.ws.comparePlans(
        this.group.map((g) => g.plan),
        this.base,
        this.baseFrom,
      );
      this.pair.catch(() => (this.pair = null));
    }
    return this.pair;
  }

  /** Re-reads any plan in the group whose file changed; a file that disappears keeps its last version. */
  private async watchGroup() {
    let changed: string | null = null;
    for (const g of this.group ?? []) {
      const mtime = await mtimeOf(g.path);
      if (mtime < 0 || mtime === g.mtime) continue;
      g.mtime = mtime;
      g.plan = (await loadPlan(g.path, g.name)) ?? g.plan;
      changed = g.name;
    }
    if (!changed) return;
    this.pair = null;
    const p = this.plans();
    if (!p) return;
    this.broadcast({ type: "plans", payload: await p });
    this.setStatus(`${changed} updated`);
  }

  /** Re-reads the plan when its file changes, so the page follows the edits. */
  private async watchPlan() {
    if (!this.planPath) return;
    let mtime = 0;
    try {
      mtime = (await fs.stat(this.planPath)).mtimeMs;
    } catch {
      mtime = -1;
    }
    if (!this.planMtime) this.planMtime = mtime;
    if (mtime === this.planMtime) return;
    this.planMtime = mtime;
    this.plan = mtime < 0 ? null : await loadPlan(this.planPath, this.plan?.name ?? this.opts.plan);
    if (this.preview && !this.plan) return this.setStatus(`The plan at ${this.planPath} is gone`);
    await this.refreshAll(this.plan?.problems.length ? `Plan updated, with ${this.plan.problems.length} line${this.plan.problems.length === 1 ? "" : "s"} Refract could not read` : "Plan updated");
    if (this.preview) this.broadcast({ type: "story", payload: await this.story(this.head) });
  }

  start() {
    const every = (ms: number, f: () => void) => this.timers.push(setInterval(f, ms));
    if (this.group) return every(1500, () => this.watchGroup().catch((e) => this.setStatus(`Plan error: ${(e as Error).message}`)));
    every(1500, () => this.watchPlan().catch((e) => this.setStatus(`Plan error: ${(e as Error).message}`)));
    if (this.preview) return;
    if (this.watching) every(2000, () => this.poll().catch((e) => this.setStatus(`Watch error: ${(e as Error).message}`)));
    // Lenses run on their own once the branch has been quiet for a while.
    every(5000, () => this.autoLenses());
  }

  /** Closed from the page: stop following its files and branch. */
  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  timeline(): Timeline {
    return { base: this.base, history: this.history, commits: this.commits, watching: this.watching, quietSeconds: this.opts.quietSeconds };
  }

  /** Which commit of which branch "before" is, how far that branch has moved since, and where it was merged in. */
  private async readHistory() {
    if (!this.baseFrom) return (this.history = undefined);
    const git = this.ws.git;
    const tip = await git.tryResolve(this.baseFrom);
    const merges: string[] = [];
    for (const c of this.commits) {
      const from = c.parents?.[1];
      if (from && tip && (await git.isAncestor(from, tip))) merges.push(c.sha);
    }
    this.history = {
      baseRef: /^[0-9a-f]{7,40}$/i.test(this.baseFrom) ? this.baseFrom.slice(0, 9) : this.baseFrom.replace(/^origin\//, ""),
      base: await git.commit(this.base),
      baseAtTip: tip === this.base,
      baseAhead: tip ? await git.count(`${this.base}..${tip}`) : 0,
      merges,
    };
  }

  private async baseTip(): Promise<string | null> {
    return this.baseFrom ? this.ws.git.tryResolve(this.baseFrom) : null;
  }

  compare(head: string): Promise<Comparison> {
    const key = `${this.base}:${head}`;
    let c = this.comparisons.get(key);
    if (!c && this.preview) {
      c = this.ws.previewPlan(this.plan!, this.base).then(({ comparison, after }) => {
        this.planned = after;
        comparison.base.ref = this.baseFrom ?? "base";
        return comparison;
      });
      c.catch(() => this.comparisons.delete(key));
      this.comparisons.set(key, c);
    }
    if (!c) {
      c = this.ws.compare(this.base, head).then(async (x) => {
        if (this.plan) {
          x.plan = planInfo(this.plan, "check");
          x.planCheck = await this.ws.checkPlan(x, this.plan);
        }
        x.base.ref = this.baseFrom ?? "base";
        x.head.ref = this.watching ?? this.headName ?? x.head.short;
        return this.baseTip().then((tip) => {
          // The base is either the branch's own tip or, more often, the commit where head last met it.
          x.base.atTip = tip === x.base.sha;
          return x;
        });
      });
      c.catch(() => this.comparisons.delete(key));
      this.comparisons.set(key, c);
    }
    return c;
  }

  async lensReport(head: string): Promise<LensReport> {
    const key = `${this.base}:${head}`;
    const mem = this.lenses.get(key);
    if (mem) return mem;
    const cached = await cachedLenses(this.ws, await this.compare(head));
    if (cached) {
      this.lenses.set(key, cached);
      return cached;
    }
    return { base: this.base, head, status: "idle", lenses: [], disagreements: [] };
  }

  async runLenses(head: string): Promise<LensReport> {
    const key = `${this.base}:${head}`;
    const existing = this.lenses.get(key);
    if (existing?.status === "running") return existing;
    this.lensedHeads.add(head);
    const c = await this.compare(head);
    const done = runLenses(
      this.ws,
      c,
      (msg) => this.setStatus(msg),
      (r) => {
        this.lenses.set(key, r);
        this.broadcast({ type: "lenses", payload: r });
      },
    );
    done.catch((e) => this.setStatus(`Lenses failed: ${(e as Error).message}`));
    return this.lenses.get(key)!;
  }

  /** The tour for a commit: Claude's when written, else the measured one. */
  async story(head: string): Promise<Story> {
    if (this.preview) return planStory(await this.compare(head), this.plan!);
    const key = `${this.base}:${head}`;
    const mem = this.stories.get(key);
    if (mem) return mem;
    const c = await this.compare(head);
    const cached = await cachedStory(this.ws, c);
    if (cached) {
      this.stories.set(key, cached);
      return cached;
    }
    return measuredStory(c);
  }

  /** Asks Claude Code to tell the change; the page shows the measured tour meanwhile. */
  async tellStory(head: string, again = false): Promise<Story> {
    const key = `${this.base}:${head}`;
    const existing = await this.story(head);
    if (this.preview) return existing;
    if ((existing.source === "claude" && !again) || existing.status === "running" || process.env.REFRACT_NO_STORY) return existing;
    const c = await this.compare(head);
    const running: Story = { ...existing, status: "running" };
    this.stories.set(key, running);
    this.broadcast({ type: "story", payload: running });
    const lens = await this.lensReport(head);
    const questions = lens.lenses.flatMap((l) => l.questions.map((q) => `${l.lens} ${q.tone}: ${q.text}`));
    writeStory(this.ws, c, questions).then((s) => {
      if (s.error) this.setStatus(`Claude Code could not write the tour, showing the measured one: ${s.error.slice(0, 160)}`);
      this.stories.set(key, s);
      this.broadcast({ type: "story", payload: s });
    });
    return running;
  }

  private autoLenses() {
    if (!this.watching || this.lensedHeads.has(this.head)) return;
    if (Date.now() - this.lastCommitAt < this.opts.quietSeconds * 1000) return;
    if (this.commits.length === 0) return;
    this.lensedHeads.add(this.head);
    this.lensReport(this.head).then((r) => {
      if (r.status === "idle") {
        const q = this.opts.quietSeconds;
        this.setStatus(`${this.watching} has been quiet for ${q >= 120 ? `${Math.round(q / 60)} minutes` : `${q} seconds`}; asking the lenses`);
        void this.runLenses(this.head);
      }
      void this.tellStory(this.head);
    });
  }

  flowReport(commit: string, side: "before" | "after", run: boolean): Promise<FlowReport | null> {
    const key = `${commit}:${side}`;
    const existing = this.flows.get(key);
    if (existing) return existing;
    if (!run) return cachedFlows(this.ws, commit);
    const p = (async () => {
      const c = await this.compare(this.head);
      const r = await traceFlows(this.ws, c, side, (m) => this.setStatus(m));
      this.broadcast({ type: "flows", payload: { side, commit, status: r.status, error: r.error, tests: r.tests } });
      if (r.status !== "traced") this.flows.delete(key);
      return r;
    })();
    this.flows.set(key, p);
    return p;
  }

  private async poll() {
    const ref = this.watching!;
    const sha = await this.ws.git.tryResolve(ref);
    if (!sha || sha === this.head) return;
    const prevBase = this.base;
    const main = await this.ws.git.defaultBranch();
    const newBase = main ? await this.ws.git.mergeBase(main, sha) : null;
    if (newBase && newBase !== sha) this.base = newBase;
    this.head = sha;
    this.lastCommitAt = Date.now();
    this.commits = await this.ws.git.commitsBetween(this.base, sha);
    await this.readHistory();
    if (prevBase !== this.base) this.setStatus(`${ref} was rebased onto a new base`);
    this.broadcast({ type: "timeline", payload: this.timeline() });
    const c = await this.compare(sha);
    this.broadcast({ type: "comparison", payload: c });
    this.setStatus(`New commit on ${ref}: ${c.head.subject}`);
  }

  private maybeDraftAreas() {
    if (this.drafting || existsSync(this.ws.areasPath) || process.env.REFRACT_NO_DRAFT) return;
    this.drafting = true;
    this.setStatus("No areas.yml yet: asking Claude Code to draft business areas");
    this.ws.store
      .snapshot(this.head)
      .then((snap) => draftAreas(this.ws, snap))
      .then(() => this.refreshAll("Claude Code drafted your business areas; edit them any time in " + this.ws.areasPath))
      .catch((e) => this.setStatus(`Area draft failed, using inferred areas: ${(e as Error).message}`))
      .finally(() => (this.drafting = false));
  }

  async refreshAll(message: string) {
    this.comparisons.clear();
    if (this.preview) this.lenses.clear();
    this.stories.clear();
    const c = await this.compare(this.head);
    this.broadcast({ type: "comparison", payload: c });
    this.setStatus(message);
  }

  /** The planned after side, in a preview. */
  async plannedSnapshot(): Promise<Snapshot | null> {
    if (!this.preview) return null;
    await this.compare(this.head);
    return this.planned;
  }

  setStatus(message: string) {
    this.status = message;
    this.broadcast({ type: "status", payload: { message, at: new Date().toISOString() } });
  }

  /** A tab showing this view; returns how to let it go. */
  attach(res: http.ServerResponse): () => void {
    this.clients.add(res);
    return () => this.clients.delete(res);
  }

  broadcast(event: ServerEvent) {
    const data = `data: ${JSON.stringify({ ...event, view: this.id })}\n\n`;
    for (const c of this.clients) c.write(data);
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function route(hub: Hub, req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const q = url.searchParams;
  const json = (body: unknown, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  // The running Refract itself: what is open, opening and closing views.
  switch (url.pathname) {
    case "/api/hub":
      return json({ refract: true, build: BUILD, pid: process.pid, views: hub.list() });
    case "/api/hub/quit": {
      if (req.method !== "POST") return json({ error: "POST" }, 405);
      json({ views: hub.requests() });
      process.stdout.write("A newer Refract took over.\n");
      setTimeout(() => process.exit(0), 50);
      return;
    }
    case "/api/views/twin": {
      if (req.method !== "POST") return json({ error: "POST" }, 405);
      try {
        return json({ id: (await hub.twin(q.get("view") ?? "")).id });
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
    }
    case "/api/views": {
      if (req.method === "POST") {
        const r = JSON.parse(await readBody(req)) as ViewRequest;
        try {
          const live = await hub.open(r);
          process.stdout.write(`Showing ${live.ws.key}: ${live.info().title} at ${hub.url(live.id)}\n`);
          return json({ id: live.id, url: hub.url(live.id), title: `${live.ws.key}: ${live.info().title}`, shown: hub.show(live.id) });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      }
      if (req.method === "DELETE") {
        hub.close(q.get("view") ?? "");
        return json({ views: hub.list() });
      }
      return json({ views: hub.list() });
    }
  }

  const live = url.pathname.startsWith("/api/") ? hub.get(q.get("view")) : undefined;
  if (url.pathname === "/api/events") return hub.subscribe(res, live);
  if (url.pathname.startsWith("/api/") && !live) return json({ error: "Nothing is open in Refract. Run refract in a repository." }, 404);
  if (live) await viewRoute(live, url, req, json);
  if (res.headersSent) return;

  // Static files for the web app.
  if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
  let file = path.join(WEB_DIR, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(WEB_DIR) || !existsSync(file) || (await fs.stat(file)).isDirectory()) file = path.join(WEB_DIR, "index.html");
  if (!existsSync(file)) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("The web app is not built. Run `npm run build` in the refract folder.");
    return;
  }
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".png": "image/png",
  };
  res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
  res.end(await fs.readFile(file));
}

/** What one view answers: its state, comparisons, lenses, story, code and flows. */
async function viewRoute(
  live: LiveState,
  url: URL,
  req: http.IncomingMessage,
  json: (body: unknown, status?: number) => void,
) {
  const q = url.searchParams;
  const head = async () => (q.get("head") ? await live.ws.git.resolve(q.get("head")!) : live.head);

  switch (url.pathname) {
    case "/api/state": {
      const plans = live.plans();
      if (plans) return json({ view: live.id, plans: await plans, status: live.status });
      const h = await head();
      return json({
        timeline: live.timeline(),
        head: live.head,
        comparison: await live.compare(h),
        lenses: await live.lensReport(h),
        story: await live.story(h),
        status: live.status,
        areasPath: live.ws.areasPath,
        planPath: live.planPath,
      });
    }
    case "/api/plans": {
      const plans = live.plans();
      return plans ? json(await plans) : json({ error: "Refract was not started with several plans" }, 404);
    }
    case "/api/compare":
      return json(await live.compare(await head()));
    case "/api/lenses": {
      const h = await head();
      return json(req.method === "POST" ? await live.runLenses(h) : await live.lensReport(h));
    }
    case "/api/story": {
      const h = await head();
      return json(req.method === "POST" ? await live.tellStory(h, q.get("again") === "1") : await live.story(h));
    }
    case "/api/diff": {
      const h = await head();
      const paths = q.getAll("path");
      return json({ diff: await live.ws.git.diff(live.base, h, paths, Number(q.get("context") ?? 4)) });
    }
    case "/api/source": {
      const text = await live.ws.git.show(q.get("commit") ?? live.head, q.get("path") ?? "");
      return json({ text });
    }
    case "/api/sequence": {
      const h = await head();
      const side = q.get("side") === "before" ? "before" : "after";
      const commit = side === "before" ? live.base : h;
      const snap = side === "after" ? ((await live.plannedSnapshot()) ?? (await live.ws.store.snapshot(commit))) : await live.ws.store.snapshot(commit);
      const traced = await live.flowReport(commit, side, false);
      return json(sequenceFor(snap, traced, q.get("class") ?? "", q.get("method") ?? ""));
    }
    case "/api/trace": {
      const h = await head();
      const side = q.get("side") === "before" ? "before" : "after";
      const r = await live.flowReport(side === "before" ? live.base : h, side, true);
      return json(r ? { status: r.status, tests: r.tests, error: r.error, flows: r.flows.length } : null);
    }
    case "/api/areas/draft": {
      if (req.method !== "POST") return json({ error: "POST" }, 405);
      const snap = await live.ws.store.snapshot(live.head);
      live.setStatus("Asking Claude Code to draft business areas");
      draftAreas(live.ws, snap, { overwrite: true })
        .then(() => live.refreshAll(`New areas drafted in ${live.ws.areasPath}`))
        .catch((e) => live.setStatus(`Area draft failed: ${(e as Error).message}`));
      return json({ started: true });
    }
  }
}
