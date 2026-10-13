import fs from "node:fs/promises";
import path from "node:path";
import type { ClassChange, Comparison, Delta, Story, StoryStop, Tone } from "../shared/types.js";
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

const STORY_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
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
  required: ["summary", "stops"],
};

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
- summary: one plain sentence saying what the change does, the way a colleague would say it out loud. Name the main classes. No numbers unless one is the point.
- stops: 3 to 5 stops, most important first. Each stop is one part of the story:
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

async function cachePath(ws: Workspace, c: Comparison): Promise<string> {
  const dir = path.join(await ws.git.gitDir(), "refract", "stories");
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, `${c.base.sha}-${c.head.sha}.json`);
}

export async function cachedStory(ws: Workspace, c: Comparison): Promise<Story | null> {
  try {
    return JSON.parse(await fs.readFile(await cachePath(ws, c), "utf8")) as Story;
  } catch {
    return null;
  }
}

/** Asks Claude Code to tell the change as a tour. Falls back to the measured tour on failure. */
export async function writeStory(ws: Workspace, c: Comparison, lensQuestions: string[] = []): Promise<Story> {
  const measured = measuredStory(c);
  try {
    const out = await askClaude<{ summary: string; stops: Omit<StoryStop, "id">[] }>(
      storyPrompt(factsFor(c), await diffFor(ws, c, 60_000), lensQuestions),
      STORY_SCHEMA,
      { cwd: ws.git.root },
    );
    const stops = (out.stops ?? [])
      .map((s, i): StoryStop => ({ ...s, id: `s${i}`, tone: (["good", "bad", "ask", "flat"].includes(s.tone) ? s.tone : "flat") as Tone, classes: pick(c, resolve(c, s.classes ?? [])) }))
      .filter((s) => s.classes.length > 0);
    if (!stops.length || !out.summary) return { ...measured, error: "Claude Code returned no usable stops" };
    const story: Story = { base: c.base.sha, head: c.head.sha, source: "claude", status: "done", summary: out.summary, stops };
    await fs.writeFile(await cachePath(ws, c), JSON.stringify(story, null, 2));
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
