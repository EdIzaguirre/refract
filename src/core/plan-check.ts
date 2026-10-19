import type { ClassUnit, Comparison, PlanCheck, PlanItem, PlanSection, PlanStatus, PlanTheme, ProductPart, Snapshot } from "../shared/types.js";
import type { Plan } from "./plan.js";
import { findClass, modelFor } from "./plan-preview.js";

/**
 * Lays the plan beside what the branch built. Every line is one of: built as
 * planned, planned but missing, built but not in the plan, or built
 * differently. The product sections come from the same facts as the product
 * page; classes and flows from the snapshots at both ends of the branch.
 */

const short = (n: string) => n.split("::").pop() ?? n;
const andList = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The references a planned table should have and the build lacks, matched by table and column: home_site_id is not site_id. */
export function unbuiltRefs(t: Plan["tables"][number], built: { references: { to: string; column: string }[] } | undefined): string[] {
  return t.belongsTo
    .filter((r) => !built?.references.some((b) => b.to === r.to && b.column === r.column))
    .map((r) => `${r.to} through ${r.column}`);
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A long list reads as its first few names; the rest go in the line's detail. */
const LONG = 6;
const someList = (xs: string[]) => (xs.length <= LONG ? andList(xs) : `${xs.slice(0, LONG - 1).join(", ")} and ${xs.length - LONG + 1} more`);
const fullList = (xs: string[]) => (xs.length > LONG ? `All of them: ${xs.join(", ")}.` : undefined);

export function checkPlan(plan: Plan, c: Comparison, before: Snapshot, after: Snapshot): PlanCheck {
  const items: PlanItem[] = [];
  /** The names each line is about, for grouping the surprises. */
  const about = new Map<PlanItem, string[]>();
  const p = c.product ?? { tables: [], migrations: [], screens: [], routes: { added: [], removed: [] }, permissions: [], lifecycles: [], jobs: [] };
  const add = (section: PlanSection, status: PlanStatus, text: string, target?: PlanItem["target"], detail?: string, names?: string[]) => {
    const item: PlanItem = { section, status, text, ...(target ? { target } : {}), ...(detail ? { detail } : {}) };
    items.push(item);
    about.set(item, names ?? (target ? [target.name] : []));
  };
  const product = (part: ProductPart, name: string) => ({ kind: "product" as const, part, name });
  const cls = (name: string, method?: string) => ({ kind: "class" as const, name, ...(method ? { method } : {}) });
  const nowClass = (n: string) => findClass(Object.keys(after.classes), n);
  const thenClass = (n: string) => findClass(Object.keys(before.classes), n);

  // ---- tables ----
  const plannedTables = new Set(plan.tables.map((t) => t.name));
  for (const t of plan.tables) {
    const built = p.tables.find((x) => x.name === t.name);
    const target = product("data", t.name);
    if (t.isNew) {
      if (!built || built.status !== "added") {
        add("tables", built ? "different" : "missing", built ? `${t.name} already existed; the plan called it new` : `The ${t.name} table`, target);
        continue;
      }
      const cols = new Set(built.columns.map((x) => x.name));
      const missing = [...t.columns, ...t.add].map((x) => x.name).filter((n) => !cols.has(n));
      const refs = unbuiltRefs(t, built);
      add("tables", "built", `The ${t.name} table`, target);
      if (missing.length) add("tables", "different", `${t.name} has no ${andList(missing)} column${missing.length === 1 ? "" : "s"}`, target);
      if (refs.length) add("tables", "different", `${t.name} does not point at ${andList(refs)}`, target);
      const fk = new Set(built.references.map((r) => r.column));
      const named = new Set([...t.columns, ...t.add].map((x) => x.name));
      const extra = built.columns.map((x) => x.name).filter((n) => !named.has(n) && !fk.has(n));
      if (extra.length) add("tables", "surprise", `${t.name} also has ${andList(extra)}`, target, undefined, [t.name, ...extra]);
    } else {
      const addedCols = new Set((built?.columns ?? []).filter((x) => x.status === "added").map((x) => x.name));
      const removedCols = new Set((built?.columns ?? []).filter((x) => x.status === "removed").map((x) => x.name));
      const wantAdd = [...t.add, ...t.columns].map((x) => x.name);
      const gotAdd = wantAdd.filter((n) => addedCols.has(n));
      const gotRemove = t.remove.filter((n) => removedCols.has(n));
      if (gotAdd.length) add("tables", "built", `${andList(gotAdd)} on ${t.name}`, target);
      if (gotRemove.length) add("tables", "built", `${andList(gotRemove)} dropped from ${t.name}`, target);
      const noAdd = wantAdd.filter((n) => !addedCols.has(n));
      const noRemove = t.remove.filter((n) => !removedCols.has(n));
      if (noAdd.length) add("tables", "missing", `${andList(noAdd)} on ${t.name}`, target);
      if (noRemove.length) add("tables", "missing", `Dropping ${andList(noRemove)} from ${t.name}`, target);
      const extra = [...addedCols].filter((n) => !wantAdd.includes(n));
      if (extra.length) add("tables", "surprise", `${t.name} also got ${andList(extra)}`, target, undefined, [t.name, ...extra]);
      const refs = unbuiltRefs(t, built);
      if (built && refs.length) add("tables", "different", `${t.name} does not point at ${andList(refs)}`, target);
    }
  }
  for (const t of p.tables) {
    if (plannedTables.has(t.name)) continue;
    const target = product("data", t.name);
    if (t.status === "added") add("tables", "surprise", `A new ${t.name} table`, target);
    else if (t.status === "removed") add("tables", "surprise", `The ${t.name} table was dropped`, target);
    else {
      const a = t.columns.filter((x) => x.status === "added").map((x) => x.name);
      const r = t.columns.filter((x) => x.status === "removed").map((x) => x.name);
      const ch = t.columns.filter((x) => x.status === "changed").map((x) => x.name);
      const bits = [a.length && `new ${andList(a)}`, r.length && `dropped ${andList(r)}`, ch.length && `changed ${andList(ch)}`].filter(Boolean);
      if (bits.length) add("tables", "surprise", `${t.name}: ${bits.join("; ")}`, target, undefined, [...a, ...r, ...ch, t.name]);
      else if (t.references.some((x) => x.status !== "unchanged") || t.checks.added + t.checks.removed) add("tables", "surprise", `${t.name}: new references or checks`, target);
    }
  }

  // ---- lifecycles ----
  const plannedLife = new Set<string>();
  for (const l of plan.lifecycles) {
    const model = nowClass(l.model) ?? l.model;
    plannedLife.add(`${model}.${l.field}`);
    const built = p.lifecycles.find((x) => x.model === model && x.field === l.field);
    const target = product("lifecycles", `${model}.${l.field}`);
    const states = built?.after ?? [];
    const moves = new Set((built?.moves ?? []).filter((m) => m.status !== "removed").map((m) => `${m.from}>${m.to}`));
    const gotStates = l.addStates.filter((s) => states.includes(s) && !built!.before.includes(s));
    const noStates = l.addStates.filter((s) => !gotStates.includes(s));
    const gotMoves = l.moves.filter((m) => moves.has(`${m.from}>${m.to}`) && built?.moves.find((x) => x.from === m.from && x.to === m.to)?.status === "added");
    const noMoves = l.moves.filter((m) => !gotMoves.includes(m));
    const mv = (ms: { from: string; to: string }[]) => andList(ms.map((m) => `${m.from} → ${m.to}`));
    if (gotStates.length) add("lifecycles", "built", `The ${andList(gotStates)} state${gotStates.length === 1 ? "" : "s"} on ${short(model)}`, target);
    if (gotMoves.length) add("lifecycles", "built", `${plural(gotMoves.length, "move")} on ${short(model)}: ${mv(gotMoves)}`, target);
    if (noStates.length) add("lifecycles", "missing", `The ${andList(noStates)} state${noStates.length === 1 ? "" : "s"} on ${short(model)}`, target);
    if (noMoves.length) add("lifecycles", "missing", `${plural(noMoves.length, "move")} on ${short(model)}: ${mv(noMoves)}`, target);
    for (const s of l.removeStates) add("lifecycles", states.includes(s) ? "missing" : "built", `Dropping the ${s} state from ${short(model)}`, target);
    if (built) {
      const extraStates = built.after.filter((s) => !built.before.includes(s) && !l.addStates.includes(s));
      const extraMoves = built.moves.filter((m) => m.status === "added" && !l.moves.some((x) => x.from === m.from && x.to === m.to));
      if (extraStates.length) add("lifecycles", "surprise", `${short(model)} also gained the ${andList(extraStates)} state${extraStates.length === 1 ? "" : "s"}`, target);
      if (extraMoves.length) add("lifecycles", "surprise", `${short(model)} also allows ${mv(extraMoves)}`, target);
    }
  }
  for (const l of p.lifecycles) {
    if (plannedLife.has(`${l.model}.${l.field}`)) continue;
    add("lifecycles", "surprise", `${short(l.model)}.${l.field} changed: ${l.after.join(", ")}`, product("lifecycles", `${l.model}.${l.field}`));
  }

  // ---- screens ----
  const plannedScreens = new Map<string, Set<string>>();
  for (const s of plan.screens) {
    const name = nowClass(s.controller) ?? thenClass(s.controller) ?? s.controller;
    const unit = after.classes[name];
    const existed = !!before.classes[name];
    plannedScreens.set(name, new Set(s.actions.map((a) => a.name)));
    const target = cls(name);
    if (!unit) {
      add("screens", "missing", `${short(name)} (${andList(s.actions.map((a) => a.name))})`, target);
      continue;
    }
    const has = (a: string) => unit.methods.some((m) => m.name === a && m.scope === "instance" && m.visibility === "public");
    const got = s.actions.filter((a) => (a.op === "-" ? !has(a.name) : has(a.name)));
    const no = s.actions.filter((a) => !got.includes(a));
    const label = (xs: typeof s.actions) => andList(xs.map((a) => (a.op === "-" ? `dropping ${a.name}` : a.name)));
    if (!existed) add("screens", "built", `${short(name)}${got.length ? ` (${label(got)})` : ""}`, target);
    else if (got.length) add("screens", "built", `${label(got)} on ${short(name)}`, target);
    if (no.length) add("screens", "missing", `${label(no)} on ${short(name)}`, target);
  }
  for (const s of p.screens) {
    const want = plannedScreens.get(s.controller);
    const extra = s.actions.filter((a) => a.status === "added" && !want?.has(a.name)).map((a) => a.name);
    if (s.status === "added" && !want) add("screens", "surprise", `A new ${short(s.controller)}${extra.length ? ` (${andList(extra)})` : ""}`, cls(s.controller));
    else if (s.status === "removed" && !want) add("screens", "surprise", `${short(s.controller)} was removed`, cls(s.controller));
    else if (extra.length) add("screens", "surprise", `${short(s.controller)} also gained ${andList(extra)}`, cls(s.controller));
    const gone = s.actions.filter((a) => a.status === "removed" && !want?.has(a.name)).map((a) => a.name);
    if (gone.length && s.status !== "removed") add("screens", "surprise", `${short(s.controller)} lost ${andList(gone)}`, cls(s.controller));
  }

  // ---- permissions ----
  const plannedRules = new Set<string>();
  for (const r of plan.permissions) {
    const name = nowClass(r.policy) ?? r.policy;
    const unit = after.classes[name];
    const has = (rule: string) => !!unit?.methods.some((m) => m.name === rule && m.visibility === "public");
    for (const x of r.rules) plannedRules.add(`${name}#${x.name}`);
    const got = r.rules.filter((x) => (x.op === "-" ? !has(x.name) : has(x.name))).map((x) => x.name);
    const no = r.rules.filter((x) => (x.op === "-" ? has(x.name) : !has(x.name))).map((x) => x.name);
    if (got.length) add("permissions", "built", `${andList(got)} on ${short(name)}`, cls(name));
    if (no.length) add("permissions", "missing", `${andList(no)} on ${short(name)}`, cls(name));
  }
  const byPolicy = new Map<string, { added: string[]; changed: string[]; removed: string[] }>();
  for (const r of p.permissions) {
    if (plannedRules.has(`${r.policy}#${r.rule}`)) continue;
    const g = byPolicy.get(r.policy) ?? { added: [], changed: [], removed: [] };
    (r.status === "added" ? g.added : r.status === "removed" ? g.removed : g.changed).push(r.rule);
    byPolicy.set(r.policy, g);
  }
  for (const [policy, g] of byPolicy) {
    if (g.added.length) add("permissions", "surprise", `${plural(g.added.length, "new rule")} on ${short(policy)}: ${andList(g.added)}`, cls(policy), undefined, [...g.added, policy]);
    if (g.changed.length) add("permissions", "surprise", `${plural(g.changed.length, "existing rule")} on ${short(policy)} changed: ${andList(g.changed)}`, cls(policy), undefined, [...g.changed, policy]);
    if (g.removed.length) add("permissions", "surprise", `${short(policy)} dropped ${andList(g.removed)}`, cls(policy), undefined, [...g.removed, policy]);
  }

  // ---- jobs ----
  const plannedJobs = new Set<string>();
  for (const j of plan.jobs) {
    const name = nowClass(j.name) ?? j.name;
    plannedJobs.add(name);
    const unit = after.classes[name];
    if (!unit) {
      add("jobs", "missing", short(name), cls(name));
      continue;
    }
    const missing = j.methods.filter((m) => !unit.methods.some((x) => x.name === m));
    add("jobs", "built", `${short(name)}${j.methods.length - missing.length ? ` (${andList(j.methods.filter((m) => !missing.includes(m)))})` : ""}`, cls(name));
    if (missing.length) add("jobs", "missing", `${andList(missing)} on ${short(name)}`, cls(name));
  }
  for (const j of p.jobs) {
    if (plannedJobs.has(j.name)) continue;
    if (j.status === "added") add("jobs", "surprise", `A new ${j.role === "mailer" ? "mailer" : "job"}: ${short(j.name)}`, cls(j.name));
    else if (j.status === "removed") add("jobs", "surprise", `${short(j.name)} was removed`, cls(j.name));
    else if (j.methods.length) add("jobs", "surprise", `${short(j.name)} sends ${andList(j.methods)}`, cls(j.name));
  }

  // ---- classes ----
  const plannedClasses = new Set<string>();
  const publicOf = (u: ClassUnit) => u.methods.filter((m) => m.visibility === "public" && !(m.name === "initialize" && m.scope === "instance"));
  for (const k of plan.classes) {
    const name = nowClass(k.name) ?? k.name;
    plannedClasses.add(name);
    const unit = after.classes[name];
    if (!unit) {
      add("classes", "missing", short(name), undefined, k.note);
      continue;
    }
    const was = before.classes[name];
    add("classes", "built", was ? `${short(name)}, reshaped` : short(name), cls(name));
    for (const m of k.public) {
      const built = unit.methods.find((x) => x.name === m.name && x.scope === m.scope);
      const label = `${short(name)}${m.scope === "class" ? "." : "#"}${m.name}`;
      if (!built) add("classes", "missing", label, cls(name));
      else if (built.visibility !== "public") add("classes", "different", `${label} is ${built.visibility}, not public`, cls(name, m.name));
      else if (m.params !== null && built.params !== m.params)
        add("classes", "different", `${label} takes ${plural(built.params, "parameter")}; the plan said ${m.params}`, cls(name, m.name), `Planned as ${m.signature}`);
    }
    for (const m of k.remove) {
      if (unit.methods.some((x) => x.name === m.name && x.scope === m.scope && x.visibility === "public"))
        add("classes", "missing", `${short(name)}${m.scope === "class" ? "." : "#"}${m.name} is still there; the plan takes it away`, cls(name, m.name));
    }
    const planned = new Set(k.public.map((m) => `${m.scope}:${m.name}`));
    const extra = publicOf(unit)
      .filter((m) => !planned.has(`${m.scope}:${m.name}`) && !was?.methods.some((x) => x.name === m.name && x.scope === m.scope))
      .map((m) => (m.scope === "class" ? `self.${m.name}` : m.name));
    if (extra.length) add("classes", "surprise", `${short(name)} also has ${someList(extra)}`, cls(name), fullList(extra));
    const deps = new Set(unit.dependsOn.map((d) => d.to));
    const noDeps = k.dependsOn.filter((d) => {
      const to = nowClass(d);
      return !to || !deps.has(to);
    });
    if (noDeps.length)
      add("classes", "different", `${short(name)} never names ${andList(noDeps.map(short))}`, cls(name), "It may still be handed them as arguments; Refract only sees the classes the code names.");
  }
  // Classes the product sections already account for are not surprises here.
  const accounted = new Set<string>([
    ...plannedClasses,
    ...plannedScreens.keys(),
    ...plannedJobs,
    ...plan.permissions.map((r) => nowClass(r.policy) ?? r.policy),
    ...plan.tables.filter((t) => t.isNew).map((t) => nowClass(modelFor(t.name)) ?? modelFor(t.name)),
  ]);
  const covered = new Set(["controller", "policy", "job", "mailer"]);
  for (const k of c.classes) {
    if (accounted.has(k.name)) continue;
    if (k.status === "added" && !covered.has(k.role)) {
      const model = k.role === "model" && p.tables.some((t) => t.status === "added" && modelFor(t.name) === k.name);
      if (!model) add("classes", "surprise", `A new ${k.role === "other" ? "class" : k.role}: ${k.name}`, cls(k.name));
      continue;
    }
    if (k.status !== "changed" || covered.has(k.role)) continue;
    const newPublic = k.methods.filter((m) => m.status === "added" && m.after?.visibility === "public").map((m) => (m.scope === "class" ? `self.${m.name}` : m.name));
    if (newPublic.length) add("classes", "surprise", `${short(k.name)} gained ${someList(newPublic)}`, cls(k.name, newPublic.length === 1 ? newPublic[0].replace(/^self\./, "") : undefined), fullList(newPublic));
    for (const m of k.methods) {
      if (m.status !== "changed" || !m.before || !m.after || m.after.visibility !== "public" || m.before.params === m.after.params) continue;
      const label = m.name === "initialize" ? `${short(k.name)}.new` : `${short(k.name)}${m.scope === "class" ? "." : "#"}${m.name}`;
      add("classes", "surprise", `${label} now takes ${plural(m.after.params, "parameter")} (was ${m.before.params})`, cls(k.name, m.name));
    }
  }

  // ---- flows ----
  for (const f of plan.flows) {
    const broken: string[] = [];
    for (const { from, to } of f.calls) {
      const a = f.steps[from];
      const b = f.steps[to];
      const caller = nowClass(a.cls);
      const callee = nowClass(b.cls);
      const unit = caller ? after.classes[caller] : null;
      const m = unit?.methods.find((x) => x.name === a.method && x.scope === a.scope);
      const label = `${short(a.cls)}${a.scope === "class" ? "." : "#"}${a.method} → ${short(b.cls)}${b.scope === "class" ? "." : "#"}${b.method}`;
      if (!m) {
        broken.push(`${label} (no ${a.method} yet)`);
        continue;
      }
      // Seen in the code as a call, or the caller uses the callee's class and the method exists there.
      const direct = !!callee && m.calls.some((x) => x === `${callee}${b.scope === "class" ? "." : "#"}${b.method}` || x.endsWith(`${short(b.cls)}${b.scope === "class" ? "." : "#"}${b.method}`));
      const self = caller === callee && m.calls.includes(`.${b.method}`);
      const likely = !!callee && !!unit?.dependsOn.some((d) => d.to === callee) && (!!after.classes[callee].methods.some((x) => x.name === b.method) || b.scope === "class");
      if (!direct && !self && !likely) broken.push(label);
    }
    const head = f.steps[0] ? nowClass(f.steps[0].cls) : null;
    if (!broken.length) add("flows", "built", `"${f.name}"`, head ? cls(head, f.steps[0].method) : undefined);
    else if (broken.length === f.calls.length) add("flows", "missing", `"${f.name}"`, head ? cls(head, f.steps[0].method) : undefined, `Refract can't find ${andList(broken)} in the code.`);
    else add("flows", "different", `"${f.name}" runs differently`, head ? cls(head, f.steps[0].method) : undefined, `Refract can't find ${andList(broken)} in the code.`);
  }

  return { items, themes: themesFor(items, about, after) };
}

// ---- grouping the surprises ----

/** Words that say what kind of thing a name is, not what it is about. */
const KIND_WORDS = new Set(["controller", "policy", "job", "mailer", "query", "presenter", "renderer", "service", "concern", "id", "at", "by", "cents", "org", "self"]);
const singular = (w: string) => (w.endsWith("ies") ? `${w.slice(0, -3)}y` : /(ss|us|is)$/.test(w) ? w : w.endsWith("s") ? w.slice(0, -1) : w);
/** "Org::InvoiceLayoutsController" and "invoice_layouts" both read as ["invoice", "layout"]. */
export function wordsOf(name: string): string[] {
  return short(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !KIND_WORDS.has(w))
    .map(singular);
}
/** One word stands for another when they are equal, or one is a long-enough start of the other ("attach", "attachment"). */
const sameWord = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)));
const contains = (words: string[], topic: string[]) => words.some((_, i) => topic.every((t, j) => words[i + j] !== undefined && sameWord(words[i + j], t)));
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pluralWord = (w: string) => (/[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : /(s|x|ch|sh)$/.test(w) ? `${w}es` : `${w}s`);
/** The words a group's names start with: "Billing report", or "Timesheets" when only one word is shared. */
function restTitle(names: string[]): string {
  const lists = names.map(wordsOf).filter((w) => w.length);
  const shared: string[] = [];
  for (let i = 0; lists.every((w) => w[i] !== undefined && w[i] === lists[0][i]); i++) shared.push(lists[0][i]);
  return titleCase(shared.length === 1 ? pluralWord(shared[0]) : shared.join(" "));
}

/**
 * Puts the surprises into a few topics, so a long list reads as a handful of
 * things. Each new table or new screen is a topic, and every surprise whose
 * names contain its words joins it (a new service that only depends on the
 * topic's model joins too). What is left groups by the first word of the
 * thing it is about, like "timesheet"; a topic of one goes in "Everything else".
 */
function themesFor(items: PlanItem[], about: Map<PlanItem, string[]>, after: Snapshot): PlanTheme[] {
  const surprises = items.map((item, i) => ({ item, i })).filter((x) => x.item.status === "surprise");
  if (!surprises.length) return [];
  const topics: { words: string[]; title: string; items: number[] }[] = [];
  for (const { item } of surprises) {
    const isNew = (item.section === "tables" && item.text.startsWith("A new ")) || (item.section === "screens" && item.text.startsWith("A new "));
    if (!isNew || !item.target) continue;
    const words = wordsOf(item.target.name);
    if (!words.length || topics.some((t) => t.words.join(" ") === words.join(" "))) continue;
    const raw = item.target.kind === "product" ? item.target.name.replace(/_/g, " ") : short(item.target.name).replace(/Controller$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
    topics.push({ words, title: titleCase(raw), items: [] });
  }
  // The longest topic a name contains wins, so "invoice layout" beats "invoice".
  const byLength = [...topics].sort((a, b) => b.words.length - a.words.length);
  const topicOf = (names: string[]) => byLength.find((t) => names.some((n) => contains(wordsOf(n), t.words)));
  const rest = new Map<string, number[]>();
  for (const { item, i } of surprises) {
    // A permission line names several rules, so it goes by its policy alone.
    const names = item.section === "permissions" ? (about.get(item) ?? []).slice(-1) : (about.get(item) ?? []);
    let topic = topicOf(names);
    const first = wordsOf(item.target?.name ?? names[0] ?? "")[0] ?? "";
    // A new class with no topic in its name joins the one topic it depends on, unless its name starts with a model's (TimesheetApproval is about timesheets).
    if (!topic && item.section === "classes" && item.text.startsWith("A new ") && item.target?.kind === "class" && !after.classes[titleCase(first)]) {
      const deps = after.classes[item.target.name]?.dependsOn.map((d) => d.to) ?? [];
      const hits = new Set(deps.map((d) => topicOf([d])).filter(Boolean));
      if (hits.size === 1) topic = [...hits][0];
    }
    if (topic) {
      topic.items.push(i);
      continue;
    }
    rest.set(first, [...(rest.get(first) ?? []), i]);
  }
  const themes: PlanTheme[] = topics.filter((t) => t.items.length).sort((a, b) => b.items.length - a.items.length).map((t) => ({ title: t.title, kind: "new" as const, items: t.items }));
  const other: number[] = [];
  const more: PlanTheme[] = [];
  for (const [word, list] of rest) {
    if (!word || list.length < 2) other.push(...list);
    else more.push({ title: restTitle(list.map((n) => items[n].target?.name ?? "")), kind: "more", items: list });
  }
  more.sort((a, b) => b.items.length - a.items.length);
  if (other.length) more.push({ title: "Everything else", kind: "more", items: other.sort((a, b) => a - b) });
  return [...themes, ...more];
}
