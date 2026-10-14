import type { PlanItem, PlanTheme } from "./types.js";

/**
 * Plain words for the plan check's surprises, shared by the page and the
 * command line so both say the same thing.
 */

const andList = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const count = (n: number, one: string, many = /(s|x|ch|sh)$/.test(one) ? `${one}es` : `${one}s`) => (n === 1 ? `${/^[aeiou]/.test(one) ? "an" : "a"} ${one}` : `${n} ${many}`);

const NOUNS: [string, (i: PlanItem) => boolean][] = [
  ["new table", (i) => i.section === "tables" && i.text.startsWith("A new ")],
  ["column change", (i) => i.section === "tables" && !i.text.startsWith("A new ")],
  ["new screen", (i) => i.section === "screens" && i.text.startsWith("A new ")],
  ["screen change", (i) => i.section === "screens" && !i.text.startsWith("A new ")],
  ["lifecycle change", (i) => i.section === "lifecycles"],
  ["permission change", (i) => i.section === "permissions"],
  ["job", (i) => i.section === "jobs"],
  ["new class", (i) => i.section === "classes" && i.text.startsWith("A new ")],
  ["code change", (i) => i.section === "classes" && !i.text.startsWith("A new ")],
];

/** What a topic holds, like "a new table, a new screen and 2 new classes". */
export function themeCounts(theme: PlanTheme, items: PlanItem[]): string {
  const list = theme.items.map((n) => items[n]).filter(Boolean);
  const parts = NOUNS.map(([noun, is]) => [noun, list.filter(is).length] as const)
    .filter(([, n]) => n > 0)
    .map(([noun, n]) => count(n, noun));
  return andList(parts);
}

/** The sentence that leads the surprises: the new things by name, then what grew past the plan. */
export function surpriseLead(themes: PlanTheme[]): string {
  if (!themes.length) return "";
  const named = themes.filter((t) => t.kind === "new").map((t) => t.title.toLowerCase());
  const more = themes.filter((t) => t.kind === "more" && t.title !== "Everything else").map((t) => t.title.toLowerCase());
  const rest = themes.find((t) => t.title === "Everything else");
  const out: string[] = [];
  if (named.length) out.push(`The branch built ${named.length === 1 ? "one thing" : `${named.length} things`} the plan never mentions: ${andList(named)}.`);
  if (more.length) out.push(`${named.length ? "It also did" : "The branch did"} more than the plan said around ${andList(more)}${rest ? `, plus ${count(rest.items.length, "smaller change")}` : ""}.`);
  else if (rest) out.push(`${named.length ? "Plus" : "The branch also made"} ${count(rest.items.length, "smaller change")}.`);
  return out.join(" ");
}
