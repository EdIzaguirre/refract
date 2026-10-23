import type {
  ChangedFile,
  ChangeStatus,
  ClassUnit,
  Comparison,
  Holding,
  LifecycleChange,
  MethodFacts,
  ProductChanges,
  Role,
  RuleChange,
  ScreenChange,
  Snapshot,
  Story,
  StoryStop,
  TableChange,
} from "../shared/types.js";
import type { Plan, PlanMethod } from "./plan.js";
import type { Git } from "./git.js";
import { camelize, singularize, underscore } from "./inflect.js";
import { parseSchema, readLifecycles } from "./product.js";

/**
 * The plan drawn as the "after" side: today's snapshot with the plan's
 * classes, methods and dependencies laid on top, so every view Refract has
 * (the product page, the summary drawings, the map, request flows) can show a
 * change before anyone writes it.
 */

/** A planned class has no code yet; this many lines gives it a short box. */
export const PLANNED_LINES = 40;

export interface PlanOverlay {
  after: Snapshot;
  /** Files the plan would add or change, so the comparison counts them as touched. */
  changed: { path: string; status: ChangedFile["status"]; additions: number; deletions: number }[];
  /** Classes the plan adds or reshapes. */
  planned: Set<string>;
  /** New classes, whose size is unknown. */
  created: Set<string>;
  /** Dependencies the plan adds, as "from>to". */
  plannedEdges: Set<string>;
}

const DIR: Partial<Record<Role, string>> = {
  model: "models",
  controller: "controllers",
  service: "services",
  job: "jobs",
  mailer: "mailers",
  policy: "policies",
  helper: "helpers",
  component: "components",
};

export function roleFromName(name: string): Role | null {
  if (/Controller$/.test(name)) return "controller";
  if (/Policy$/.test(name)) return "policy";
  if (/Job$/.test(name)) return "job";
  if (/Mailer$/.test(name)) return "mailer";
  if (/Helper$/.test(name)) return "helper";
  if (/Component$/.test(name)) return "component";
  return null;
}

