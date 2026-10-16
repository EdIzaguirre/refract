import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import picomatch from "picomatch";
import YAML from "yaml";
import type { AreaDef, AreaMap, ClassUnit, Snapshot } from "../shared/types.js";
import { humanize, stem } from "./inflect.js";

/** Refract's own folder for a repository: ~/.refract/<repo>/. Nothing goes in the project. */
export function homeFor(repoName: string): string {
  const base = process.env.REFRACT_HOME ?? path.join(os.homedir(), ".refract");
  return path.join(base, repoName);
}

export function areasFile(repoName: string): string {
  return path.join(homeFor(repoName), "areas.yml");
}

export async function loadAreaFile(file: string): Promise<AreaMap | null> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
  const doc = YAML.parse(text) as { areas?: Partial<AreaDef>[] } | null;
  const areas = (doc?.areas ?? [])
    .filter((a) => a && a.name)
    .map((a, i) => ({
      id: a.id ?? slug(a.name!, i),
      name: a.name!,
      description: a.description,
      paths: (a.paths ?? []).map(String),
      classes: (a.classes ?? []).map(String),
    }));
  return { source: "file", file, areas };
}

export async function writeAreaFile(file: string, map: AreaMap, note: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const body = YAML.stringify({
    areas: map.areas.map((a) => ({
      name: a.name,
      ...(a.description ? { description: a.description } : {}),
      ...(a.classes.length ? { classes: a.classes } : {}),
      ...(a.paths.length ? { paths: a.paths } : {}),
    })),
  });
  const header = [
    `# Refract business areas. ${note}`,
    "# Edit freely: Refract re-reads this file whenever it changes.",
    "# A class goes to the first area whose `classes` globs match its name, else the first whose",
    "# `paths` globs match one of its files. Other files (views, tests) follow the class they belong to.",
    "",
  ].join("\n");
  await fs.writeFile(file, header + body);
}

function slug(name: string, i: number): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `area-${i}`;
}

export const UNASSIGNED = "unassigned";

/** Puts classes and files into areas, using the map's globs, then file-name stems for the rest. */
export class AreaAssigner {
  private classMatchers: { id: string; test: (s: string) => boolean }[];
  private pathMatchers: { id: string; test: (s: string) => boolean }[];
  private stemArea = new Map<string, string>();
  private classArea = new Map<string, string>();
  private exact = new Map<string, string>();

  constructor(
    readonly map: AreaMap,
    snapshots: Snapshot[],
  ) {
    // Exact class names skip glob matching; inferred maps list hundreds of them.
    for (const a of map.areas) for (const g of a.classes) if (!/[*?[\]{}!]/.test(g) && !this.exact.has(g)) this.exact.set(g, a.id);
    this.classMatchers = map.areas.flatMap((a) =>
      a.classes
        .filter((g) => /[*?[\]{}!]/.test(g))
        .map((g) => ({ id: a.id, test: picomatch(g.replace(/::/g, "/")) as (s: string) => boolean })),
    );
    this.pathMatchers = map.areas.flatMap((a) =>
      a.paths.map((g) => ({ id: a.id, test: picomatch(g, { dot: true }) as (s: string) => boolean })),
    );
    const pending: ClassUnit[] = [];
    const usedBy = new Map<string, string[]>();
    for (const snap of snapshots) {
      for (const u of Object.values(snap.classes)) {
        for (const d of u.dependsOn) if (d.kind !== "inherits") usedBy.set(d.to, [...(usedBy.get(d.to) ?? []), u.name]);
      }
    }
    for (const snap of snapshots) {
      for (const unit of Object.values(snap.classes)) {
        if (this.classArea.has(unit.name)) continue;
        const id = this.classAreaOf(unit);
        if (id === UNASSIGNED) {
          pending.push(unit);
          continue;
        }
        this.learn(unit, id);
      }
    }
    // Classes the map does not name (often ones the change adds) follow their
    // name, then the area most of their dependencies live in.
    for (const unit of pending) {
      if (this.classArea.has(unit.name)) continue;
      const byStem = this.stemArea.get(stem(unit.name).toLowerCase()) ?? unit.locations.map((l) => this.stemArea.get(fileStem(l.path))).find(Boolean);
      if (byStem) {
        this.learn(unit, byStem);
        continue;
      }
      const votes = new Map<string, number>();
      const vote = (name: string) => {
        const a = this.classArea.get(name);
        if (a) votes.set(a, (votes.get(a) ?? 0) + 1);
      };
      for (const d of unit.dependsOn) if (d.kind !== "inherits") vote(d.to);
      for (const user of usedBy.get(unit.name) ?? []) vote(user);
      const best = [...votes].sort((x, y) => y[1] - x[1])[0];
      if (best) this.learn(unit, best[0]);
    }
  }

