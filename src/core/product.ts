import type {
  ChangeStatus,
  ColumnChange,
  Comparison,
  LifecycleChange,
  ProductChanges,
  RuleChange,
  ScreenChange,
  TableChange,
} from "../shared/types.js";
import type { Git } from "./git.js";
import { singularize } from "./inflect.js";

/**
 * What a change does to the product rather than to the code's shape: new
 * tables and columns, screens, permission rules, record lifecycles and
 * background jobs. All of it is read from the code at both commits, Rails
 * conventions first, so nothing here is guessed.
 */

// ---------- data ----------

interface Table {
  columns: Map<string, { type: string; note: string }>;
  checks: Set<string>;
}

export interface Schema {
  tables: Map<string, Table>;
  foreignKeys: { from: string; to: string; column: string }[];
}

const NOT_COLUMNS = new Set(["index", "check_constraint", "exclusion_constraint", "unique_constraint", "timestamps"]);

/** Reads a Rails db/schema.rb: tables, their columns and check constraints, and foreign keys. */
export function parseSchema(text: string): Schema {
  const tables = new Map<string, Table>();
  const foreignKeys: Schema["foreignKeys"] = [];
  let current: Table | null = null;
  for (const line of text.split("\n")) {
    const create = line.match(/^\s*create_table\s+"([^"]+)"/);
    if (create) {
      current = { columns: new Map(), checks: new Set() };
      tables.set(create[1], current);
      continue;
    }
    if (current && /^\s*end\s*$/.test(line)) {
      current = null;
      continue;
    }
    if (current) {
      const col = line.match(/^\s*t\.(\w+)\s+"([^"]+)"(.*)$/);
      if (col && !NOT_COLUMNS.has(col[1])) current.columns.set(col[2], { type: col[1], note: columnNote(col[3]) });
      const check = line.match(/^\s*t\.check_constraint\s.*name:\s*"([^"]+)"/);
      if (check) current.checks.add(check[1]);
      continue;
    }
    const fk = line.match(/^\s*add_foreign_key\s+"([^"]+)",\s*"([^"]+)"(.*)$/);
    if (fk) {
      const column = fk[3].match(/column:\s*"([^"]+)"/)?.[1] ?? `${singularize(fk[2])}_id`;
      foreignKeys.push({ from: fk[1], to: fk[2], column });
    }
  }
  return { tables, foreignKeys };
}