/** The folder in front of app/ that most classes live under: "" for a plain Rails app, "rails_app/" in a monorepo. */
function appRoot(snap: Snapshot): string {
  const counts = new Map<string, number>();
  for (const u of Object.values(snap.classes)) {
    const m = u.locations[0]?.path.match(/^(.*?)app\//);
    if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

/** A name as the plan writes it, matched to a class that exists: exact, else the one class ending in ::Name. */
export function findClass(names: Iterable<string>, name: string): string | null {
  const all = [...names];
  if (all.includes(name)) return name;
  const hits = all.filter((n) => n.endsWith(`::${name}`));
  return hits.length === 1 ? hits[0] : null;
}

export const modelFor = (table: string) => camelize(singularize(table));

export function overlayPlan(plan: Plan, before: Snapshot): PlanOverlay {
  const classes: Record<string, ClassUnit> = {};
  for (const [n, u] of Object.entries(before.classes)) classes[n] = u;
  const root = appRoot(before);
  const planned = new Set<string>();
  const created = new Set<string>();
  const plannedEdges = new Set<string>();
  const changed = new Map<string, ChangedFile["status"]>();

  // A class the plan reshapes is copied before it is touched, so today's snapshot stays as it was.
  const edit = (name: string, role: Role | null): ClassUnit => {
    const existing = findClass(Object.keys(classes), name);
    if (existing) {
      if (!planned.has(existing)) {
        const u = classes[existing];
        classes[existing] = {
          ...u,
          methods: [...u.methods],
          publicMethods: [...u.publicMethods],
          dependsOn: u.dependsOn.map((d) => ({ ...d })),
          associations: [...u.associations],
        };
        planned.add(existing);
        if (!changed.has(u.locations[0]?.path)) changed.set(u.locations[0]?.path, "M");
      }
      return classes[existing];
    }
    const r = role ?? roleFromName(name) ?? "service";
    const file = `${root}app/${DIR[r] ?? "services"}/${underscore(name)}.rb`;
    const unit: ClassUnit = {
      name,
      kind: "class",
      role: r,
      superclass: null,
      locations: [{ path: file, line: 1, endLine: 1 }],
      codeLines: PLANNED_LINES,
      publicMethods: [],
      helperMethods: [],
      methods: [],
      nested: [],
      includes: [],
      callbacks: [],
      associations: [],
      validations: 0,
      dependsOn: [],
    };
    classes[name] = unit;
    planned.add(name);
    created.add(name);
    changed.set(file, "A");
    return unit;
  };

  const addMethod = (u: ClassUnit, m: { name: string; scope: "instance" | "class"; params?: number | null }) => {
    if (u.methods.some((x) => x.name === m.name && x.scope === m.scope)) return u.methods.find((x) => x.name === m.name && x.scope === m.scope)!;
    const facts: MethodFacts = {
      name: m.name,
      scope: m.scope,
      visibility: "public",
      params: m.params ?? 0,
      line: 0,
      endLine: 0,
      codeLines: 0,
      branches: 0,
      calls: [],
      kind: "planned",
    };
    u.methods.push(facts);
    const label = m.scope === "class" ? `self.${m.name}` : m.name;
    if (!u.publicMethods.includes(label)) u.publicMethods.push(label);
    return facts;
  };
  const removeMethod = (u: ClassUnit, name: string, scope: "instance" | "class" = "instance") => {
    u.methods = u.methods.filter((x) => !(x.name === name && x.scope === scope));
    u.publicMethods = u.publicMethods.filter((x) => x !== (scope === "class" ? `self.${name}` : name));
  };
  const depend = (u: ClassUnit, to: string, kind: "association" | "reference" | "call", has?: Holding) => {
    const target = findClass(Object.keys(classes), to);
    if (!target || target === u.name) return;
    const d = u.dependsOn.find((x) => x.to === target);
    if (d) {
      if (has && !d.has) d.has = has;
      return;
    }
    u.dependsOn.push({ to: target, kind, count: 1, ...(has ? { has } : {}) });
    u.dependsOn.sort((a, b) => a.to.localeCompare(b.to));
    plannedEdges.add(`${u.name}>${target}`);
  };

  // 1. The classes the plan names, before anything refers to them.
  const tableModels = plan.tables.filter((t) => t.isNew).map((t) => ({ t, model: modelFor(t.name) }));
  for (const { model } of tableModels) if (!findClass(Object.keys(classes), model)) edit(model, "model");
  for (const k of plan.classes) edit(k.name, k.role ?? null);
  for (const s of plan.screens) edit(s.controller, "controller");
  for (const p of plan.permissions) edit(p.policy, "policy");
  for (const j of plan.jobs) edit(j.name, roleFromName(j.name) ?? "job");

  // 2. Their public methods: classes' signatures, controller actions, policy rules, mailer emails.
  const sig = (u: ClassUnit, m: PlanMethod) => addMethod(u, m);
  for (const k of plan.classes) {
    const u = edit(k.name, null);
    for (const m of k.public) sig(u, m);
    for (const m of k.remove) removeMethod(u, m.name, m.scope);
  }
  for (const s of plan.screens) {
    const u = edit(s.controller, "controller");
    for (const a of s.actions) a.op === "-" ? removeMethod(u, a.name) : addMethod(u, { name: a.name, scope: "instance" });
  }
  for (const p of plan.permissions) {
    const u = edit(p.policy, "policy");
    for (const r of p.rules) r.op === "-" ? removeMethod(u, r.name) : addMethod(u, { name: r.name, scope: "instance" });
  }
  for (const j of plan.jobs) {
    const u = edit(j.name, null);
    for (const m of j.methods) addMethod(u, { name: m, scope: "instance" });
  }

  // 3. Dependencies: what classes say they use, and what new tables belong to.
  for (const k of plan.classes) for (const d of k.dependsOn) depend(edit(k.name, null), d, "reference");
  for (const t of plan.tables) {
    if (!t.belongsTo.length) continue;
    const u = edit(modelFor(t.name), "model");
    for (const r of t.belongsTo) {
      const name = r.column.replace(/_id$/, "");
      const model = modelFor(r.to);
      u.associations.push({ kind: "belongs_to", name, ...(name === singularize(r.to) ? {} : { className: model }) });
      depend(u, model, "association", { many: "1", owns: false });
    }
    // An owner has many of these and takes them with it.
    for (const owner of t.partOf) {
      const o = edit(modelFor(owner), "model");
      if (!o.associations.some((a) => a.kind === "has_many" && a.name === t.name)) o.associations.push({ kind: "has_many", name: t.name, dependent: "destroy" });
      depend(o, u.name, "association", { many: "*", owns: true });
    }
  }

  // 4. Flows: each call becomes a static call in the caller's method, so request flows draw.
  for (const f of plan.flows) {
    for (const { from, to } of f.calls) {
      const a = f.steps[from];
      const b = f.steps[to];
      const caller = edit(a.cls, null);
      const callee = findClass(Object.keys(classes), b.cls) ?? b.cls;
      const m = addMethod(caller, { name: a.method, scope: a.scope });
      const call = `${callee}${b.scope === "class" ? "." : "#"}${b.method}`;
      if (!m.calls.includes(call)) m.calls = [...m.calls, call];
      depend(caller, b.cls, "call");
    }
  }

  const after: Snapshot = {
    commit: before.commit,
    files: { ...before.files },
    classes,
    allFiles: [...before.allFiles],
  };
  for (const name of created) {
    const p = classes[name].locations[0].path;
    after.files[p] = { blob: "planned", codeLines: PLANNED_LINES, classes: [name], errors: [] };
    after.allFiles.push(p);
  }
  return {
    after,
    changed: [...changed].filter(([p]) => p).map(([path, status]) => ({ path, status, additions: 0, deletions: 0 })),
    planned,
    created,
    plannedEdges,
  };
}

// ---------- the product page, from the plan ----------

const isSchema = (p: string) => /(^|\/)db\/schema\.rb$/.test(p);

export async function plannedProduct(git: Git, plan: Plan, before: Snapshot): Promise<ProductChanges> {
  const schemaPath = before.allFiles.filter(isSchema).sort((a, b) => a.length - b.length)[0];
  const schema = schemaPath ? parseSchema((await git.show(before.commit, schemaPath)) ?? "") : null;

  const tables: TableChange[] = plan.tables.map((t) => {
    const today = schema?.tables.get(t.name);
    const status: ChangeStatus = today ? "changed" : "added";
    const refs = t.belongsTo.map(({ to, column }) => ({ to, column, one: false, status: "added" as ChangeStatus }));
    const keep = today ? [...today.columns.keys()].filter((c) => !t.remove.includes(c) && !t.add.some((a) => a.name === c)) : [];
    const columns = today
      ? [
          ...t.add.map((c) => ({ name: c.name, type: c.type ?? "", status: "added" as ChangeStatus })),
          ...t.columns.filter((c) => !today.columns.has(c.name)).map((c) => ({ name: c.name, type: c.type ?? "", status: "added" as ChangeStatus })),
          ...t.remove.map((c) => ({ name: c, type: today.columns.get(c)?.type ?? "", status: "removed" as ChangeStatus })),
        ]
      : [...t.columns, ...t.add].map((c) => ({ name: c.name, type: c.type ?? "", status: "added" as ChangeStatus }));
    // A new table's belongs_to columns show as arrows.
    if (!today) for (const r of refs) if (!columns.some((c) => c.name === r.column)) columns.push({ name: r.column, type: "bigint", status: "added" });
    return { name: t.name, status, columns, otherColumns: keep.length, references: refs, checks: { added: 0, removed: 0 } };
  });

  const lifecycles: LifecycleChange[] = [];
  for (const l of plan.lifecycles) {
    const model = findClass(Object.keys(before.classes), l.model);
    const unit = model ? before.classes[model] : null;
    let today: { values: string[]; moves: { from: string; to: string }[] } | undefined;
    for (const loc of unit?.locations ?? []) {
      const found = readLifecycles((await git.show(before.commit, loc.path)) ?? "").find((x) => x.field === l.field);
      if (found) today = found;
    }
    const was = today?.values ?? [];
    const now = [...was.filter((s) => !l.removeStates.includes(s)), ...l.addStates.filter((s) => !was.includes(s))];
    const key = (m: { from: string; to: string }) => `${m.from}>${m.to}`;
    const kept = (today?.moves ?? []).filter((m) => !l.removeMoves.some((r) => key(r) === key(m)));
    const moves = [
      ...kept.map((m) => ({ ...m, status: "unchanged" as ChangeStatus })),
      ...l.moves.filter((m) => !kept.some((k) => key(k) === key(m))).map((m) => ({ ...m, status: "added" as ChangeStatus })),
      ...l.removeMoves.map((m) => ({ ...m, status: "removed" as ChangeStatus })),
    ];
    lifecycles.push({ model: model ?? l.model, field: l.field, status: today ? "changed" : "added", before: was, after: now, moves });
  }

  const screens: ScreenChange[] = plan.screens.map((s) => {
    const name = findClass(Object.keys(before.classes), s.controller);
    const today = name ? before.classes[name] : null;
    const has = (a: string) => !!today?.methods.some((m) => m.name === a && m.scope === "instance" && m.visibility === "public");
    return {
      controller: name ?? s.controller,
      status: today ? "changed" : "added",
      actions: s.actions.filter((a) => a.op === "-" || !has(a.name)).map((a) => ({ name: a.name, status: a.op === "-" ? "removed" : "added" })),
    };
  });

  const permissions: RuleChange[] = plan.permissions.flatMap((p) => {
    const name = findClass(Object.keys(before.classes), p.policy);
    const today = name ? before.classes[name] : null;
    return p.rules.map((r) => ({
      policy: name ?? p.policy,
      rule: r.name,
      status: (r.op === "-" ? "removed" : today?.methods.some((m) => m.name === r.name) ? "changed" : "added") as ChangeStatus,
    }));
  });

  const jobs = plan.jobs.map((j) => {
    const name = findClass(Object.keys(before.classes), j.name);
    const role: Role = (name ? before.classes[name].role : null) ?? roleFromName(j.name) ?? "job";
    return { name: name ?? j.name, role, status: (name ? "changed" : "added") as ChangeStatus, methods: j.methods };
  });

  return { tables, migrations: [], screens, routes: { added: [], removed: [] }, permissions, lifecycles, jobs };
}

/** Marks what the plan touched, and replaces measures that need real code with what a plan can say. */
export function markPreview(c: Comparison, o: PlanOverlay, plan: Plan): void {
  for (const k of c.classes) {
    if (!o.planned.has(k.name)) continue;
    k.planned = true;
    if (o.created.has(k.name)) k.sizeUnknown = true;
  }
  for (const e of c.edges) if (o.plannedEdges.has(`${e.from}>${e.to}`)) e.planned = true;
  // Sizes are placeholders, so only the dependency measures mean anything for a plan.
  c.deltas = c.deltas.filter((d) => d.id === "area-links" || d.id === "class-links");
  const added = c.classes.filter((k) => k.planned && k.status === "added").length;
  const reshaped = c.classes.filter((k) => k.planned && k.status === "changed").length;
  const parts = [added && `${added} new class${added === 1 ? "" : "es"}`, reshaped && `${reshaped} reshaped`].filter(Boolean);
  c.verdict = { label: "Planned", tone: "flat", summary: `The plan, drawn against today's code: ${parts.join(" and ") || "no classes"}.`, good: 0, bad: 0, ask: 0 };
  c.stats = { files: o.changed.length, additions: 0, deletions: 0, appFiles: o.changed.length, testFiles: 0 };
  c.plan = planInfo(plan, "preview");
}

// ---------- the summary, from the plan ----------

const short = (n: string) => n.split("::").pop() ?? n;
const andList = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * Key changes for a plan: one per planned class (with what it uses), then one
 * per flow. Written from the plan itself, so nothing waits on Claude.
 */
export function planStory(c: Comparison, plan: Plan): Story {
  const names = new Set(c.classes.map((k) => k.name));
  const real = (n: string) => findClass(names, n);
  const stops: StoryStop[] = [];
  const main = new Set<string>();
  for (const k of plan.classes) {
    const name = real(k.name);
    if (!name || main.has(name)) continue;
    main.add(name);
    const change = c.classes.find((x) => x.name === name)!;
    const uses = k.dependsOn.map(real).filter((x): x is string => !!x);
    const methods = k.public.map((m) => m.signature);
    const isNew = change.status === "added";
    stops.push({
      id: `class-${name}`,
      title: isNew ? `A new ${change.role === "other" ? "class" : change.role}: ${short(name)}` : `${short(name)} takes on more`,
      explain: [
        k.note,
        methods.length ? `${isNew ? "It offers" : "It gains"} ${methods.length} public method${methods.length === 1 ? "" : "s"}: ${andList(methods)}.` : "",
        uses.length ? `It depends on ${andList(uses.map(short))}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      look: isNew
        ? `Dashed boxes are planned. ${short(name)}'s width is its planned interface; its height waits for real code.`
        : `Compare ${short(name)}'s width before and after: each planned public method widens it.`,
      tone: "flat",
      classes: [name, ...uses].slice(0, 6),
    });
  }
  for (const f of plan.flows) {
    const cls = [...new Set(f.steps.map((s) => real(s.cls)).filter((x): x is string => !!x))];
    if (cls.length < 2) continue;
    stops.push({
      id: `flow-${f.name}`,
      title: `How it runs: ${f.name}`,
      explain: `${f.steps.map((s) => `${short(s.cls)}${s.scope === "class" ? "." : "#"}${s.method}`).join(", then ")}`.replace(/[^!?]$/, "$&."),
      look: "Green arrows are the dependencies the plan adds; the sequence diagram below follows the calls in order.",
      tone: "flat",
      classes: cls.slice(0, 6),
      ...(real(f.steps[0].cls) ? { flow: { cls: real(f.steps[0].cls)!, method: f.steps[0].method } } : {}),
    });
  }
  return {
    base: c.base.sha,
    head: c.head.sha,
    source: "measured",
    status: "done",
    summary: plan.why ? `${plan.title}. ${plan.why}` : plan.title,
    stops,
  };
}

export function planInfo(plan: Plan, mode: "preview" | "check"): NonNullable<Comparison["plan"]> {
  return { mode, name: plan.name, title: plan.title, why: plan.why, approach: plan.approach, short: plan.short, file: plan.file, hash: plan.hash, problems: plan.problems };
}
