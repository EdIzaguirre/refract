import type { Comparison, PlanComparison, PlanSide, ProductChanges, ProductPart, ProductRow, Role, Sequence } from "../shared/types.js";
import type { Plan, PlanFlow } from "./plan.js";
import { planInfo } from "./plan-preview.js";
import { sharedMethods, surfaceClasses } from "../shared/plan-surface.js";

/**
 * Two to four plans for the same goal, side by side: Ousterhout's "design it
 * twice" (A Philosophy of Software Design, Ch 11). All are drawn against the
 * same code, then compared on what they add to the product, how much the rest
 * of the code must learn, how many arrows they add, and how the same request
 * runs under each. Plans have no code, so depth is judged from interfaces and
 * dependencies only.
 */

/** More than this stops fitting side by side, and stops being a comparison anyone can hold in their head. */
export const MAX_PLANS = 4;
const LABELS = ["A", "B", "C", "D"];

/** Roles whose public methods are product facts (screens, rules, emails), so they are not counted as interface. */
const PRODUCT_ROLES: Role[] = ["controller", "policy", "job", "mailer"];

const short = (n: string) => n.split("::").pop() ?? n;
const shortController = (n: string) => n.replace(/Controller$/, "");
const list = (xs: string[]) => xs.join(", ");

export function comparePlans(base: { ref: string; short: string }, plans: { plan: Plan; comparison: Comparison }[]): PlanComparison {
  if (plans.length < 2 || plans.length > MAX_PLANS) throw new Error(`Refract compares 2 to ${MAX_PLANS} plans at a time, not ${plans.length}.`);
  const sides = plans.map((p, i) => side(LABELS[i], p.plan, p.comparison));
  const product = productRows(sides.map((s) => s.product));
  const flows = matchFlows(plans.map((p) => p.plan.flows));
  return { base, sides, product, flows, note: note(sides, product, flows) };
}

function side(label: string, plan: Plan, c: Comparison): PlanSide {
  const planned = c.classes.filter((k) => k.planned);
  const sigs = new Map<string, string>();
  for (const k of plan.classes) for (const m of k.public) sigs.set(`${short(k.name)}|${m.scope === "class" ? "self." : ""}${m.name}`, m.signature);

  const surface: PlanSide["surface"] = { classes: [], methods: 0, params: 0 };
  for (const k of planned) {
    if (PRODUCT_ROLES.includes(k.role) || !k.after) continue;
    const had = new Set(k.before?.publicMethods ?? []);
    const added = k.after.publicMethods.filter((m) => !had.has(m));
    if (!added.length) continue;
    let params = 0;
    const methods = added.map((label) => {
      const cls = label.startsWith("self.");
      const name = cls ? label.slice(5) : label;
      params += k.after!.methods.find((m) => m.name === name && m.scope === (cls ? "class" : "instance"))?.params ?? 0;
      return sigs.get(`${short(k.name)}|${label}`) ?? label;
    });
    surface.classes.push({ name: k.name, role: k.role, isNew: k.status === "added", methods, params });
    surface.methods += methods.length;
    surface.params += params;
  }
  surface.classes.sort((x, y) => y.methods.length - x.methods.length || x.name.localeCompare(y.name));

  const area = new Map(c.classes.map((k) => [k.name, k.area]));
  const arrows = c.edges.filter((e) => e.planned);
  const coupling = {
    touched: planned.length,
    created: planned.filter((k) => k.status === "added").length,
    reshaped: planned.filter((k) => k.status !== "added").length,
    arrows: arrows.length,
    crossArea: arrows.filter((e) => area.get(e.from) !== area.get(e.to)).length,
  };

  // Only what the plan touches and what it points at, so the page stays small.
  const keep = new Set([...planned.map((k) => k.name), ...arrows.flatMap((e) => [e.from, e.to])]);
  const drawing: Comparison = {
    ...c,
    classes: c.classes.filter((k) => keep.has(k.name)),
    edges: c.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
    files: [],
    areaEdges: [],
    areas: c.areas.filter((x) => c.classes.some((k) => keep.has(k.name) && k.area === x.id)),
  };

  const known = new Set(c.classes.map((k) => k.name));
  const real = (n: string) => (known.has(n) ? n : ([...known].find((k) => k.endsWith(`::${n}`)) ?? n));
  const flows = plan.flows.map((f) => ({
    name: f.name,
    sequence: flowSequence(f, real),
    calls: f.calls.map(({ from, to }) => `${short(f.steps[from].cls)} → ${short(f.steps[to].text)}`),
    steps: f.steps.length,
    entryCalls: f.calls.filter((x) => x.from === 0).length,
  }));

  return { label, plan: planInfo(plan, "preview"), product: c.product!, drawing, surface, coupling, flows };
}

