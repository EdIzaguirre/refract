import fs from "node:fs/promises";
import path from "node:path";
import type { ClassFacts, ClassUnit, Dependency, FileFacts, MethodFacts, Role, Snapshot } from "../shared/types.js";
import type { Git } from "./git.js";
import type { Reader } from "./reader.js";
import { camelize, singularize } from "./inflect.js";

/**
 * Builds and caches one Snapshot per commit. Facts are cached per blob, so a
 * new commit only re-reads the files it changed. Everything lives under
 * .git/refract, never in the project's own files.
 */
export class SnapshotStore {
  private memory = new Map<string, Promise<Snapshot>>();

  constructor(
    private readonly git: Git,
    private readonly reader: Reader,
  ) {}

  private async dir(...parts: string[]): Promise<string> {
    const dir = path.join(await this.git.gitDir(), "refract", ...parts);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  snapshot(commit: string): Promise<Snapshot> {
    let pending = this.memory.get(commit);
    if (!pending) {
      pending = this.build(commit);
      pending.catch(() => this.memory.delete(commit));
      this.memory.set(commit, pending);
      if (this.memory.size > 40) this.memory.delete(this.memory.keys().next().value!);
    }
    return pending;
  }

  private async build(commit: string): Promise<Snapshot> {
    // Facts are cached per blob on disk; assembling them is quick, so snapshots are only kept in memory.
    const tree = await this.git.tree(commit);
    const wanted = [...tree].filter(([p]) => this.reader.claims(p));
    const facts = await this.factsFor(wanted.map(([p, blob]) => ({ path: p, blob })));
    return assemble(commit, facts, [...tree.keys()]);
  }

  private async factsFor(files: { path: string; blob: string }[]): Promise<FileFacts[]> {
    const blobDir = await this.dir("blobs", this.reader.version);
    const found: FileFacts[] = [];
    const missing: { path: string; blob: string }[] = [];
    await Promise.all(
      files.map(async (f) => {
        try {
          const cached = JSON.parse(await fs.readFile(path.join(blobDir, `${f.blob}.json`), "utf8")) as FileFacts;
          found.push({ ...cached, path: f.path });
        } catch {
          missing.push(f);
        }
      }),
    );
    if (missing.length) {
      const sources = await this.git.readBlobs(missing.map((m) => m.blob));
      const read = await this.reader.read(missing.map((m) => ({ ...m, source: sources.get(m.blob) ?? "" })));
      await Promise.all(read.map((r) => fs.writeFile(path.join(blobDir, `${r.blob}.json`), JSON.stringify(r))));
      found.push(...read);
    }
    return found.sort((a, b) => a.path.localeCompare(b.path));
  }
}

/** Folds per-file class facts into the classes Refract draws, and resolves their dependencies. */
export function assemble(commit: string, facts: FileFacts[], allFiles: string[]): Snapshot {
  const raw = new Map<string, { facts: ClassFacts; path: string }[]>();
  for (const file of facts) {
    for (const c of file.classes) {
      const list = raw.get(c.name) ?? [];
      list.push({ facts: c, path: file.path });
      raw.set(c.name, list);
    }
  }

  // A nested class folds into its outer class (a service's Result). Classes
  // nested in a module stay separate: the module is a namespace.
  const foldInto = new Map<string, string>();
  const isNamespaceOnly = (name: string) =>
    (raw.get(name) ?? []).every((r) => r.facts.methods.length === 0 && r.facts.kind === "module");
  for (const [name, defs] of raw) {
    for (const { facts: c } of defs) {
      if (c.nestedIn && raw.get(c.nestedIn)?.some((r) => r.facts.kind === "class")) foldInto.set(name, c.nestedIn);
    }
  }
  const unitOf = (name: string): string => {
    let n = name;
    for (let i = 0; i < 10 && foldInto.has(n); i++) n = foldInto.get(n)!;
    return n;
  };

  const classes: Record<string, ClassUnit> = {};
  for (const [name, defs] of raw) {
    if (foldInto.has(name)) continue;
    // A module that only namespaces other classes is not drawn.
    if (isNamespaceOnly(name) && defs.every((d) => d.facts.includes.length === 0 && d.facts.extends.length === 0)) continue;
    const methods: MethodFacts[] = defs.flatMap((d) => d.facts.methods);
    const first = defs[0];
    classes[name] = {
      name,
      kind: first.facts.kind,
      role: roleOf(first.path, first.facts),
      superclass: defs.find((d) => d.facts.superclass)?.facts.superclass ?? null,
      locations: defs.map((d) => ({ path: d.path, line: d.facts.line, endLine: d.facts.endLine })),
      codeLines: defs.reduce((s, d) => s + d.facts.codeLines, 0),
      publicMethods: uniq(
        methods
          .filter((m) => m.visibility === "public" && !(m.name === "initialize" && m.scope === "instance"))
          .map((m) => (m.scope === "class" ? `self.${m.name}` : m.name)),
      ),
      helperMethods: uniq(defs.flatMap((d) => d.facts.helperMethods)),
      methods,
      nested: [],
      includes: uniq(defs.flatMap((d) => d.facts.includes)),
      callbacks: defs.flatMap((d) => d.facts.callbacks),
      associations: defs.flatMap((d) => d.facts.associations),
      validations: defs.reduce((s, d) => s + d.facts.validations, 0),
      dependsOn: [],
    };
  }

  // Nested classes add their code and their references to the outer class.
  const refs = new Map<string, { facts: ClassFacts; scope: string }[]>();
  for (const [name, defs] of raw) {
    const unit = unitOf(name);
    if (!classes[unit]) continue;
    if (unit !== name) {
      classes[unit].nested.push(name);
      classes[unit].codeLines += defs.reduce((s, d) => s + d.facts.codeLines, 0);
    }
    const list = refs.get(unit) ?? [];
    for (const d of defs) list.push({ facts: d.facts, scope: name });
    refs.set(unit, list);
  }

  const resolve = (text: string, scope: string): string | null => {
    const parts = scope.split("::");
    for (let i = parts.length; i >= 0; i--) {
      const candidate = [...parts.slice(0, i), text].join("::");
      if (raw.has(candidate)) {
        const unit = unitOf(candidate);
        return classes[unit] ? unit : null;
      }
    }
    return null;
  };

  const rank: Record<Dependency["kind"], number> = { inherits: 5, includes: 4, association: 3, call: 2, reference: 1 };
  for (const [unit, list] of refs) {
    const deps = new Map<string, Dependency>();
    const add = (to: string | null, kind: Dependency["kind"]) => {
      if (!to || to === unit) return;
      const existing = deps.get(to);
      if (!existing) deps.set(to, { to, kind, count: 1 });
      else {
        existing.count += 1;
        if (rank[kind] > rank[existing.kind]) existing.kind = kind;
      }
    };
    for (const { facts: c, scope } of list) {
      const outer = scope.split("::").slice(0, -1).join("::");
      if (c.superclass) add(resolve(c.superclass, outer), "inherits");
      for (const inc of [...c.includes, ...c.extends]) add(resolve(inc, scope), "includes");
      for (const a of c.associations) {
        const target = a.className ?? camelize(a.kind === "has_many" || a.kind === "has_and_belongs_to_many" ? singularize(a.name) : a.name);
        add(resolve(target, scope), "association");
      }
      const seen = new Set<string>();
      for (const r of c.references) {
        if (r === c.superclass || c.includes.includes(r)) continue;
        const to = resolve(r, scope);
        if (to && !seen.has(to)) {
          seen.add(to);
          add(to, "reference");
        }
      }
    }
    classes[unit].dependsOn = [...deps.values()].sort((a, b) => a.to.localeCompare(b.to));
  }

  const files: Snapshot["files"] = {};
  for (const f of facts) {
    files[f.path] = {
      blob: f.blob,
      codeLines: f.codeLines,
      classes: uniq(f.classes.map((c) => unitOf(c.name)).filter((n) => classes[n])),
      errors: f.errors,
    };
  }
  return { commit, files, classes, allFiles };
}

function roleOf(file: string, c: ClassFacts): Role {
  const p = file.replace(/^.*?(^|\/)(app|lib)\//, "$2/");
  if (p.includes("/concerns/")) return "concern";
  const dir = p.split("/")[1];
  const byDir: Record<string, Role> = {
    models: "model",
    controllers: "controller",
    services: "service",
    jobs: "job",
    workers: "job",
    mailers: "mailer",
    helpers: "helper",
    policies: "policy",
    components: "component",
  };
  if (p.startsWith("lib/")) return "lib";
  if (byDir[dir]) return byDir[dir];
  const sup = c.superclass ?? "";
  if (/Controller$/.test(sup)) return "controller";
  if (/Record$|ActiveRecord::Base/.test(sup)) return "model";
  if (/Job$/.test(sup)) return "job";
  if (/Mailer$/.test(sup)) return "mailer";
  return "other";
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
