import type {
  AreaChange,
  AreaEdge,
  ChangedFile,
  ChangeStatus,
  ClassChange,
  ClassUnit,
  Comparison,
  CommitInfo,
  Delta,
  EdgeChange,
  MethodChange,
  MethodFacts,
  Shape,
  Snapshot,
  Tone,
} from "../shared/types.js";
import { AreaAssigner, UNASSIGNED } from "./areas.js";

export interface CompareInput {
  repo: { name: string; root: string };
  base: CommitInfo & { ref: string };
  head: CommitInfo & { ref: string };
  before: Snapshot;
  after: Snapshot;
  changed: { path: string; status: "A" | "M" | "D" | "R"; additions: number; deletions: number }[];
  areas: AreaAssigner;
  isTest: (file: string) => boolean;
  claims: (file: string) => boolean;
}

/** Ousterhout's box: width is what callers see, height is the code behind it. */
export function shapeOf(u: ClassUnit): Shape {
  const exposed = u.role === "controller" ? u.helperMethods.length : 0;
  return { interface: u.publicMethods.length + exposed, codeLines: u.codeLines, methods: u.methods.length };
}

/** Lines of code per public method; a rough read on how deep a class is. */
export function depth(s: Shape): number {
  return s.codeLines / Math.max(1, s.interface);
}

