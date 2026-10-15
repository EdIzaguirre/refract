import type { Comparison, PlanComparison, PlanSide, ProductChanges, ProductPart, ProductRow, Role, Sequence } from "../shared/types.js";
import type { Plan, PlanFlow } from "./plan.js";
import { planInfo } from "./plan-preview.js";

/**
 * Two plans for the same goal, side by side: Ousterhout's "design it twice"
 * (A Philosophy of Software Design, Ch 11). Both are drawn against the same
 * code, then compared on what they add to the product, how much the rest of
 * the code must learn, how many arrows they add, and how the same request
 * runs under each. Plans have no code, so depth is judged from interfaces and
 * arrows only.
 */

/** Roles whose public methods are product facts (screens, rules, emails), so they are not counted as interface. */
const PRODUCT_ROLES: Role[] = ["controller", "policy", "job", "mailer"];

const short = (n: string) => n.split("::").pop() ?? n;
const shortController = (n: string) => n.replace(/Controller$/, "");
const list = (xs: string[]) => xs.join(", ");

export function comparePlans(
  base: { ref: string; short: string },
  a: { plan: Plan; comparison: Comparison },
  b: { plan: Plan; comparison: Comparison },
): PlanComparison {
  const sides: [PlanSide, PlanSide] = [side("A", a.plan, a.comparison), side("B", b.plan, b.comparison)];
  const product = productRows(sides[0].product, sides[1].product);
  const flows = pairFlows(a.plan.flows, b.plan.flows);
  return { base, sides, product, flows, note: note(sides, product, flows) };
}