  private learn(unit: ClassUnit, id: string) {
    this.classArea.set(unit.name, id);
    for (const loc of unit.locations) if (!this.stemArea.has(fileStem(loc.path))) this.stemArea.set(fileStem(loc.path), id);
    const s = stem(unit.name).toLowerCase();
    if (!this.stemArea.has(s)) this.stemArea.set(s, id);
  }

  private classAreaOf(unit: ClassUnit): string {
    const exact = this.exact.get(unit.name);
    if (exact) return exact;
    const key = unit.name.replace(/::/g, "/");
    for (const m of this.classMatchers) if (m.test(key)) return m.id;
    for (const loc of unit.locations) {
      for (const m of this.pathMatchers) if (m.test(loc.path)) return m.id;
    }
    return UNASSIGNED;
  }

  areaOfClass(name: string): string {
    return this.classArea.get(name) ?? UNASSIGNED;
  }

  areaOfFile(file: string): string {
    for (const m of this.pathMatchers) if (m.test(file)) return m.id;
    const s = fileStem(file);
    const hit = this.stemArea.get(s);
    if (hit) return hit;
    // Views and tests: app/views/org/client_invitations/_row.html.erb -> org/client_invitation.
    const parts = s.split("/");
    for (let i = parts.length; i > 0; i--) {
      const h = this.stemArea.get(parts.slice(0, i).join("/")) ?? this.stemArea.get(parts[i - 1]);
      if (h) return h;
    }
    return UNASSIGNED;
  }
}

const KIND_DIRS = new Set([
  "models", "controllers", "services", "jobs", "workers", "mailers", "helpers", "policies", "components",
  "views", "javascript", "assets", "serializers", "presenters", "decorators", "forms", "queries", "concerns",
  "channels", "validators", "system", "integration", "unit", "requests", "features", "fixtures", "factories",
]);

/** A path reduced to its domain words: rails_app/app/controllers/org/client_invitations_controller.rb -> org/client_invitation */
export function fileStem(file: string): string {
  let parts = file.split("/");
  const anchor = parts.findIndex((p) => p === "app" || p === "lib" || p === "test" || p === "spec");
  if (anchor >= 0) parts = parts.slice(anchor + 1);
  parts = parts.filter((p) => !KIND_DIRS.has(p));
  if (parts.length === 0) return "";
  const last = parts[parts.length - 1]
    .replace(/\..*$/, "")
    .replace(/^_/, "")
    .replace(/_(controller|job|mailer|helper|policy|serializer|component|service|test|spec|presenter|decorator|worker)$/, "");
  parts[parts.length - 1] = last;
  return parts
    .map((p) => p.replace(/ies$/, "y").replace(/([^s])s$/, "$1"))
    .join("/")
    .toLowerCase();
}

// ---------- inferred areas ----------

/**
 * Without an areas.yml, Refract groups classes by their dependencies and
 * names: a model and the controllers, jobs and services named after it
 * belong together. It is a first guess; Claude's draft replaces it.
 */