export function compare(input: CompareInput): Comparison {
  const { before, after, areas } = input;
  const changedPaths = new Set(input.changed.map((c) => c.path));

  // ---- classes ----
  const names = new Set([...Object.keys(before.classes), ...Object.keys(after.classes)]);
  const descendants = countDescendants(after);
  const classes: ClassChange[] = [];
  for (const name of names) {
    const b = before.classes[name] ?? null;
    const a = after.classes[name] ?? null;
    const touched = [...(b?.locations ?? []), ...(a?.locations ?? [])].some((l) => changedPaths.has(l.path));
    const methods = touched ? methodChanges(b, a) : [];
    let status: ChangeStatus;
    if (!b) status = "added";
    else if (!a) status = "removed";
    else if (touched && (methods.some((m) => m.status !== "unchanged") || !sameShape(b, a) || !sameDeps(b, a))) status = "changed";
    else status = "unchanged";
    classes.push({
      name,
      area: areas.areaOfClass(name),
      role: (a ?? b)!.role,
      status,
      touched,
      shape: { before: b ? shapeOf(b) : null, after: a ? shapeOf(a) : null },
      methods,
      paths: [...new Set([...(a?.locations ?? []), ...(b?.locations ?? [])].map((l) => l.path))],
      descendants: descendants.get(name) ?? 0,
      superclass: (a ?? b)!.superclass,
      nested: (a ?? b)!.nested,
      // Full facts only travel for classes the change touched; the rest stay small.
      before: touched ? b : null,
      after: touched ? a : null,
    });
  }
  classes.sort((x, y) => x.name.localeCompare(y.name));

  // ---- dependency edges ----
  const edgeKey = (f: string, t: string) => `${f}\u0000${t}`;
  const edges = new Map<string, EdgeChange>();
  for (const [side, snap] of [["before", before], ["after", after]] as const) {
    for (const u of Object.values(snap.classes)) {
      for (const d of u.dependsOn) {
        const k = edgeKey(u.name, d.to);
        const e = edges.get(k) ?? { from: u.name, to: d.to, kind: d.kind, status: "unchanged", before: 0, after: 0 };
        e[side] = d.count;
        if (side === "after") e.kind = d.kind;
        edges.set(k, e);
      }
    }
  }
  for (const e of edges.values()) e.status = e.before === 0 ? "added" : e.after === 0 ? "removed" : "unchanged";

  // ---- files and areas ----
  const files: ChangedFile[] = input.changed.map((c) => ({
    ...c,
    area: areaOrNull(areas.areaOfFile(c.path)),
    kind: input.isTest(c.path) ? "test" : input.claims(c.path) || /(^|\/)app\//.test(c.path) ? "app" : "other",
  }));

  const areaChanges = new Map<string, AreaChange>();
  const areaDefs = [...areas.map.areas, { id: UNASSIGNED, name: "Unassigned", paths: [], classes: [] }];
  for (const def of areaDefs) {
    areaChanges.set(def.id, {
      id: def.id,
      name: def.name,
      description: "description" in def ? def.description : undefined,
      status: "unchanged",
      before: { files: 0, codeLines: 0, classes: 0 },
      after: { files: 0, codeLines: 0, classes: 0 },
      changedFiles: 0,
      changedClasses: 0,
    });
  }
  const bump = (id: string) => areaChanges.get(id) ?? areaChanges.get(UNASSIGNED)!;
  for (const [side, snap] of [["before", before], ["after", after]] as const) {
    for (const f of Object.keys(snap.files)) bump(areas.areaOfFile(f))[side].files++;
    for (const u of Object.values(snap.classes)) {
      const a = bump(areas.areaOfClass(u.name));
      a[side].classes++;
      a[side].codeLines += u.codeLines;
    }
  }
  for (const f of files) if (f.kind !== "other") bump(f.area ?? UNASSIGNED).changedFiles++;
  for (const c of classes) if (c.status !== "unchanged") bump(c.area).changedClasses++;
  for (const a of areaChanges.values()) {
    if (a.before.classes === 0 && a.after.classes > 0) a.status = "added";
    else if (a.after.classes === 0 && a.before.classes > 0) a.status = "removed";
    else if (a.changedClasses > 0 || a.changedFiles > 0) a.status = "changed";
  }

  const areaEdgeMap = new Map<string, AreaEdge>();
  for (const e of edges.values()) {
    const fa = areas.areaOfClass(e.from);
    const ta = areas.areaOfClass(e.to);
    if (fa === ta) continue;
    const k = edgeKey(fa, ta);
    const ae = areaEdgeMap.get(k) ?? { from: fa, to: ta, before: 0, after: 0 };
    if (e.before) ae.before++;
    if (e.after) ae.after++;
    areaEdgeMap.set(k, ae);
  }

  const areaList = [...areaChanges.values()].filter((a) => a.before.classes + a.after.classes + a.changedFiles > 0);
  const deltas = findDeltas(classes, [...edges.values()], [...areaEdgeMap.values()], areaList);
  const verdict = judge(deltas, classes);

  const app = files.filter((f) => f.kind === "app");
  const tests = files.filter((f) => f.kind === "test");
  return {
    repo: input.repo,
    base: input.base,
    head: input.head,
    verdict,
    deltas,
    areas: areaList,
    areaEdges: [...areaEdgeMap.values()],
    classes,
    edges: [...edges.values()],
    files,
    stats: {
      files: files.length,
      additions: files.reduce((s, f) => s + f.additions, 0),
      deletions: files.reduce((s, f) => s + f.deletions, 0),
      appFiles: app.length,
      testFiles: tests.length,
    },
    areaSource: areas.map.source,
    areaFile: areas.map.file,
    generatedAt: new Date().toISOString(),
  };
}

function areaOrNull(id: string): string | null {
  return id === UNASSIGNED ? null : id;
}

function sameShape(b: ClassUnit, a: ClassUnit): boolean {
  const x = shapeOf(b);
  const y = shapeOf(a);
  return x.interface === y.interface && x.codeLines === y.codeLines && x.methods === y.methods;
}

function sameDeps(b: ClassUnit, a: ClassUnit): boolean {
  return b.dependsOn.map((d) => d.to).join() === a.dependsOn.map((d) => d.to).join();
}

