import http from "node:http";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Comparison, FlowReport, LensReport, ServerEvent, Story, Timeline } from "../shared/types.js";
import { cachedLenses, runLenses } from "../core/lenses.js";
import { cachedFlows, sequenceFor, traceFlows } from "../core/flows.js";
import { draftAreas } from "../core/draft-areas.js";
import { cachedStory, measuredStory, writeStory } from "../core/story.js";
import type { Workspace } from "../core/workspace.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(here, "../web");

export interface ServerOptions {
  spec?: string;
  /** A branch to follow; undefined means follow the current branch if there is one. */
  watch?: string | null;
  port: number;
  open: boolean;
  quietSeconds: number;
}

/**
 * The local server: it serves the map, answers the map's questions, and
 * follows a branch, pushing each new commit to the browser over SSE.
 */
export async function startServer(ws: Workspace, opts: ServerOptions): Promise<void> {
  const live = new LiveState(ws, opts);
  await live.init();

  const server = http.createServer((req, res) => {
    route(live, req, res).catch((e: Error) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    });
  });
  const port = await listen(server, opts.port);
  const url = `http://127.0.0.1:${port}/`;
  process.stdout.write(`Refract is showing ${ws.key} at ${url}\n`);
  if (live.watching) process.stdout.write(`Watching ${live.watching}; new commits appear as they land. Ctrl-C to stop.\n`);
  if (opts.open) openBrowser(url);
  live.start();
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

class LiveState {
  base = "";
  head = "";
  watching: string | null = null;
  commits: Timeline["commits"] = [];
  status = "Starting";
  lastCommitAt = Date.now();
  private clients = new Set<http.ServerResponse>();
  private comparisons = new Map<string, Promise<Comparison>>();
  private lenses = new Map<string, LensReport>();
  private flows = new Map<string, Promise<FlowReport>>();
  private lensedHeads = new Set<string>();
  private stories = new Map<string, Story>();
  private drafting = false;

  constructor(
    readonly ws: Workspace,
    readonly opts: ServerOptions,
  ) {}

  async init() {
    const range = await this.ws.range(this.opts.spec ?? this.opts.watch ?? undefined);
    this.base = range.base;
    this.head = await this.ws.git.resolve(range.head);
    this.watching = this.opts.watch !== undefined ? (this.opts.watch ?? range.branch) : range.branch;
    this.commits = await this.ws.git.commitsBetween(this.base, this.head);
    this.setStatus(`Measuring ${this.commits.length} commit${this.commits.length === 1 ? "" : "s"}`);
    await this.compare(this.head);
    this.setStatus("Ready");
    void this.tellStory(this.head);
    this.maybeDraftAreas();
  }

  start() {
    if (this.watching) setInterval(() => this.poll().catch((e) => this.setStatus(`Watch error: ${(e as Error).message}`)), 2000);
    // Lenses run on their own once the branch has been quiet for a while.
    setInterval(() => this.autoLenses(), 5000);
  }

  timeline(): Timeline {
    return { base: this.base, commits: this.commits, watching: this.watching, quietSeconds: this.opts.quietSeconds };
  }

  compare(head: string): Promise<Comparison> {
    const key = `${this.base}:${head}`;
    let c = this.comparisons.get(key);
    if (!c) {
      c = this.ws.compare(this.base, head).then((x) => {
        x.base.ref = this.opts.spec?.includes("..") ? this.opts.spec.split("..")[0] : "base";
        x.head.ref = this.watching ?? x.head.short;
        return x;
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
  async tellStory(head: string): Promise<Story> {
    const key = `${this.base}:${head}`;
    const existing = await this.story(head);
    if (existing.source === "claude" || existing.status === "running" || process.env.REFRACT_NO_STORY) return existing;
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
    this.stories.clear();
    const c = await this.compare(this.head);
    this.broadcast({ type: "comparison", payload: c });
    this.setStatus(message);
  }

  setStatus(message: string) {
    this.status = message;
    this.broadcast({ type: "status", payload: { message, at: new Date().toISOString() } });
  }

  subscribe(res: http.ServerResponse) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(`retry: 2000\n\n`);
    this.clients.add(res);
    const ping = setInterval(() => res.write(`: ping\n\n`), 20_000);
    res.on("close", () => {
      clearInterval(ping);
      this.clients.delete(res);
    });
  }

  broadcast(event: ServerEvent) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const c of this.clients) c.write(data);
  }
}

async function route(live: LiveState, req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const q = url.searchParams;
  const json = (body: unknown, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const head = async () => (q.get("head") ? await live.ws.git.resolve(q.get("head")!) : live.head);

  switch (url.pathname) {
    case "/api/events":
      live.subscribe(res);
      return;
    case "/api/state": {
      const h = await head();
      return json({
        timeline: live.timeline(),
        head: live.head,
        comparison: await live.compare(h),
        lenses: await live.lensReport(h),
        story: await live.story(h),
        status: live.status,
        areasPath: live.ws.areasPath,
      });
    }
    case "/api/compare":
      return json(await live.compare(await head()));
    case "/api/lenses": {
      const h = await head();
      return json(req.method === "POST" ? await live.runLenses(h) : await live.lensReport(h));
    }
    case "/api/story": {
      const h = await head();
      return json(req.method === "POST" ? await live.tellStory(h) : await live.story(h));
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
      const snap = await live.ws.store.snapshot(commit);
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
