import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { Role } from "../shared/types.js";
import { homeFor } from "./areas.js";
import { singularize } from "./inflect.js";

/**
 * A plan: one small file saying what a change intends to do, in the same
 * terms Refract reads from code (tables, lifecycles, screens, permission
 * rules, jobs, classes and call trees). Refract draws it before any code
 * exists, and checks the branch against it before merge. Plans live outside
 * the project, at ~/.refract/<repo>/plans/<branch>.yml, like areas.yml.
 */

export interface PlanColumn {
  name: string;
  type?: string;
}

export interface PlanReference {
  to: string;
  column: string;
}

export interface PlanTable {
  name: string;
  isNew: boolean;
  /**
   * Tables this one points at, plural as in the schema, and the column that does it:
   * `belongs_to: orgs` is org_id, and `belongs_to: { home_site: sites }` is home_site_id pointing at sites.
   */
  belongsTo: PlanReference[];
  /** For a new table: its columns. */
  columns: PlanColumn[];
  /** For an existing table: columns to add and to drop. */
  add: PlanColumn[];
  remove: string[];
}

export interface PlanMove {
  from: string;
  to: string;
}

export interface PlanLifecycle {
  model: string;
  field: string;
  addStates: string[];
  removeStates: string[];
  moves: PlanMove[];
  removeMoves: PlanMove[];
}

/** An action or rule as written: `+mark_sent` adds to an existing class, `-old` drops one, a bare name is simply there. */
export interface PlanName {
  name: string;
  op: "+" | "-" | "";
}

export interface PlanScreen {
  controller: string;
  actions: PlanName[];
}

export interface PlanRules {
  policy: string;
  rules: PlanName[];
}

export interface PlanJob {
  name: string;
  methods: string[];
}

export interface PlanMethod {
  name: string;
  scope: "instance" | "class";
  /** null when the plan gives no parentheses, so the parameters are not part of the plan. */
  params: number | null;
  signature: string;
}

export interface PlanClass {
  name: string;
  role?: Role;
  note?: string;
  public: PlanMethod[];
  /** Public methods the plan takes away, written `-name` in its public list. */
  remove: PlanMethod[];
  dependsOn: string[];
}

export interface PlanStep {
  cls: string;
  method: string;
  scope: "instance" | "class";
  text: string;
}

export interface PlanFlow {
  name: string;
  steps: PlanStep[];
  /** Who calls whom, as indexes into steps. */
  calls: { from: number; to: number }[];
}

export interface Plan {
  name: string;
  file: string;
  /** The file as written, for prompts and for showing. */
  text: string;
  /** A short hash of the text, for caches. */
  hash: string;
  title: string;
  why?: string;
  /** One or two sentences on what sets this design apart from the others for the same goal. */
  approach?: string;
  /** A name of a word or two for when plans sit side by side ("Home model"). */
  short?: string;
  tables: PlanTable[];
  lifecycles: PlanLifecycle[];
  screens: PlanScreen[];
  permissions: PlanRules[];
  jobs: PlanJob[];
  classes: PlanClass[];
  flows: PlanFlow[];
  /** What Refract could not read, in plain words. The rest of the plan still works. */
  problems: string[];
}

export function plansDir(repoKey: string): string {
  return path.join(homeFor(repoKey), "plans");
}

/** A plan's file: a path as given, or ~/.refract/<repo>/plans/<name>.yml. Branch slashes become folders. */
export function planFile(repoKey: string, name: string): string {
  // A name as given; "agent/feature-x" lives at plans/agent/feature-x.yml.
  if (/\.ya?ml$/.test(name) || name.startsWith(".") || path.isAbsolute(name)) return path.resolve(name);
  return path.join(plansDir(repoKey), `${name}.yml`);
}

export async function loadPlan(file: string, name?: string): Promise<Plan | null> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
  return parsePlan(text, file, name);
}