function methodChanges(b: ClassUnit | null, a: ClassUnit | null): MethodChange[] {
  const key = (m: MethodFacts) => `${m.scope}:${m.name}`;
  const pick = (m: MethodFacts) => ({ visibility: m.visibility, codeLines: m.codeLines, params: m.params, branches: m.branches });
  const bm = new Map((b?.methods ?? []).map((m) => [key(m), m]));
  const am = new Map((a?.methods ?? []).map((m) => [key(m), m]));
  const out: MethodChange[] = [];
  for (const k of new Set([...bm.keys(), ...am.keys()])) {
    const x = bm.get(k);
    const y = am.get(k);
    const m = (y ?? x)!;
    let status: ChangeStatus = "unchanged";
    if (!x) status = "added";
    else if (!y) status = "removed";
    else if (x.codeLines !== y.codeLines || x.params !== y.params || x.visibility !== y.visibility || x.branches !== y.branches)
      status = "changed";
    out.push({ name: m.name, scope: m.scope, status, before: x ? pick(x) : null, after: y ? pick(y) : null });
  }
  return out;
}

function countDescendants(snap: Snapshot): Map<string, number> {
  const children = new Map<string, string[]>();
  for (const u of Object.values(snap.classes)) {
    const parent = u.dependsOn.find((d) => d.kind === "inherits")?.to;
    if (parent) children.set(parent, [...(children.get(parent) ?? []), u.name]);
  }
  const memo = new Map<string, number>();
  const count = (n: string, seen = new Set<string>()): number => {
    if (memo.has(n)) return memo.get(n)!;
    if (seen.has(n)) return 0;
    seen.add(n);
    const total = (children.get(n) ?? []).reduce((s, c) => s + 1 + count(c, seen), 0);
    memo.set(n, total);
    return total;
  };
  for (const n of Object.keys(snap.classes)) count(n);
  return memo;
}

// ---------- deltas: the handful of measured changes that drive the verdict ----------

const LARGE_CLASS = 300;

