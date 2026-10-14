import fs from "node:fs/promises";
import path from "node:path";
import type { ClassChange, Comparison, Delta, PlanTheme, ProductPart, Story, StoryStop, Tone } from "../shared/types.js";
import { askClaude } from "./claude.js";
import { diffFor, factsFor } from "./lenses.js";
import type { Workspace } from "./workspace.js";

/**
 * The guided tour: the change told as a few stops in plain words, each with
 * the handful of classes it is about. Claude Code writes it from the
 * measurements; until it has (or when it can't), the stops come straight
 * from the measured deltas.
 */

const MAX_CLASSES = 6;
const PARTS: ProductPart[] = ["data", "screens", "permissions", "lifecycles", "jobs"];

const STORY_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    product: {
      type: "object",
      properties: Object.fromEntries(PARTS.map((p) => [p, { type: "string" }])),
    },
    stops: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          explain: { type: "string" },
          look: { type: "string" },
          tone: { enum: ["good", "bad", "ask", "flat"] },
          classes: { type: "array", items: { type: "string" } },
        },
        required: ["title", "explain", "look", "tone", "classes"],
      },
    },
  },
  required: ["summary", "product", "stops"],
};

/** With a plan check, the story also names the surprises' topics. */
const SURPRISES_SCHEMA = {
  type: "object",
  properties: {
    lead: { type: "string" },
    themes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          kind: { enum: ["new", "more"] },
          items: { type: "array", items: { type: "integer" } },
        },
        required: ["title", "summary", "kind", "items"],
      },
    },
  },
  required: ["lead", "themes"],
};
const schemaFor = (c: Comparison) =>
  c.planCheck?.themes.length
    ? { ...STORY_SCHEMA, properties: { ...STORY_SCHEMA.properties, surprises: SURPRISES_SCHEMA }, required: [...STORY_SCHEMA.required, "surprises"] }
    : STORY_SCHEMA;

/**
 * Keeps Claude's topics honest: each surprise in exactly one topic, in the
 * order Claude gave, and anything it left out in "Everything else".
 */
export function checkThemes(c: Comparison, out: { lead?: string; themes?: PlanTheme[] } | undefined): Story["surprises"] | undefined {
  const items = c.planCheck?.items ?? [];
  if (!out?.lead || !out.themes?.length) return undefined;
  const open = new Set(items.map((i, n) => (i.status === "surprise" ? n : -1)).filter((n) => n >= 0));
  const themes: PlanTheme[] = [];
  for (const t of out.themes) {
    const mine = (t.items ?? []).filter((n) => open.delete(n));
    if (mine.length && t.title?.trim()) themes.push({ title: t.title.trim(), summary: t.summary?.trim() || undefined, kind: t.kind === "new" ? "new" : "more", items: mine });
  }
  if (!themes.length) return undefined;
  if (open.size) {
    const rest = themes.find((t) => t.title === "Everything else");
    if (rest) rest.items.push(...open);
    else themes.push({ title: "Everything else", kind: "more", items: [...open] });
  }
  return { lead: out.lead.trim(), themes };
}

/** Classes linked to `name` by a dependency the change added or removed, most relevant first. */
function movedNeighbours(c: Comparison, name: string): string[] {
  const out: string[] = [];
  for (const e of c.edges) {
    if (e.status === "unchanged" || e.from === e.to) continue;
    if (e.from === name) out.push(e.to);
    else if (e.to === name) out.push(e.from);
  }
  return [...new Set(out)];
}

function callersOf(c: Comparison, name: string): string[] {
  return [...new Set(c.edges.filter((e) => e.to === name && e.kind !== "inherits" && e.from !== name).map((e) => e.from))];
}

function pick(c: Comparison, names: string[]): string[] {
  const known = new Set(c.classes.map((k) => k.name));
  return [...new Set(names)].filter((n) => known.has(n)).slice(0, MAX_CLASSES);
}

