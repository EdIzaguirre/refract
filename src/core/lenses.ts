import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Comparison, Disagreement, LensId, LensQuestion, LensReport, LensResult } from "../shared/types.js";
import { askClaude } from "./claude.js";
import type { Workspace } from "./workspace.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const LENS_DIR = path.resolve(here, "../../lenses");

export const LENSES: { id: LensId; who: string; book: string; file: string }[] = [
  { id: "metz", who: "Sandi Metz", book: "Practical Object-Oriented Design (2nd ed.)", file: "metz-lens.md" },
  { id: "ousterhout", who: "John Ousterhout", book: "A Philosophy of Software Design (2nd ed.)", file: "ousterhout-lens.md" },
  { id: "copeland", who: "David Bryant Copeland", book: "Sustainable Web Development with Ruby on Rails", file: "copeland-lens.md" },
];

const target = {
  type: "object",
  properties: { kind: { enum: ["class", "area", "method"] }, name: { type: "string" } },
  required: ["kind", "name"],
};

const LENS_SCHEMA = {
  type: "object",
  properties: {
    overall: { type: "string" },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tone: { enum: ["likes", "asks", "worries"] },
          text: { type: "string" },
          evidence: { type: "string" },
          source: { type: "string" },
          quote: { type: "string" },
          target,
        },
        required: ["tone", "text", "evidence", "source"],
      },
    },
  },
  required: ["overall", "questions"],
};

const DISAGREE_SCHEMA = {
  type: "object",
  properties: {
    disagreements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string" },
          target,
          positions: {
            type: "object",
            properties: { metz: { type: "string" }, ousterhout: { type: "string" }, copeland: { type: "string" } },
          },
          tradeoff: { type: "string" },
        },
        required: ["topic", "positions", "tradeoff"],
      },
    },
  },
  required: ["disagreements"],
};

/** The measured facts a lens argues from: only what changed, small enough for one prompt. */
export function factsFor(c: Comparison) {
  const areaName = (id: string) => c.areas.find((a) => a.id === id)?.name ?? id;
  const moved = c.classes.filter((k) => k.status !== "unchanged");
  return {
    range: `${c.base.short}..${c.head.short}`,
    headSubject: c.head.subject,
    stats: c.stats,
    measuredVerdict: { label: c.verdict.label, summary: c.verdict.summary },
    deltas: c.deltas.map(({ what, before, after, change, why }) => ({ what, before, after, change, why })),
    classes: moved.map((k) => ({
      name: k.name,
      area: areaName(k.area),
      role: k.role,
      status: k.status,
      superclass: k.superclass,
      inheritedBy: k.descendants,
      shape: k.shape,
      nestedClasses: k.nested,
      helperMethods: k.after?.helperMethods ?? k.before?.helperMethods ?? [],
      callbacks: (k.after ?? k.before)?.callbacks.map((cb) => `${cb.kind} ${cb.targets.join(", ")}`) ?? [],
      methods: k.methods
        .filter((m) => m.status !== "unchanged")
        .map((m) => ({
          name: m.scope === "class" ? `self.${m.name}` : m.name,
          status: m.status,
          before: m.before,
          after: m.after,
        })),
    })),
    dependencies: c.edges
      .filter((e) => e.status !== "unchanged")
      .map((e) => `${e.status === "added" ? "+" : "-"} ${e.from} -> ${e.to} (${e.kind})`),
    areaDependencies: c.areaEdges
      .filter((e) => e.before !== e.after)
      .map((e) => `${areaName(e.from)} -> ${areaName(e.to)}: ${e.before} -> ${e.after} class links`),
    files: c.files.map((f) => `${f.status} ${f.path} +${f.additions} -${f.deletions}`),
  };
}

/** The real diff of application code, trimmed so a prompt stays readable. */
export async function diffFor(ws: Workspace, c: Comparison, budget = 90_000): Promise<string> {
  const app = c.files.filter((f) => f.kind === "app").sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions));
  let out = "";
  for (const f of app) {
    let d = await ws.git.diff(c.base.sha, c.head.sha, [f.path], 2);
    if (d.length > 12_000) d = d.slice(0, 12_000) + `\n… (${f.path} diff trimmed)\n`;
    if (out.length + d.length > budget) {
      out += `\n… diffs for ${app.length - app.indexOf(f)} more files left out\n`;
      break;
    }
    out += d;
  }
  return out;
}