function findDeltas(classes: ClassChange[], edges: EdgeChange[], areaEdges: AreaEdge[], areas: AreaChange[]): Delta[] {
  const deltas: Delta[] = [];
  const areaName = (id: string) => areas.find((a) => a.id === id)?.name ?? id;
  const moved = classes.filter((c) => c.status !== "unchanged");

  // 1. Who depends on whom: a class many places used to reach directly, now reached through fewer.
  const inbound = (side: "before" | "after") => {
    const m = new Map<string, Set<string>>();
    for (const e of edges) if (e[side] && e.kind !== "inherits") m.set(e.to, (m.get(e.to) ?? new Set()).add(e.from));
    return m;
  };
  const inB = inbound("before");
  const inA = inbound("after");
  const touchedNames = new Set(moved.map((c) => c.name));
  const fanIn = [...new Set([...inB.keys(), ...inA.keys()])]
    .map((to) => {
      const b = inB.get(to) ?? new Set<string>();
      const a = inA.get(to) ?? new Set<string>();
      const changedCallers = [...b, ...a].filter((n) => touchedNames.has(n)).length;
      return { to, b: b.size, a: a.size, changedCallers };
    })
    .filter((f) => f.changedCallers > 0 && f.b !== f.a);
  const consolidated = fanIn.filter((f) => f.b >= 2 && f.a < f.b).sort((x, y) => y.b - y.a - (x.b - x.a))[0];
  if (consolidated) {
    deltas.push({
      id: `fanin-down-${consolidated.to}`,
      what: `Classes that depend on ${consolidated.to} directly`,
      before: String(consolidated.b),
      after: String(consolidated.a),
      change: `${consolidated.a - consolidated.b}`,
      tone: "good",
      why: `Fewer places know about ${consolidated.to}, so a change to it reaches fewer files.`,
      target: { kind: "class", name: consolidated.to },
    });
  }
  const spread = fanIn.filter((f) => f.a - f.b >= 3 && classes.find((c) => c.name === f.to)?.status !== "added").sort((x, y) => y.a - y.b - (x.a - x.b))[0];
  if (spread) {
    deltas.push({
      id: `fanin-up-${spread.to}`,
      what: `Classes that depend on ${spread.to} directly`,
      before: String(spread.b),
      after: String(spread.a),
      change: `+${spread.a - spread.b}`,
      tone: "ask",
      why: `More places now know about ${spread.to}. Is that knowledge leaking?`,
      target: { kind: "class", name: spread.to },
    });
  }

  // 2. Large classes that grew or shrank.
  const sized = moved
    .filter((c) => c.shape.before && c.shape.after)
    .map((c) => ({ c, d: c.shape.after!.codeLines - c.shape.before!.codeLines }))
    .filter(({ c, d }) => d !== 0 && Math.max(c.shape.before!.codeLines, c.shape.after!.codeLines) >= LARGE_CLASS / 2);
  const shrank = sized.filter((s) => s.d < 0).sort((x, y) => x.d - y.d)[0];
  const grew = sized.filter((s) => s.d > 0).sort((x, y) => y.d - x.d)[0];
  for (const s of [shrank, grew]) {
    if (!s) continue;
    const big = s.c.shape.after!.codeLines >= LARGE_CLASS;
    deltas.push({
      id: `size-${s.c.name}`,
      what: `${s.c.name}, code lines`,
      before: String(s.c.shape.before!.codeLines),
      after: String(s.c.shape.after!.codeLines),
      change: s.d > 0 ? `+${s.d}` : String(s.d),
      tone: s.d < 0 ? "good" : big ? "bad" : "ask",
      why:
        s.d < 0
          ? big
            ? `Smaller, but still over ${LARGE_CLASS} lines.`
            : "Smaller."
          : big
            ? `A large class got larger.`
            : "Grew.",
      target: { kind: "class", name: s.c.name },
    });
  }

  // 3. New classes, and how deep they are.
  const added = moved.filter((c) => c.status === "added" && c.shape.after);
  if (added.length) {
    const deep = added.filter((c) => depth(c.shape.after!) >= 25);
    const shallow = added.filter((c) => c.shape.after!.interface >= 3 && depth(c.shape.after!) < 8);
    const list = added
      .slice(0, 3)
      .map((c) => `${c.name}: ${c.shape.after!.interface} public over ${c.shape.after!.codeLines} lines`)
      .join(". ");
    deltas.push({
      id: "new-classes",
      what: added.length === 1 ? "New class" : "New classes",
      before: null,
      after: String(added.length),
      change: shallow.length ? `${shallow.length} shallow` : deep.length ? `${deep.length} deep` : "new",
      tone: shallow.length ? "ask" : deep.length ? "good" : "flat",
      why: list + (added.length > 3 ? `, and ${added.length - 3} more.` : "."),
      target: { kind: "class", name: (shallow[0] ?? deep[0] ?? added[0]).name },
    });
  }

  // 4. Interfaces that widened on classes many others inherit.
  const widened = moved
    .filter((c) => c.shape.before && c.shape.after && c.shape.after.interface > c.shape.before.interface && c.descendants >= 5)
    .sort((x, y) => y.descendants - x.descendants)[0];
  if (widened) {
    deltas.push({
      id: `widened-${widened.name}`,
      what: `${widened.name}, interface`,
      before: String(widened.shape.before!.interface),
      after: String(widened.shape.after!.interface),
      change: `inherited by ${widened.descendants}`,
      tone: "ask",
      why: `Every subclass now inherits ${widened.shape.after!.interface - widened.shape.before!.interface} more. Do they all need it?`,
      target: { kind: "class", name: widened.name },
    });
  }

  // 5. Dependencies between business areas.
  const newAreaLinks = areaEdges.filter((e) => e.before === 0 && e.after > 0 && e.from !== UNASSIGNED && e.to !== UNASSIGNED);
  const goneAreaLinks = areaEdges.filter((e) => e.before > 0 && e.after === 0 && e.from !== UNASSIGNED && e.to !== UNASSIGNED);
  deltas.push({
    id: "area-links",
    what: "Dependencies between business areas",
    before: null,
    after: newAreaLinks.length || goneAreaLinks.length ? `${newAreaLinks.length} new, ${goneAreaLinks.length} gone` : "unchanged",
    change: newAreaLinks.length ? `+${newAreaLinks.length}` : goneAreaLinks.length ? `−${goneAreaLinks.length}` : "0 new",
    tone: newAreaLinks.length ? "bad" : goneAreaLinks.length ? "good" : "flat",
    why: newAreaLinks.length
      ? newAreaLinks
          .slice(0, 3)
          .map((e) => `${areaName(e.from)} now depends on ${areaName(e.to)}`)
          .join("; ") + "."
      : goneAreaLinks.length
        ? goneAreaLinks
            .slice(0, 3)
            .map((e) => `${areaName(e.from)} no longer depends on ${areaName(e.to)}`)
            .join("; ") + "."
        : "No area depends on a new area.",
    target: newAreaLinks[0] ? { kind: "area", name: newAreaLinks[0].from } : undefined,
  });

  // 6. Branching in the methods that changed.
  const branch = (side: "before" | "after") =>
    moved.flatMap((c) => c.methods.filter((m) => m.status !== "unchanged")).reduce((s, m) => s + (m[side]?.branches ?? 0), 0);
  const bb = branch("before");
  const ba = branch("after");
  if (bb !== ba && Math.abs(ba - bb) >= 3) {
    deltas.push({
      id: "branches",
      what: "Branches (if, case, rescue, &&) in changed methods",
      before: String(bb),
      after: String(ba),
      change: ba > bb ? `+${ba - bb}` : String(ba - bb),
      tone: ba < bb ? "good" : "ask",
      why: ba < bb ? "Fewer paths through the code to hold in your head." : "More special cases to hold in your head.",
    });
  }

  // 7. Dependencies between classes overall.
  const touchedEdges = edges.filter((e) => touchedNames.has(e.from));
  const eAdded = touchedEdges.filter((e) => e.status === "added").length;
  const eRemoved = touchedEdges.filter((e) => e.status === "removed").length;
  if (eAdded || eRemoved) {
    deltas.push({
      id: "class-links",
      what: "Dependencies from the changed classes",
      before: String(touchedEdges.filter((e) => e.before).length),
      after: String(touchedEdges.filter((e) => e.after).length),
      change: `+${eAdded} −${eRemoved}`,
      tone: eAdded > eRemoved + 2 ? "ask" : eRemoved > eAdded ? "good" : "flat",
      why: "Each dependency is something a reader must know about when changing the class.",
    });
  }
  return deltas;
}

