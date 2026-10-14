import type { PlanCheck, PlanStatus } from "../shared/types.js";
import type { Workspace } from "../core/workspace.js";
import { PLAN_FORMAT, loadPlan } from "../core/plan.js";
import { parseSchema, readLifecycles } from "../core/product.js";

/**
 * `refract plan`: the pieces the /refract plan command in Claude Code needs.
 *   refract plan path [name]     where the plan for a branch lives
 *   refract plan format          the file format, with an example
 *   refract plan context         today's tables, lifecycles, screens, rules and classes, to plan against
 *   refract plan check [name]    what Refract could not read, then the plan against the branch's build
 */
export async function runPlanCommand(ws: Workspace, args: string[], flags: Record<string, string | boolean>): Promise<void> {
  const [sub = "path", nameArg] = args;
  const name = nameArg ?? (await ws.git.currentBranch()) ?? "plan";
  const out = (s: string): void => void process.stdout.write(s.endsWith("\n") ? s : s + "\n");
  switch (sub) {
    case "path":
      return out(ws.planPath(name));
    case "format":
      return out(PLAN_FORMAT);
    case "context":
      return out(await context(ws, typeof flags.base === "string" ? flags.base : undefined));
    case "check": {
      const file = ws.planPath(name);
      const plan = await loadPlan(file, name);
      if (!plan) throw new Error(`No plan at ${file}`);
      const lines = [`Plan: ${plan.title} (${file})`];
      if (plan.problems.length) lines.push("", "Refract could not read:", ...plan.problems.map((p) => `  - ${p}`));
      const branch = (await ws.git.tryResolve(name)) ? name : null;
      if (!branch) {
        lines.push("", `No branch called ${name} yet, so there is nothing built to check. Preview it with: refract --plan ${name}`);
        return out(lines.join("\n"));
      }
      const { base, head } = await ws.range(typeof flags.base === "string" ? `${flags.base}..${branch}` : branch);
      if (base === (await ws.git.resolve(head))) {
        lines.push("", `${name} has no commits of its own yet. Preview the plan with: refract --plan ${name}`);
        return out(lines.join("\n"));
      }
      const c = await ws.compare(base, head);
      const check = await ws.checkPlan(c, plan);
      if (flags.json) return out(JSON.stringify(check, null, 2));
      lines.push("", printPlanCheck(check));
      return out(lines.join("\n"));
    }
    default:
      throw new Error(`refract plan ${sub}: use path, format, context or check`);
  }
}

const HEADINGS: Record<PlanStatus, string> = {
  surprise: "Built but not in the plan",
  missing: "In the plan but not built",
  different: "Different from the plan",
  built: "As planned",
};
export const CHECK_ORDER: PlanStatus[] = ["surprise", "missing", "different", "built"];

export function printPlanCheck(check: PlanCheck): string {
  const out: string[] = [];
  for (const status of CHECK_ORDER) {
    const items = check.items.filter((i) => i.status === status);
    out.push(`${HEADINGS[status]} (${items.length})`);
    if (!items.length) out.push("  nothing");
    for (const i of items) out.push(`  - ${i.text}${i.detail ? `. ${i.detail}` : ""}`);
    out.push("");
  }
  return out.join("\n").trimEnd();
}


/** Today's code in the terms a plan uses, so a draft names real tables, states and classes. */
async function context(ws: Workspace, baseRef?: string): Promise<string> {
  const ref = baseRef ?? (await ws.git.defaultBranch()) ?? "HEAD";
  const commit = await ws.git.resolve(ref);
  const snap = await ws.store.snapshot(commit);
  const lines: string[] = [`# Today's code in ${ws.key} at ${ref} (${commit.slice(0, 9)})`, ""];

  const schemaPath = snap.allFiles.filter((p) => /(^|\/)db\/schema\.rb$/.test(p)).sort((a, b) => a.length - b.length)[0];
  if (schemaPath) {
    const schema = parseSchema((await ws.git.show(commit, schemaPath)) ?? "");
    lines.push(`## Tables (${schemaPath})`);
    for (const [t, def] of [...schema.tables].sort((a, b) => a[0].localeCompare(b[0]))) {
      const cols = [...def.columns.keys()].filter((c) => c !== "created_at" && c !== "updated_at");
      lines.push(`${t}: ${cols.join(", ")}`);
    }
    lines.push("");
  }

  const units = Object.values(snap.classes).sort((a, b) => a.name.localeCompare(b.name));
  const lifecycles: string[] = [];
  for (const u of units.filter((u) => u.role === "model")) {
    for (const loc of u.locations) {
      for (const l of readLifecycles((await ws.git.show(commit, loc.path)) ?? "")) {
        const moves = l.moves.map((m) => `${m.from} -> ${m.to}`).join(", ");
        lifecycles.push(`${u.name}.${l.field}: ${l.values.join(", ")}${moves ? `; moves: ${moves}` : ""}`);
      }
    }
  }
  if (lifecycles.length) lines.push("## Lifecycles", ...lifecycles, "");

  const pub = (u: (typeof units)[number]) => u.methods.filter((m) => m.visibility === "public" && m.name !== "initialize").map((m) => (m.scope === "class" ? `self.${m.name}` : m.name));
  const section = (title: string, roles: string[], withMethods: boolean) => {
    const of = units.filter((u) => roles.includes(u.role));
    if (!of.length) return;
    lines.push(`## ${title}`);
    for (const u of of) lines.push(withMethods ? `${u.name}: ${pub(u).join(", ")}` : u.name);
    lines.push("");
  };
  section("Controllers and their actions", ["controller"], true);
  section("Policies and their rules", ["policy"], true);
  section("Jobs and mailers", ["job", "mailer"], true);
  section("Models", ["model"], false);
  section("Services and other classes", ["service", "lib", "other", "concern", "component", "helper"], false);
  return lines.join("\n");
}