function stopFor(c: Comparison, d: Delta): StoryStop | null {
  const name = d.target?.kind === "class" ? d.target.name : null;
  if (!name) return null;
  const base = { id: d.id, tone: d.tone };
  if (d.id.startsWith("fanin-down-") || d.id.startsWith("fanin-up-")) {
    const fewer = d.id.startsWith("fanin-down-");
    return {
      ...base,
      title: fewer ? `Fewer classes reach ${short(name)} directly` : `More classes now reach ${short(name)}`,
      explain: `Before, ${d.before} classes used ${name} directly. Now ${d.after} do. ${d.why}`,
      look: fewer
        ? `Follow the arrows into ${short(name)}: the dashed red ones are calls that went away.`
        : `Follow the arrows into ${short(name)}: the green ones are new.`,
      classes: pick(c, [name, ...callersOf(c, name)]),
    };
  }
  if (d.id.startsWith("size-")) {
    const smaller = Number(d.after) < Number(d.before ?? 0);
    return {
      ...base,
      title: `${short(name)} got ${smaller ? "smaller" : "bigger"}`,
      explain: `It went from ${d.before} to ${d.after} lines of code. ${d.why}`,
      look: `A box's height is its code. Compare ${short(name)}'s height before and after.`,
      classes: pick(c, [name, ...movedNeighbours(c, name)]),
    };
  }
  if (d.id === "new-classes") {
    const added = c.classes.filter((k) => k.status === "added").map((k) => k.name);
    return {
      ...base,
      title: added.length === 1 ? `A new class: ${short(added[0])}` : `${added.length} new classes`,
      explain: d.why,
      look: "New classes appear only on the after side. A narrow, tall box hides a lot of code behind a small interface.",
      classes: pick(c, [...added.slice(0, 3), ...added.flatMap((n) => movedNeighbours(c, n))]),
    };
  }
  if (d.id.startsWith("widened-")) {
    return {
      ...base,
      title: `${short(name)} offers more to its subclasses`,
      explain: `Its public interface went from ${d.before} to ${d.after} methods, and ${d.change.replace("inherited by", "")} classes inherit it. ${d.why}`,
      look: `A box's width is its public interface. ${short(name)} is wider after.`,
      classes: pick(c, [name, ...movedNeighbours(c, name)]),
    };
  }
  return null;
}

const short = (name: string) => name.split("::").pop() ?? name;

/** A tour built from the measured deltas alone, so there is always something to show. */
export function measuredStory(c: Comparison): Story {
  const stops: StoryStop[] = [];
  const seen = new Set<string>();
  for (const d of c.deltas) {
    const s = stopFor(c, d);
    if (!s || s.classes.length === 0) continue;
    const key = [...s.classes].sort().join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    stops.push(s);
  }
  if (stops.length === 0) {
    const moved = c.classes
      .filter((k) => k.status !== "unchanged")
      .sort((a, b) => sizeOfChange(b) - sizeOfChange(a))
      .map((k) => k.name);
    if (moved.length) {
      stops.push({
        id: "changed",
        title: moved.length === 1 ? `${short(moved[0])} changed` : `${moved.length} classes changed`,
        explain: `${c.verdict.summary} None of the changes moved a measure enough to call it out on its own.`,
        look: "A box's width is its public interface and its height is its code.",
        tone: "flat",
        classes: pick(c, [...moved.slice(0, 3), ...movedNeighbours(c, moved[0])]),
      });
    }
  }
  return { base: c.base.sha, head: c.head.sha, source: "measured", status: "done", summary: c.verdict.summary, stops: stops.slice(0, 5) };
}

function sizeOfChange(k: ClassChange): number {
  return Math.abs((k.shape.after?.codeLines ?? 0) - (k.shape.before?.codeLines ?? 0)) + k.methods.filter((m) => m.status !== "unchanged").length;
}

function storyPrompt(facts: object, diff: string, lensQuestions: string[]): string {
  return `You are writing the guided tour in Refract, a tool that shows a developer how a code change reshaped their codebase, often a change an AI agent made. The developer is busy and visual. They have not read the diff. Your job is to tell them what this change did to the structure of the code, in plain words, as a short tour.

Write:
- summary: one plain sentence saying what the change does for the people who use the product, the way a colleague would say it out loud. No numbers unless one is the point.
- product: the page opens with what changed in the product, read from the code: new tables and columns (data), new screens and actions (screens), permission rules (permissions), the states a record moves through (lifecycles), and background jobs and emails (jobs); see "product" in the measurements. For each part that has something in it, write one plain sentence saying what it means for the product, like "Timesheets can now carry fees and expenses, each its own row in timesheet_charges." Leave a part out when the measurements have nothing for it. Data migrations that only move data (like granting a new permission to existing roles) belong in data or permissions.
- stops: 3 to 5 stops about the code's structure, most important first; the product section already covers what the change does, so these say how the code was shaped to do it. Each stop is one part of the story, and the stops must not overlap: a class can be the main class of only one stop. When a new or changed class has both an upside and an open question (say, it pulls logic into one place but may now do two jobs), tell both in that class's one stop rather than splitting them into two. Each stop is one part of the story:
  - title: a short headline in plain words (under 60 characters), like "Invitation sending moved into one service".
  - explain: two or three short sentences. What was true before, what is true now, and why a reader should care. Use the measurements; quote a number only when it helps.
  - look: one sentence telling the reader what to look at in the drawing. The drawing shows the classes as boxes before and after side by side. A box's width is its public interface; its height is its code. Arrows are dependencies: green arrows are new, dashed red arrows were removed, grey arrows did not change. Boxes that are new appear only on the after side.
  - tone: good (structure got better), bad (got worse), ask (a real question), flat (neutral context).
  - classes: 2 to 6 class names that the stop is about, copied exactly from the measurements, the main one first. Pick the classes whose boxes and arrows tell this stop's story; leave out bystanders.

Thresholds in the measurements (like 300 lines) are Refract's own rules of thumb, not limits from a book; do not call them limits. Avoid jargon the reader must decode: say "classes that call it" rather than "fan-in". No em dashes, no hedging filler, no headings or markdown. The page calls each stop a "key change"; never write the word "stop" in the text.

<measurements>
${JSON.stringify(facts, null, 1)}
</measurements>

<lens_questions>
${lensQuestions.join("\n") || "(none yet)"}
</lens_questions>

<diff>
${diff}
</diff>`;
}