function side(label: "A" | "B", plan: Plan, c: Comparison): PlanSide {
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
const WHERE_ORDER: ProductRow["where"][] = ["different", "a", "b", "both"];

export function productRows(a: ProductChanges, b: ProductChanges): ProductRow[] {
  const fa = productFacts(a);
  const fb = new Map(productFacts(b).map((f) => [f.key, f]));
  const rows: ProductRow[] = [];
  for (const x of fa) {
    const y = fb.get(x.key);
    fb.delete(x.key);
    if (!y) rows.push({ part: x.part, subject: x.subject, a: x.text, where: "a" });
    else rows.push({ part: x.part, subject: x.subject, a: x.text, b: y.text, where: x.same === y.same ? "both" : "different" });
  }
  for (const y of fb.values()) rows.push({ part: y.part, subject: y.subject, b: y.text, where: "b" });
  // Where they differ first; within that, the product's own order.
  return rows
    .map((r, i) => ({ r, i }))
    .sort((x, y) => WHERE_ORDER.indexOf(x.r.where) - WHERE_ORDER.indexOf(y.r.where) || PART_ORDER.indexOf(x.r.part) - PART_ORDER.indexOf(y.r.part) || x.i - y.i)
    .map(({ r }) => r);
}

// ---------- the same request under each plan ----------

const entry = (f: PlanFlow) => f.steps[0]?.text ?? "";
const entryClass = (f: PlanFlow) => f.steps[0]?.cls ?? "";

/** Pairs flows by name, then by the action they start from, then by the controller. */
export function pairFlows(a: PlanFlow[], b: PlanFlow[]): PlanComparison["flows"] {
  const left = new Set(b.map((_, i) => i));
  const take = (match: (y: PlanFlow) => boolean) => {
    const j = [...left].find((i) => match(b[i]));
    if (j !== undefined) left.delete(j);
    return j;
  };
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const firstPass = a.map((x) => take((y) => norm(y.name) === norm(x.name)));
  const out = a.map((x, i) => {
    const j = firstPass[i] ?? take((y) => entry(y) === entry(x)) ?? take((y) => entryClass(y) === entryClass(x));
    return { title: x.name, a: i, ...(j !== undefined ? { b: j } : {}) };
  });
  for (const j of left) out.push({ title: b[j].name, b: j } as (typeof out)[number]);
  return out;
}

// ---------- the Ousterhout note ----------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * One short note, argued from Ch 11 "Design it Twice". Every quote is verbatim
 * from the book (checked against the text in lenses/ousterhout-lens.md and the
 * chapter itself), and the measures are the ones on the page.
 */
export function note(sides: [PlanSide, PlanSide], rows: ProductRow[], flows: PlanComparison["flows"]): PlanComparison["note"] {
  const [A, B] = sides;
  const lines: string[] = [];
  const wins = { A: 0, B: 0 };

  const sa = A.surface;
  const sb = B.surface;
  const methods = (s: PlanSide["surface"]) => `${plural(s.methods, "public method")}${s.params ? ` with ${plural(s.params, "parameter")}` : ""}`;
  let first = `The chapter's checklist asks: "Does one alternative have a simpler interface than another?"`;
  if (sa.methods === sb.methods && sa.params === sb.params) first += ` By that count they tie: each asks the rest of the code to learn ${methods(sa)}.`;
  else {
    const [simple, wide] = sa.methods + sa.params <= sb.methods + sb.params ? [A, B] : [B, A];
    wins[simple.label]++;
    first += ` Plan ${simple.label} asks the rest of the code to learn ${methods(simple.surface)}; Plan ${wide.label} asks for ${methods(wide.surface)}.`;
  }
  const ca = A.coupling.arrows;
  const cb = B.coupling.arrows;
  if (ca !== cb) {
    const [less, more] = ca < cb ? [A, B] : [B, A];
    wins[less.label]++;
    first += ` ${less.label} also adds fewer arrows between classes (${less.coupling.arrows} to ${more.coupling.arrows}), so fewer classes have to change together.`;
  }
  lines.push(first);

  // The book's first test: what the caller has to do. A controller driving many steps does work the module could.
  for (const p of flows) {
    if (p.a === undefined || p.b === undefined) continue;
    const fa = A.flows[p.a];
    const fb = B.flows[p.b];
    if (fa.entryCalls === fb.entryCalls) continue;
    const [lean, busy] = fa.entryCalls < fb.entryCalls ? [{ s: A, f: fa }, { s: B, f: fb }] : [{ s: B, f: fb }, { s: A, f: fa }];
    wins[lean.s.label]++;
    lines.push(
      `In "${p.title}", ${busy.s.label}'s entry point drives ${plural(busy.f.entryCalls, "call")} itself where ${lean.s.label}'s makes ${lean.f.entryCalls}. The book puts that first: "The most important consideration for an interface is ease of use for higher level software."`,
    );
    break;
  }

  const apart = rows.filter((r) => r.where !== "both").length;
  if (apart) lines.push(`They also differ in the product (${plural(apart, "fact")} above), so settle what to build before weighing how.`);
  else if (wins.A && wins.B)
    lines.push(`Each plan wins on something. The chapter allows for that: you may "combine features of multiple alternatives into a new design that is better than any of the original choices."`);
  lines.push("Plans have no code yet, so this weighs interfaces and arrows only, not how much each class hides behind them.");
  return { lines, source: `Ch 11 "Design it Twice"` };
}

// ---------- in the terminal ----------

const WHERE_HEAD: Record<ProductRow["where"], string> = {
  different: "Both plans touch these, in different ways",
  a: "Only in Plan A",
  b: "Only in Plan B",
  both: "The same in both",
};

export function printPlanComparison(c: PlanComparison): string {
  const [A, B] = c.sides;
  const out: string[] = [`Two plans, drawn against ${c.base.ref} (${c.base.short})`, `  A: ${A.plan.title} (${A.plan.name})`, `  B: ${B.plan.title} (${B.plan.name})`, ""];
  out.push("What each adds to the product");
  for (const where of WHERE_ORDER) {
    const rows = c.product.filter((r) => r.where === where);
    if (!rows.length) continue;
    out.push(`  ${WHERE_HEAD[where]} (${rows.length})`);
    for (const r of rows) {
      if (where === "different") out.push(`    - A: ${r.a}`, `      B: ${r.b}`);
      else out.push(`    - ${r.a ?? r.b}`);
    }
  }
  if (!c.product.length) out.push("  nothing in either plan");
  out.push("", "What the rest of the code must learn (public methods, outside controllers and policies)");
  for (const s of c.sides) {
    out.push(`  ${s.label}: ${s.surface.methods} methods, ${s.surface.params} parameters`);
    for (const k of s.surface.classes) out.push(`    ${short(k.name)}${k.isNew ? " (new)" : ""}: ${k.methods.join(", ")}`);
  }
  out.push("", "How tangled");
  for (const s of c.sides) {
    const k = s.coupling;
    out.push(`  ${s.label}: touches ${plural(k.touched, "class", "classes")} (${k.created} new, ${k.reshaped} reshaped), adds ${plural(k.arrows, "arrow")}, ${k.crossArea} between business areas`);
  }
  if (c.flows.length) {
    out.push("", "The same request under each plan");
    for (const p of c.flows) {
      out.push(`  ${p.title}`);
      for (const s of c.sides) {
        const i = s.label === "A" ? p.a : p.b;
        const f = i === undefined ? null : s.flows[i];
        out.push(`    ${s.label}: ${f ? f.calls.join(", ") || "no calls" : "not in this plan"}`);
      }
    }
  }
  out.push("", `Ousterhout, ${c.note.source}`, ...c.note.lines.map((l) => `  ${l}`));
  return out.join("\n");
}