/** A planned call tree as a sequence diagram, in the order the plan lists the calls. */
export function flowSequence(f: PlanFlow, real: (n: string) => string = (n) => n): Sequence {
  const messages = f.calls.map(({ from, to }) => ({ from: real(f.steps[from].cls), to: real(f.steps[to].cls), label: f.steps[to].method, observed: false }));
  const first = f.steps[0] ? real(f.steps[0].cls) : "";
  const participants = [...new Set([first, ...messages.flatMap((m) => [m.from, m.to])].filter(Boolean))];
  return { title: f.name, participants, messages, traced: false };
}

// ---------- product facts ----------

interface Fact {
  key: string;
  part: ProductPart;
  subject: string;
  text: string;
  /** Order-free, so the same fact written in another order still matches. */
  same: string;
}

export function productFacts(p: ProductChanges): Fact[] {
  const out: Fact[] = [];
  const sorted = (xs: string[]) => [...xs].sort().join(",");
  for (const t of p.tables) {
    const add = t.columns.filter((c) => c.status === "added").map((c) => c.name);
    const drop = t.columns.filter((c) => c.status === "removed").map((c) => c.name);
    const text =
      t.status === "added"
        ? `New table ${t.name}: ${list(add)}`
        : t.status === "removed"
          ? `Drops the ${t.name} table`
          : [`${t.name}`, add.length && `adds ${list(add)}`, drop.length && `drops ${list(drop)}`].filter(Boolean).join(": ").replace(/: (drops)/, "; $1");
    out.push({ key: `table:${t.name}`, part: "data", subject: t.name, text, same: `${t.status}|${sorted(add)}|${sorted(drop)}` });
  }
  for (const l of p.lifecycles) {
    const added = l.after.filter((s) => !l.before.includes(s));
    const dropped = l.before.filter((s) => !l.after.includes(s));
    const newMoves = l.moves.filter((m) => m.status === "added").map((m) => `${m.from} → ${m.to}`);
    const goneMoves = l.moves.filter((m) => m.status === "removed").map((m) => `${m.from} → ${m.to}`);
    const parts = [
      added.length && `adds ${list(added)}`,
      dropped.length && `drops ${list(dropped)}`,
      newMoves.length && `new moves ${list(newMoves)}`,
      goneMoves.length && `no more ${list(goneMoves)}`,
    ].filter(Boolean);
    const subject = `${short(l.model)}.${l.field}`;
    out.push({ key: `lifecycle:${subject}`, part: "lifecycles", subject, text: `${subject}: ${parts.join("; ") || "unchanged"}`, same: `${sorted(added)}|${sorted(dropped)}|${sorted(newMoves)}|${sorted(goneMoves)}` });
  }
  for (const s of p.screens) {
    const add = s.actions.filter((a) => a.status === "added").map((a) => a.name);
    const drop = s.actions.filter((a) => a.status === "removed").map((a) => a.name);
    const name = shortController(s.controller);
    const text =
      s.status === "added"
        ? `New screen ${name}: ${list(add)}`
        : [name, add.length && `adds ${list(add)}`, drop.length && `removes ${list(drop)}`].filter(Boolean).join(": ").replace(/: (removes)/, "; $1");
    out.push({ key: `screen:${s.controller}`, part: "screens", subject: name, text, same: `${s.status}|${sorted(add)}|${sorted(drop)}` });
  }
  const policies = new Map<string, { add: string[]; drop: string[] }>();
  for (const r of p.permissions) {
    const e = policies.get(r.policy) ?? { add: [], drop: [] };
    (r.status === "removed" ? e.drop : e.add).push(r.rule);
    policies.set(r.policy, e);
  }
  for (const [policy, e] of policies) {
    const text = [short(policy), e.add.length && list(e.add), e.drop.length && `drops ${list(e.drop)}`].filter(Boolean).join(": ").replace(/: (drops)/, "; $1");
    out.push({ key: `policy:${policy}`, part: "permissions", subject: short(policy), text, same: `${sorted(e.add)}|${sorted(e.drop)}` });
  }
  for (const j of p.jobs) {
    const what = j.role === "mailer" ? "mailer" : "job";
    const text = `${j.status === "added" ? `New ${what} ` : ""}${short(j.name)}${j.methods.length ? `: ${list(j.methods)}` : ""}`;
    out.push({ key: `job:${j.name}`, part: "jobs", subject: short(j.name), text, same: `${j.status}|${sorted(j.methods)}` });
  }
  return out;
}

const PART_ORDER: ProductPart[] = ["data", "lifecycles", "screens", "permissions", "jobs"];