function lensPrompt(lens: (typeof LENSES)[number], checklist: string, facts: object, diff: string): string {
  return `You are the ${lens.who} lens in Refract, a tool that helps a developer judge a code change (often an AI agent's branch) before merging it. You speak for the book "${lens.book}" and only for it.

Argue only from the checklist below. It was built from the book with quotes checked word for word. Never cite the book from memory, never invent a quote, and never cite anything the checklist's "Claims to correct" section says the book does not say. When you quote, copy the quote exactly from the checklist.

The measurements below come from parsing the code at both commits. Treat them as facts. Every question you write must point at something specific in the measurements or the diff, and its evidence must say what was measured or seen.

First write overall: two or three plain sentences on how this book would judge the change as a whole, the way its author might sum it up to a colleague. Name the one or two things that matter most to this book, good or bad. No quotes and no rule numbers here.

Then write 2 to 5 items. Each is either something the book would like about this change ("likes") or a pointed question it would ask ("asks"), or a real concern ("worries"). Lead with what matters most. Do not give scores. Questions should be answerable: name the class or method and say what would change the answer. Plain, direct sentences; no hedging filler; no em dashes. Put the class (or area, or "Class#method") the item is about in target, using names exactly as they appear in the measurements. Use "Class#method" (or "Class.method" for a class method) whenever the item is about a specific method, so the reader can jump straight to that code.

The book treats its rules as guidelines, so phrase hits as questions about the cost of change, not as failures.

<checklist>
${checklist}
</checklist>

<measurements>
${JSON.stringify(facts, null, 1)}
</measurements>

<diff>
${diff}
</diff>`;
}

function disagreementPrompt(results: LensResult[], facts: object): string {
  return `Three design lenses reviewed the same code change. Find the places where they would disagree about the same piece of code, where one likes what another questions, or where they weigh the same trade-off differently. Return at most 2, only real ones; return an empty list if they agree. For each, say in one sentence per lens where it stands, using only what that lens said below, and one sentence on the trade-off. Plain sentences, no em dashes. target names the class exactly as in the measurements.

<lenses>
${JSON.stringify(results.map((r) => ({ lens: r.lens, questions: r.questions })), null, 1)}
</lenses>

<measurements>
${JSON.stringify((facts as { classes: unknown }).classes, null, 1).slice(0, 30_000)}
</measurements>`;
}

async function cachePath(ws: Workspace, c: Comparison): Promise<string> {
  const dir = path.join(await ws.git.gitDir(), "refract", "lenses");
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, `${c.base.sha}-${c.head.sha}.json`);
}

export async function cachedLenses(ws: Workspace, c: Comparison): Promise<LensReport | null> {
  try {
    return JSON.parse(await fs.readFile(await cachePath(ws, c), "utf8")) as LensReport;
  } catch {
    return null;
  }
}

/** Runs the three lenses in parallel, then asks where they disagree. */
export async function runLenses(
  ws: Workspace,
  c: Comparison,
  log: (msg: string) => void = () => {},
  onProgress: (r: LensReport) => void = () => {},
): Promise<LensReport> {
  const report: LensReport = {
    base: c.base.sha,
    head: c.head.sha,
    status: "running",
    startedAt: new Date().toISOString(),
    lenses: [],
    disagreements: [],
  };
  onProgress(report);
  const facts = factsFor(c);
  const diff = await diffFor(ws, c);
  report.lenses = await Promise.all(
    LENSES.map(async (lens): Promise<LensResult> => {
      try {
        log(`Asking the ${lens.who} lens…`);
        const checklist = await fs.readFile(path.join(LENS_DIR, lens.file), "utf8");
        const out = await askClaude<{ overall?: string; questions: LensQuestion[] }>(lensPrompt(lens, checklist, facts, diff), LENS_SCHEMA, {
          cwd: ws.git.root,
        });
        const result: LensResult = { lens: lens.id, overall: out.overall, questions: out.questions ?? [] };
        report.lenses = [...report.lenses.filter((l) => l.lens !== lens.id), result];
        onProgress({ ...report });
        log(`${lens.who}: ${result.questions.length} items`);
        return result;
      } catch (e) {
        log(`${lens.who} failed: ${(e as Error).message}`);
        return { lens: lens.id, questions: [], error: (e as Error).message };
      }
    }),
  );
  const ok = report.lenses.filter((l) => !l.error && l.questions.length);
  if (ok.length >= 2) {
    try {
      const out = await askClaude<{ disagreements: Disagreement[] }>(disagreementPrompt(ok, facts), DISAGREE_SCHEMA, { cwd: ws.git.root });
      report.disagreements = out.disagreements ?? [];
    } catch (e) {
      log(`Disagreement pass failed: ${(e as Error).message}`);
    }
  }
  report.status = report.lenses.every((l) => l.error) ? "error" : "done";
  report.error = report.status === "error" ? report.lenses[0]?.error : undefined;
  report.finishedAt = new Date().toISOString();
  if (report.status === "done") await fs.writeFile(await cachePath(ws, c), JSON.stringify(report, null, 2));
  onProgress(report);
  return report;
}