const ROLES: Role[] = ["model", "controller", "service", "job", "mailer", "helper", "concern", "policy", "component", "lib", "other"];

export function parsePlan(text: string, file = "plan.yml", name = path.basename(file).replace(/\.ya?ml$/, "")): Plan {
  const hash = createHash("sha1").update(text).digest("hex").slice(0, 12);
  const plan: Plan = { name, file, text, hash, title: name, tables: [], lifecycles: [], screens: [], permissions: [], jobs: [], classes: [], flows: [], problems: [] };
  let doc: Record<string, unknown>;
  try {
    doc = (YAML.parse(text) ?? {}) as Record<string, unknown>;
  } catch (e) {
    plan.problems.push(`The file is not valid YAML: ${(e as Error).message.split("\n")[0]}`);
    return plan;
  }
  if (typeof doc !== "object" || Array.isArray(doc)) {
    plan.problems.push("The file should be a map with sections like tables, classes and flows.");
    return plan;
  }
  const problem = (msg: string) => plan.problems.push(msg);
  if (typeof doc.title === "string") plan.title = doc.title;
  if (typeof doc.why === "string") plan.why = doc.why;
  if (typeof doc.approach === "string") plan.approach = doc.approach;
  if (typeof doc.short === "string") plan.short = doc.short;

  for (const [table, v] of entries(doc.tables, "tables", problem)) {
    const o = asMap(v);
    const isNew = o.new === true || (o.columns !== undefined && o.add === undefined && o.remove === undefined);
    plan.tables.push({
      name: table,
      isNew,
      belongsTo: references(o.belongs_to),
      columns: columns(o.columns),
      add: columns(o.add),
      remove: list(o.remove),
    });
  }

  for (const [key, v] of entries(doc.lifecycles, "lifecycles", problem)) {
    const [model, field = "state"] = key.split(".");
    const o = asMap(v);
    const moves = (x: unknown) =>
      list(x).flatMap((m) => {
        const parts = m.split(/\s*(?:->|→)\s*/);
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          problem(`In lifecycles, "${m}" should look like "approved -> sent".`);
          return [];
        }
        return [{ from: parts[0], to: parts[1] }];
      });
    plan.lifecycles.push({
      model,
      field,
      addStates: list(o.add_states ?? o.states),
      removeStates: list(o.remove_states),
      moves: moves(o.moves),
      removeMoves: moves(o.remove_moves),
    });
  }

  for (const [controller, v] of entries(doc.screens, "screens", problem)) plan.screens.push({ controller, actions: list(v).map(opName) });
  for (const [policy, v] of entries(doc.permissions, "permissions", problem)) plan.permissions.push({ policy, rules: list(v).map(opName) });

  if (Array.isArray(doc.jobs)) plan.jobs.push(...list(doc.jobs).map((n) => ({ name: n, methods: [] })));
  else for (const [job, v] of entries(doc.jobs, "jobs", problem)) plan.jobs.push({ name: job, methods: rejoin(list(v)).map((m) => signature(m).name) });

  for (const [cls, v] of entries(doc.classes, "classes", problem)) {
    const o = Array.isArray(v) ? { public: v } : asMap(v);
    const role = typeof o.role === "string" ? (o.role as Role) : undefined;
    if (role && !ROLES.includes(role)) problem(`${cls} has role "${role}"; use one of ${ROLES.join(", ")}.`);
    plan.classes.push({
      name: cls,
      role: role && ROLES.includes(role) ? role : undefined,
      note: typeof o.note === "string" ? o.note : undefined,
      public: rejoin(list(o.public)).filter((m) => !m.startsWith("-")).map(signature),
      remove: rejoin(list(o.public)).filter((m) => m.startsWith("-")).map((m) => signature(m.slice(1))),
      dependsOn: list(o.depends_on),
    });
  }

  for (const [flow, v] of entries(doc.flows, "flows", problem)) {
    const f: PlanFlow = { name: flow, steps: [], calls: [] };
    const node = (text: string): number | null => {
      const s = step(text);
      if (!s) {
        problem(`In the flow "${flow}", "${text}" should name a method like Class#method or Class.method.`);
        return null;
      }
      const at = f.steps.findIndex((x) => x.text === s.text);
      if (at >= 0) return at;
      f.steps.push(s);
      return f.steps.length - 1;
    };
    // A flat list reads top to bottom, each step calling the next. A step written as a key
    // holds the steps it calls, so a call tree can branch.
    const walk = (items: unknown, parent: number | null, chain: boolean) => {
      let prev = parent;
      for (const item of Array.isArray(items) ? items : [items]) {
        let here: number | null = null;
        let children: unknown;
        if (typeof item === "string") here = node(item);
        else if (item && typeof item === "object" && Object.keys(item).length === 1) {
          const [k, kids] = Object.entries(item as Record<string, unknown>)[0];
          here = node(k);
          children = kids;
        } else problem(`In the flow "${flow}", each step should be a method name, or a method with the steps it calls under it.`);
        if (here === null) continue;
        const caller = chain ? prev : parent;
        if (caller !== null && caller !== here) f.calls.push({ from: caller, to: here });
        if (children) walk(children, here, false);
        prev = here;
      }
    };
    walk(v, null, true);
    plan.flows.push(f);
  }

  const known = new Set(["title", "short", "why", "approach", "tables", "lifecycles", "screens", "permissions", "jobs", "classes", "flows"]);
  for (const k of Object.keys(doc)) if (!known.has(k)) problem(`Refract does not know the section "${k}"; it was left out.`);
  return plan;
}