/** One row per table, lifecycle, screen, policy or job any plan touches, with each plan's version of it. */
export function productRows(products: ProductChanges[]): ProductRow[] {
  const facts = products.map((p) => new Map(productFacts(p).map((f) => [f.key, f])));
  const keys = [...new Set(facts.flatMap((m) => [...m.keys()]))];
  const rows = keys.map((key) => {
    const mine = facts.map((m) => m.get(key) ?? null);
    const first = mine.find((f) => f)!;
    const same = mine.every((f) => f && f.same === first.same);
    return { part: first.part, subject: first.subject, cells: mine.map((f) => f?.text ?? null), where: same ? "all" : "some" } as ProductRow;
  });
  // Where they differ first; within that, the product's own order.
  return rows
    .map((r, i) => ({ r, i }))
    .sort((x, y) => (x.r.where === y.r.where ? 0 : x.r.where === "some" ? -1 : 1) || PART_ORDER.indexOf(x.r.part) - PART_ORDER.indexOf(y.r.part) || x.i - y.i)
    .map(({ r }) => r);
}

// ---------- the same request under each plan ----------

const entry = (f: PlanFlow) => f.steps[0]?.text ?? "";
const entryClass = (f: PlanFlow) => f.steps[0]?.cls ?? "";

/** Lines up the same request across plans: by name, then by the action it starts from, then by the controller. */
export function matchFlows(plans: PlanFlow[][]): PlanComparison["flows"] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const left = plans.map((fs) => new Set(fs.map((_, i) => i)));
  const out: PlanComparison["flows"] = [];
  plans.forEach((fs, p) => {
    for (const i of [...left[p]]) {
      const x = fs[i];
      left[p].delete(i);
      const at: (number | null)[] = plans.map(() => null);
      at[p] = i;
      for (let q = p + 1; q < plans.length; q++) {
        const take = (match: (y: PlanFlow) => boolean) => {
          const j = [...left[q]].find((k) => match(plans[q][k]));
          if (j !== undefined) left[q].delete(j);
          return j;
        };
        const j = take((y) => norm(y.name) === norm(x.name)) ?? take((y) => entry(y) === entry(x)) ?? take((y) => entryClass(y) === entryClass(x));
        if (j !== undefined) at[q] = j;
      }
      out.push({ title: x.name, at });
    }
  });
  return out;
}

// ---------- the Ousterhout note ----------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * One short note, argued from Ch 11 "Design it Twice". Every quote is verbatim
 * from the book (checked against the text in lenses/ousterhout-lens.md and the
 * chapter itself), and the measures are the ones on the page.
 */
export function note(sides: PlanSide[], rows: ProductRow[], flows: PlanComparison["flows"]): PlanComparison["note"] {
  const lines: string[] = [];
  const two = sides.length === 2;
  const winners = new Set<string>();
  const ends = <T,>(xs: T[], score: (x: T) => number): [T, T] => {
    const sorted = [...xs].sort((a, b) => score(a) - score(b));
    return [sorted[0], sorted[sorted.length - 1]];
  };

  const methods = (s: PlanSide["surface"]) => `${plural(s.methods, "public method")}${s.params ? ` with ${plural(s.params, "parameter")}` : ""}`;
  let first = `The chapter's checklist asks: "Does one alternative have a simpler interface than another?"`;
  const [simple, wide] = ends(sides, (s) => s.surface.methods + s.surface.params);
  if (simple.surface.methods === wide.surface.methods && simple.surface.params === wide.surface.params)
    first += ` By that count they tie: each asks the rest of the code to learn ${methods(simple.surface)}.`;
  else {
    winners.add(simple.label);
    first += ` Plan ${simple.label} asks the rest of the code to learn ${methods(simple.surface)}; ${two ? `Plan ${wide.label}` : `the widest, Plan ${wide.label},`} asks for ${methods(wide.surface)}.`;
  }
  const [less, more] = ends(sides, (s) => s.coupling.arrows);
  if (less.coupling.arrows !== more.coupling.arrows) {
    first += ` ${less.label === simple.label && winners.size ? `${less.label} also` : `Plan ${less.label}`} adds the fewest new dependencies between classes (${less.coupling.arrows}, against ${more.coupling.arrows} for ${more.label}), so fewer classes have to change together.`;
    winners.add(less.label);
  }
  if (two) first = first.replace("the fewest new dependencies", "fewer new dependencies");
  lines.push(first);

  // The book's first test: what the caller has to do. A controller driving many steps does work the module could.
  for (const p of flows) {
    const here = sides.flatMap((s, i) => (p.at[i] === null ? [] : [{ s, f: s.flows[p.at[i]!] }]));
    if (here.length < 2) continue;
    const [lean, busy] = ends(here, (x) => x.f.entryCalls);
    if (lean.f.entryCalls === busy.f.entryCalls) continue;
    winners.add(lean.s.label);
    // Every plan tied for leanest is named, so none looks worse than it is.
    const leanest = here.filter((x) => x.f.entryCalls === lean.f.entryCalls).map((x) => `${x.s.label}'s`);
    const names = leanest.length === 1 ? leanest[0] : `${leanest.slice(0, -1).join(", ")} and ${leanest[leanest.length - 1]}`;
    lines.push(
      `In "${p.title}", ${busy.s.label}'s entry point drives ${plural(busy.f.entryCalls, "call")} itself where ${names} ${leanest.length === 1 ? "makes" : "make"} ${lean.f.entryCalls}. The book puts that first: "The most important consideration for an interface is ease of use for higher level software."`,
    );
    break;
  }

  const apart = rows.filter((r) => r.where === "some").length;
  if (apart) lines.push(`They also differ in the product (${plural(apart, "fact")} above), so settle what to build before weighing how.`);
  else if (winners.size > 1)
    lines.push(`Different plans win on different counts. The chapter allows for that: you may "combine features of multiple alternatives into a new design that is better than any of the original choices."`);
  lines.push("Plans have no code yet, so this weighs interfaces and dependencies only, not how much each class hides behind them.");
  return { lines, source: `Ch 11 "Design it Twice"` };
}