/** "null: false, default: "open"" reads as "required, default open". */
function columnNote(opts: string): string {
  const out: string[] = [];
  if (/null:\s*false/.test(opts)) out.push("required");
  const def = opts.match(/default:\s*("[^"]*"|\[[^\]]*\]|\{[^}]*\}|-?[\w.]+)/)?.[1];
  if (def !== undefined) out.push(`default ${def.replace(/^"|"$/g, "")}`);
  if (/array:\s*true/.test(opts)) out.push("array");
  return out.join(", ");
}

const BORING = new Set(["created_at", "updated_at"]);

export function compareSchemas(before: Schema | null, after: Schema | null): TableChange[] {
  const b = before?.tables ?? new Map<string, Table>();
  const a = after?.tables ?? new Map<string, Table>();
  const fks = (s: Schema | null, table: string) => (s?.foreignKeys ?? []).filter((f) => f.from === table);
  const out: TableChange[] = [];
  for (const name of [...new Set([...b.keys(), ...a.keys()])].sort()) {
    const tb = b.get(name);
    const ta = a.get(name);
    const status: ChangeStatus = !tb ? "added" : !ta ? "removed" : "changed";
    const columns: ColumnChange[] = [];
    let other = 0;
    for (const col of new Set([...(tb?.columns.keys() ?? []), ...(ta?.columns.keys() ?? [])])) {
      const cb = tb?.columns.get(col);
      const ca = ta?.columns.get(col);
      const now = ca ?? cb!;
      const st: ChangeStatus = !cb ? "added" : !ca ? "removed" : cb.type !== ca.type || cb.note !== ca.note ? "changed" : "unchanged";
      if (status === "changed" && st === "unchanged") {
        other++;
        continue;
      }
      if (status !== "changed" && BORING.has(col)) continue;
      columns.push({
        name: col,
        type: now.type,
        status: status === "changed" ? st : status,
        ...(now.note ? { note: now.note } : {}),
        ...(st === "changed" ? { was: [cb!.type, cb!.note].filter(Boolean).join(", ") } : {}),
      });
    }
    const fb = fks(before, name);
    const fa = fks(after, name);
    const key = (f: { to: string; column: string }) => `${f.to}.${f.column}`;
    const references = [
      ...fa.map((f) => ({ to: f.to, column: f.column, status: (fb.some((x) => key(x) === key(f)) ? "unchanged" : "added") as ChangeStatus })),
      ...fb.filter((f) => !fa.some((x) => key(x) === key(f))).map((f) => ({ to: f.to, column: f.column, status: "removed" as ChangeStatus })),
    ];
    const checks = {
      added: [...(ta?.checks ?? [])].filter((x) => !tb?.checks.has(x)).length,
      removed: [...(tb?.checks ?? [])].filter((x) => !ta?.checks.has(x)).length,
    };
    const moved = columns.length > 0 || references.some((r) => r.status !== "unchanged") || checks.added + checks.removed > 0;
    if (status === "changed" && !moved) continue;
    out.push({ name, status, columns, otherColumns: other, references, checks });
  }
  // New tables first, then changed, then removed.
  const order = { added: 0, changed: 1, removed: 2, unchanged: 3 };
  return out.sort((x, y) => order[x.status] - order[y.status]);
}

const SCHEMA_CALLS =
  /\b(create_table|drop_table|rename_table|add_column|remove_column|change_column|rename_column|add_reference|remove_reference|add_index|remove_index|add_foreign_key|remove_foreign_key|add_check_constraint|remove_check_constraint|add_timestamps|change_table|create_join_table)\b/;

export function migrationTitle(file: string): string {
  const base = file.split("/").pop()!.replace(/\.rb$/, "").replace(/^\d+_/, "");
  return base.replace(/_/g, " ");
}

// ---------- lifecycles ----------

/** Words inside %w[...] / %i[...] / [ "a", :b ] / { a: 0, "b" => 1 }. */
function words(list: string): string[] {
  const body = list.trim();
  if (/^%[wi][[(]/.test(body)) return body.slice(3, -1).split(/\s+/).filter(Boolean);
  if (body.startsWith("{")) return [...body.matchAll(/(?:"(\w+)"\s*=>|:?(\w+):\s)/g)].map((m) => m[1] ?? m[2]);
  return [...body.matchAll(/["':](\w+)"?/g)].map((m) => m[1]);
}

/** The text of a bracketed literal starting at `from`, nesting included. */
function literal(src: string, from: number): string {
  const open = src[from];
  const close = open === "[" ? "]" : open === "{" ? "}" : ")";
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(from, i + 1);
  }
  return src.slice(from);
}

const LIFECYCLE_FIELD = /^(state|status|\w+_state|\w+_status)$/;

/** A model's states (STATES / STATUSES constants, or a state-like enum) and the moves between them. */
export function readLifecycles(src: string): { field: string; values: string[]; moves: { from: string; to: string }[] }[] {
  const out: { field: string; values: string[]; moves: { from: string; to: string }[] }[] = [];
  for (const m of src.matchAll(/^\s*(STATES|STATUSES)\s*=\s*/gm)) {
    const at = m.index! + m[0].length;
    const lit = src[at] === "%" ? `%w${literal(src, at + 2)}` : literal(src, at);
    out.push({ field: m[1] === "STATES" ? "state" : "status", values: words(lit), moves: [] });
  }
  for (const m of src.matchAll(/^\s*enum\s+:?(\w+):?,?\s*/gm)) {
    if (!LIFECYCLE_FIELD.test(m[1])) continue;
    const at = m.index! + m[0].length;
    if (!"[{%".includes(src[at])) continue;
    const lit = src[at] === "%" ? `%w${literal(src, at + 2)}` : literal(src, at);
    if (!out.some((o) => o.field === m[1])) out.push({ field: m[1], values: words(lit), moves: [] });
  }
  const t = src.match(/^\s*\w*TRANSITIONS\s*=\s*\{/m);
  if (t && out.length) {
    const body = literal(src, t.index! + t[0].length - 1);
    for (const e of body.matchAll(/(?:"(\w+)"\s*=>|(\w+):)\s*(%[wi]\[[^\]]*\]|\[[^\]]*\])/g)) {
      for (const to of words(e[3])) out[0].moves.push({ from: e[1] ?? e[2], to });
    }
  }
  return out;
}

function compareLifecycles(model: string, before: string | null, after: string | null): LifecycleChange[] {
  const b = before ? readLifecycles(before) : [];
  const a = after ? readLifecycles(after) : [];
  const out: LifecycleChange[] = [];
  for (const field of new Set([...b.map((x) => x.field), ...a.map((x) => x.field)])) {
    const lb = b.find((x) => x.field === field);
    const la = a.find((x) => x.field === field);
    const key = (m: { from: string; to: string }) => `${m.from}>${m.to}`;
    const mb = new Set((lb?.moves ?? []).map(key));
    const ma = new Set((la?.moves ?? []).map(key));
    const moves = [
      ...(la?.moves ?? []).map((m) => ({ ...m, status: (lb && mb.has(key(m)) ? "unchanged" : "added") as ChangeStatus })),
      ...(lb?.moves ?? []).filter((m) => !ma.has(key(m))).map((m) => ({ ...m, status: "removed" as ChangeStatus })),
    ];
    const same = (lb?.values ?? []).join() === (la?.values ?? []).join() && moves.every((m) => m.status === "unchanged");
    if (same) continue;
    out.push({ model, field, status: !lb ? "added" : !la ? "removed" : "changed", before: lb?.values ?? [], after: la?.values ?? [], moves });
  }
  return out;
}

// ---------- everything ----------

const isMigration = (p: string) => /(^|\/)db\/migrate\/\d+_\w+\.rb$/.test(p);
const isSchema = (p: string) => /(^|\/)db\/schema\.rb$/.test(p);
const isRoutes = (p: string) => /(^|\/)config\/routes(\.rb|\/.*\.rb)$/.test(p);

export async function productChanges(git: Git, c: Comparison): Promise<ProductChanges> {
  const base = c.base.sha;
  const head = c.head.sha;
  const show = (commit: string, p: string) => git.show(commit, p);

  // Data: the primary schema(s) the change touched.
  const tables: TableChange[] = [];
  for (const f of c.files.filter((f) => isSchema(f.path))) {
    const [b, a] = await Promise.all([show(base, f.path), show(head, f.path)]);
    tables.push(...compareSchemas(b ? parseSchema(b) : null, a ? parseSchema(a) : null));
  }
  const migrations = await Promise.all(
    c.files
      .filter((f) => isMigration(f.path) && f.status === "A")
      .sort((x, y) => x.path.localeCompare(y.path))
      .map(async (f) => ({ file: f.path, title: migrationTitle(f.path), schema: SCHEMA_CALLS.test((await show(head, f.path)) ?? "") })),
  );

  // Screens: public controller actions that came or went.
  const screens: ScreenChange[] = c.classes
    .filter((k) => k.role === "controller" && k.status !== "unchanged")
    .map((k) => ({
      controller: k.name,
      status: k.status,
      actions: k.methods
        .filter((m) => m.scope === "instance" && (m.status === "added" || m.status === "removed"))
        .filter((m) => (m.after ?? m.before)!.visibility === "public")
        .map((m) => ({ name: m.name, status: m.status })),
    }))
    .filter((s) => s.status !== "changed" || s.actions.length > 0);

  const routes = { added: [] as string[], removed: [] as string[] };
  const routeFiles = c.files.filter((f) => isRoutes(f.path)).map((f) => f.path);
  if (routeFiles.length) {
    for (const line of (await git.diff(base, head, routeFiles, 0)).split("\n")) {
      const m = line.match(/^([+-])(?![+-])\s*(.*)$/);
      if (!m) continue;
      const code = m[2].replace(/\s+#.*$/, "").trim();
      if (!code || code.startsWith("#") || /^(end|do)$/.test(code)) continue;
      (m[1] === "+" ? routes.added : routes.removed).push(code);
    }
  }

  // Permissions: policy rules (public predicate methods) that came, went or changed.
  const permissions: RuleChange[] = c.classes
    .filter((k) => k.role === "policy")
    .flatMap((k) =>
      k.methods
        .filter((m) => m.name.endsWith("?") && m.status !== "unchanged" && (m.after ?? m.before)!.visibility === "public")
        .map((m) => ({ policy: k.name, rule: m.name, status: k.status === "added" ? "added" : m.status })),
    );

  // Lifecycles: state lists and the moves between them, in models the change touched.
  const lifecycles: LifecycleChange[] = [];
  for (const k of c.classes.filter((k) => k.role === "model" && k.touched)) {
    const touched = new Set(c.files.map((f) => f.path));
    for (const p of k.paths.filter((p) => touched.has(p))) {
      const [b, a] = await Promise.all([show(base, p), show(head, p)]);
      lifecycles.push(...compareLifecycles(k.name, b, a));
    }
  }

  // Background work: jobs and mailers that came or went, and new mailer methods.
  const jobs = c.classes
    .filter((k) => (k.role === "job" || k.role === "mailer") && k.status !== "unchanged")
    .map((k) => ({
      name: k.name,
      role: k.role,
      status: k.status,
      methods: k.methods.filter((m) => m.status === "added" && m.after?.visibility === "public").map((m) => m.name),
    }))
    .filter((j) => j.status !== "changed" || (j.role === "mailer" && j.methods.length > 0));

  return { tables, migrations, screens, routes, permissions, lifecycles, jobs };
}