function judge(deltas: Delta[], classes: ClassChange[]): Comparison["verdict"] {
  const count = (t: Tone) => deltas.filter((d) => d.tone === t).length;
  const good = count("good");
  const bad = count("bad");
  const ask = count("ask");
  const moved = classes.filter((c) => c.status !== "unchanged").length;
  // Better against worse decides the word; questions are never counted as worse, they only add "with questions".
  let label: string;
  let tone: Tone;
  const q = ask ? ", with questions" : "";
  if (moved === 0) [label, tone] = ["No structural change", "flat"];
  else if (good + bad + ask === 0) [label, tone] = ["Small change", "flat"];
  else if (good > bad) [label, tone] = [(bad === 0 ? "Better" : "Mostly better") + q, ask ? "ask" : "good"];
  else if (bad > good) [label, tone] = [(good === 0 ? "Worse" : "Mostly worse") + q, "bad"];
  else if (good > 0) [label, tone] = ["Mixed" + q, "ask"];
  else [label, tone] = ["Questions to ask", "ask"];
  const added = classes.filter((c) => c.status === "added").length;
  const removed = classes.filter((c) => c.status === "removed").length;
  const changed = classes.filter((c) => c.status === "changed").length;
  const parts = [
    changed && `${changed} class${changed === 1 ? "" : "es"} changed`,
    added && `${added} added`,
    removed && `${removed} removed`,
  ].filter(Boolean);
  const summary = `${parts.join(", ") || "No classes changed"}. ${good} measure${good === 1 ? "" : "s"} improved, ${bad} got worse and ${ask} raise${ask === 1 ? "s" : ""} a question.`;
  return { label, tone, summary, good, bad, ask };
}