function surprisesPrompt(c: Comparison): string {
  const check = c.planCheck;
  if (!check?.themes.length) return "";
  const lines = check.items.map((i, n) => (i.status === "surprise" ? `${n}. [${i.section}] ${i.text}` : null)).filter(Boolean);
  const measured = check.themes.map((t) => `${t.title}: ${t.items.join(", ")}`);
  return `

This branch was built against a plan, "${c.plan?.title ?? ""}"${c.plan?.why ? ` (${c.plan.why})` : ""}. Refract found ${lines.length} things the branch built that the plan never mentions, listed below by number. That many lines is too much to read, so also write:
- surprises.lead: one or two plain sentences a product person would say out loud about what the branch did beyond the plan, naming the new things. No counts of lines.
- surprises.themes: 3 to 6 topics, most important first, that together hold every number below exactly once. Group by what the work is for in the product (like "Sending a timesheet back" or "Invoice layouts"), not by kind of code: a new table, its screen, its permission rule and its service belong in one topic. Each topic has:
  - title: two to five plain words.
  - summary: one plain sentence on what it lets people do, or what it changes for them.
  - kind: "new" when the plan never mentions this at all, "more" when it is more than the plan said about something the plan does cover.
  - items: the numbers of the lines it holds.
  Put small code details that belong to no product topic (new helper methods, changed parameters) in a last topic titled "Everything else".

Refract's own grouping by shared names, for reference (it can be wrong): ${measured.join("; ")}

<surprises>
${lines.join("\n")}
</surprises>`;
}

async function cachePath(ws: Workspace, c: Comparison): Promise<string> {
  const dir = path.join(await ws.git.gitDir(), "refract", "stories");
  await fs.mkdir(dir, { recursive: true });
  // A plan check's topics depend on the plan too, so each version of the plan gets its own story.
  return path.join(dir, `${c.base.sha}-${c.head.sha}${c.plan?.mode === "check" ? `-${c.plan.hash.slice(0, 12)}` : ""}.json`);
}

/** Bumped when the story's shape or prompt changes, so older cached stories are written again. */
const STORY_VERSION = 3;

export async function cachedStory(ws: Workspace, c: Comparison): Promise<Story | null> {
  try {
    const story = JSON.parse(await fs.readFile(await cachePath(ws, c), "utf8")) as Story & { version?: number };
    return story.version === STORY_VERSION ? story : null;
  } catch {
    return null;
  }
}

/** Asks Claude Code to tell the change as a tour. Falls back to the measured tour on failure. */
export async function writeStory(ws: Workspace, c: Comparison, lensQuestions: string[] = []): Promise<Story> {
  const measured = measuredStory(c);
  try {
    const out = await askClaude<{ summary: string; product?: Story["product"]; stops: Omit<StoryStop, "id">[]; surprises?: { lead: string; themes: PlanTheme[] } }>(
      storyPrompt(factsFor(c), await diffFor(ws, c, 60_000), lensQuestions) + surprisesPrompt(c),
      schemaFor(c),
      { cwd: ws.git.root },
    );
    const stops = (out.stops ?? [])
      .map((s, i): StoryStop => ({ ...s, id: `s${i}`, tone: (["good", "bad", "ask", "flat"].includes(s.tone) ? s.tone : "flat") as Tone, classes: pick(c, resolve(c, s.classes ?? [])) }))
      .filter((s) => s.classes.length > 0);
    if (!stops.length || !out.summary) return { ...measured, error: "Claude Code returned no usable stops" };
    const product = Object.fromEntries(PARTS.filter((p) => out.product?.[p]?.trim()).map((p) => [p, out.product![p]!.trim()]));
    const surprises = checkThemes(c, out.surprises);
    const story: Story = { base: c.base.sha, head: c.head.sha, source: "claude", status: "done", summary: out.summary, product, stops, ...(surprises ? { surprises } : {}) };
    await fs.writeFile(await cachePath(ws, c), JSON.stringify({ ...story, version: STORY_VERSION }, null, 2));
    return story;
  } catch (e) {
    return { ...measured, error: (e as Error).message };
  }
}

/** Claude sometimes drops a namespace; match "Foo" to "Org::Foo" when that is unambiguous. */
function resolve(c: Comparison, names: string[]): string[] {
  const all = c.classes.map((k) => k.name);
  return names.map((n) => {
    if (all.includes(n)) return n;
    const hits = all.filter((a) => a.endsWith(`::${n}`));
    return hits.length === 1 ? hits[0] : n;
  });
}