// ---------- in the terminal ----------

const NUMBER = ["", "", "Two", "Three", "Four"];

export function printPlanComparison(c: PlanComparison): string {
  const n = c.sides.length;
  const out: string[] = [`${NUMBER[n] ?? n} plans, drawn against ${c.base.ref} (${c.base.short})`, ...c.sides.flatMap((s) => [`  ${s.label}: ${s.plan.title} (${s.plan.name})`, ...(s.plan.approach ? [`     ${s.plan.approach}`] : [])]), ""];
  out.push("What each adds to the product");
  const apart = c.product.filter((r) => r.where === "some");
  const same = c.product.filter((r) => r.where === "all");
  if (apart.length) {
    out.push(`  Where they part ways (${apart.length})`);
    for (const r of apart) r.cells.forEach((t, i) => out.push(`    ${i === 0 ? "-" : " "} ${c.sides[i].label}: ${t ?? "not in this plan"}`));
  }
  if (same.length) {
    out.push(`  The same in ${n === 2 ? "both" : "all"} (${same.length})`);
    for (const r of same) out.push(`    - ${r.cells[0]}`);
  }
  if (!c.product.length) out.push("  nothing in any plan");
  out.push("", "What the rest of the code must learn (public methods, outside controllers and policies)");
  const sameMethods = sharedMethods(c.sides);
  const listMethods = (classes: ReturnType<typeof surfaceClasses>) => {
    for (const k of classes) out.push(`    ${k.name}${k.isNew ? " (new)" : ""}: ${k.methods.map((m) => (k.isNew ? m : `+${m}`)).join(", ")}`);
  };
  if (sameMethods.size) {
    out.push(`  The same in ${n === 2 ? "both" : "all"}: ${plural(sameMethods.size, "method")}`);
    listMethods(surfaceClasses(c.sides[0], (k) => sameMethods.has(k)));
  }
  for (const s of c.sides) {
    out.push(`  ${s.label}: ${s.surface.methods} methods, ${s.surface.params} parameters${sameMethods.size ? ", of its own:" : ""}`);
    const own = surfaceClasses(s, (k) => !sameMethods.has(k));
    if (sameMethods.size && !own.length) out.push("    none");
    listMethods(own);
  }
  out.push("", "How tangled");
  for (const s of c.sides) {
    const k = s.coupling;
    out.push(`  ${s.label}: touches ${plural(k.touched, "class", "classes")} (${k.created} new, ${k.reshaped} reshaped), adds ${plural(k.arrows, "new dependency", "new dependencies")}, ${k.crossArea} between business areas`);
  }
  if (c.flows.length) {
    out.push("", "The same request under each plan");
    for (const p of c.flows) {
      out.push(`  ${p.title}`);
      c.sides.forEach((s, i) => {
        const f = p.at[i] === null ? null : s.flows[p.at[i]!];
        out.push(`    ${s.label}: ${f ? f.calls.join(", ") || "no calls" : "not in this plan"}`);
      });
    }
  }
  out.push("", `Ousterhout, ${c.note.source}`, ...c.note.lines.map((l) => `  ${l}`));
  return out.join("\n");
}