function entries(v: unknown, section: string, problem: (m: string) => void): [string, unknown][] {
  if (v === undefined || v === null) return [];
  if (typeof v !== "object" || Array.isArray(v)) {
    problem(`The ${section} section should be a map keyed by name.`);
    return [];
  }
  return Object.entries(v as Record<string, unknown>);
}

function asMap(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function list(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.flatMap((x) => (typeof x === "string" || typeof x === "number" ? [String(x).trim()] : x && typeof x === "object" ? Object.keys(x) : []));
  if (typeof v === "string") return v.split(/\s*,\s*/).filter(Boolean);
  if (typeof v === "object") return Object.keys(v as object);
  return [String(v)];
}

/** `orgs`, `[orgs, fees]`, or a map naming the association: `{ home_site: sites }` (Rails' `belongs_to :home_site, class_name: "Site"`). */
function references(v: unknown): PlanReference[] {
  const named = (name: string, to: string) => ({ to, column: name.endsWith("_id") ? name : `${name}_id` });
  const one = (x: unknown): PlanReference[] =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.entries(x as Record<string, unknown>).map(([name, to]) => named(name, String(to)))
      : list(x).map((to) => ({ to, column: `${singularize(to)}_id` }));
  return Array.isArray(v) ? v.flatMap(one) : one(v);
}

/** Columns as `[name, price_cents:integer]` or `{ name: string, price_cents: integer }`. */
/**
 * YAML's [a, b] splits on every comma, so "add_fee(fee, qty)" arrives as two
 * items. Joins them back until the parentheses balance.
 */
function rejoin(items: string[]): string[] {
  const out: string[] = [];
  let open = "";
  for (const item of items) {
    open = open ? `${open}, ${item}` : item;
    if ((open.match(/\(/g) ?? []).length <= (open.match(/\)/g) ?? []).length) {
      out.push(open);
      open = "";
    }
  }
  if (open) out.push(open);
  return out;
}

function columns(v: unknown): PlanColumn[] {
  if (v && typeof v === "object" && !Array.isArray(v)) return Object.entries(v as Record<string, unknown>).map(([name, type]) => ({ name, type: type ? String(type) : undefined }));
  return list(v).map((c) => {
    const [name, type] = c.split(/\s*:\s*/);
    return { name, ...(type ? { type } : {}) };
  });
}

function opName(s: string): PlanName {
  const m = s.match(/^([+-])\s*(.+)$/);
  return m ? { name: m[2], op: m[1] as "+" | "-" } : { name: s, op: "" };
}

/** "add_fee(fee, qty, by)" has three parameters; "assign_numbers!" leaves them out of the plan. */
export function signature(s: string): PlanMethod {
  const text = s.trim();
  const m = text.match(/^(self\.)?([^\s(]+)\s*(?:\((.*)\))?$/);
  if (!m) return { name: text, scope: "instance", params: null, signature: text };
  const args = m[3];
  const params = args === undefined ? null : args.trim() === "" ? 0 : splitArgs(args).filter((a) => !a.startsWith("&")).length;
  return { name: m[2], scope: m[1] ? "class" : "instance", params, signature: text };
}

function splitArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of args) {
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function step(text: string): PlanStep | null {
  const m = text.trim().match(/^([A-Z][\w:]*)([#.])([^\s#.(]+)/);
  if (!m) return null;
  return { cls: m[1], method: m[3], scope: m[2] === "." ? "class" : "instance", text: `${m[1]}${m[2]}${m[3]}` };
}

/** The format, as `refract plan --format` prints it and the /refract plan command reads it. */
export const PLAN_FORMAT = `# A Refract plan: what a change intends to do, before the code exists.
# Lives at ~/.refract/<repo>/plans/<branch>.yml. Every section is optional:
# a medium change might be only tables and lifecycles.

title: Invoices for approved timesheets     # one line
why: Contractors bill orgs for fees and expenses.
approach: Charges are rows on a new table, priced by one service.   # one or two sentences; shown when plans are compared side by side
short: Fee table                            # optional: a word or two naming the plan beside others

tables:                                      # db/schema.rb
  fees:              { new: true, belongs_to: orgs, columns: [name, unit, price_cents:integer] }
  timesheet_charges: { new: true, belongs_to: [timesheets, fees], columns: [description, quantity] }
  timesheets:        { add: [sent_at:datetime, sent_by_id], remove: [legacy_total] }
  invoices:          { add: [billed_to_id], belongs_to: { billed_to: orgs } }   # a map when the column is not <table>_id

lifecycles:                                  # a model's STATES / enum and its TRANSITIONS
  Timesheet.state:
    add_states: [sent]
    remove_states: []
    moves: [approved -> sent, sent -> paid]

screens:                                     # controllers and their public actions
  Org::Settings::FeesController: [index, new, create]   # a new controller
  Org::TimesheetsController: [+mark_sent, -legacy]       # + adds to an existing one, - removes

permissions:                                 # public ? methods on policies
  TimesheetPolicy: [mark_sent?, edit_charges?]

jobs:                                        # jobs and mailers; a mailer can list its emails
  InvoiceMailer: [invoice_sent]

classes:                                     # new or reshaped classes
  TimesheetCharges:
    role: service                            # optional; guessed from the name otherwise
    note: One home for charge rules.
    public: [add_fee(fee, qty, by), reprice(charge, cents), self.for(timesheet)]
    depends_on: [Timesheet, TimesheetCharge, Fee]
  Timesheet:                                 # an existing class: say what it gains, and -name what it loses
    note: Totals move to TimesheetCharges.   # named with no new methods, a class changes how it behaves
    public: [charges, -legacy_total]

flows:                                       # call trees for the requests that matter
  "contractor adds a fee":                   # a flat list: each step calls the next
    - Org::Timesheets::ChargesController#create
    - TimesheetCharges#add_fee
    - TimesheetCharge.create!
  "org sends an invoice":                    # a step with steps under it calls each of them
    - Org::TimesheetsController#mark_sent:
        - Timesheet#send!
        - InvoiceMailer.invoice_sent
`;