export function inferAreas(snapshot: Snapshot, maxAreas = 14): AreaMap {
  const units = Object.values(snapshot.classes);
  const names = units.map((u) => u.name);
  const weight = new Map<string, Map<string, number>>();
  const link = (a: string, b: string, w: number) => {
    if (a === b) return;
    for (const [x, y] of [[a, b], [b, a]]) {
      const m = weight.get(x) ?? new Map<string, number>();
      m.set(y, (m.get(y) ?? 0) + w);
      weight.set(x, m);
    }
  };

  const inbound = new Map<string, number>();
  for (const u of units) for (const d of u.dependsOn) inbound.set(d.to, (inbound.get(d.to) ?? 0) + 1);
  const hubLimit = Math.max(25, Math.ceil(units.length * 0.04));
  const isHub = (n: string) => (inbound.get(n) ?? 0) > hubLimit;

  for (const u of units) {
    for (const d of u.dependsOn) {
      if (isHub(d.to) || d.kind === "inherits") continue;
      link(u.name, d.to, d.kind === "association" ? 2 : d.kind === "includes" ? 0.5 : 1);
    }
  }
  // Name affinity: ClientInvitationsController and ClientInvitationEmailJob follow ClientInvitation.
  const models = units.filter((u) => u.role === "model").map((u) => u.name.split("::").pop()!);
  const modelSet = new Set(models);
  for (const u of units) {
    const s = stem(u.name);
    let best: string | null = null;
    for (const m of models) if (s.startsWith(m) && (!best || m.length > best.length)) best = m;
    if (best && modelSet.has(best)) {
      const target = units.find((x) => x.role === "model" && x.name.split("::").pop() === best);
      if (target) link(u.name, target.name, 3);
    }
  }

  // Label propagation: each class takes the label its neighbours weigh most.
  const label = new Map(names.map((n) => [n, n]));
  const order = [...names].sort();
  for (let round = 0; round < 25; round++) {
    let changed = 0;
    for (const n of order) {
      const nbrs = weight.get(n);
      if (!nbrs) continue;
      const score = new Map<string, number>();
      for (const [m, w] of nbrs) score.set(label.get(m)!, (score.get(label.get(m)!) ?? 0) + w);
      let best = label.get(n)!;
      let bestScore = score.get(best) ?? 0;
      for (const [l, s] of score) if (s > bestScore || (s === bestScore && l < best)) [best, bestScore] = [l, s];
      if (best !== label.get(n)) {
        label.set(n, best);
        changed++;
      }
    }
    if (!changed) break;
  }

  const groups = new Map<string, ClassUnit[]>();
  for (const u of units) {
    const l = label.get(u.name)!;
    groups.set(l, [...(groups.get(l) ?? []), u]);
  }
  const size = (g: ClassUnit[]) => g.reduce((s, u) => s + u.codeLines, 0);
  const sorted = [...groups.values()].sort((a, b) => size(b) - size(a));
  const kept = sorted.filter((g) => g.length >= 3).slice(0, maxAreas);
  const keptLabel = new Map<string, number>();
  kept.forEach((g, i) => g.forEach((u) => keptLabel.set(u.name, i)));
  // Strays join the kept group they are most tied to.
  const rest: ClassUnit[] = [];
  for (let pass = 0; pass < 3; pass++) {
    for (const g of sorted) {
      if (kept.includes(g)) continue;
      for (const u of g) {
        if (keptLabel.has(u.name)) continue;
        const votes = new Map<number, number>();
        for (const [m, w] of weight.get(u.name) ?? []) {
          const k = keptLabel.get(m);
          if (k !== undefined) votes.set(k, (votes.get(k) ?? 0) + w);
        }
        const best = [...votes].sort((x, y) => y[1] - x[1])[0];
        if (best) {
          kept[best[0]].push(u);
          keptLabel.set(u.name, best[0]);
        }
      }
    }
  }
  for (const u of units) if (!keptLabel.has(u.name)) rest.push(u);

  const used = new Set<string>();
  const areas: AreaDef[] = kept.map((g, i) => {
    let name = areaName(g);
    if (used.has(name)) name = `${name} ${i + 1}`;
    used.add(name);
    return { id: slug(name, i), name, paths: [], classes: g.map((u) => u.name).sort() };
  });
  if (rest.length) areas.push({ id: "other", name: "Everything else", paths: [], classes: rest.map((u) => u.name).sort() });
  return { source: "inferred", areas };
}

function areaName(group: ClassUnit[]): string {
  const ranked = [...group].sort((a, b) => b.codeLines - a.codeLines);
  const model = ranked.find((u) => u.role === "model");
  const lead = model ?? ranked[0];
  return humanize(stem(lead.name.split("::").pop()!));
}
