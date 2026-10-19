import type { EdgeChange, PlanSide } from "./types.js";

/**
 * The new dependencies each plan adds, and those every plan adds alike, so a
 * comparison can draw the shared ones once and each plan's own beneath them.
 */

/** A dependency a plan adds, as "From → To", so the same one in two plans is one key. */
export const dependencyKey = (e: { from: string; to: string }) => `${e.from} → ${e.to}`;
const isNew = (e: EdgeChange) => !!e.planned && e.from !== e.to && e.after > 0;

/** The new dependencies a plan adds, leaving out those in `skip`. */
export function newDependencies(side: PlanSide, skip: Set<string> = new Set()): EdgeChange[] {
  return side.drawing.edges.filter((e) => isNew(e) && !skip.has(dependencyKey(e)));
}

/** The new dependencies every plan adds: the page draws these once instead of in each plan. */
export function sharedDependencies(sides: PlanSide[]): Set<string> {
  if (sides.length < 2) return new Set();
  const [first, ...rest] = sides.map((s) => new Set(newDependencies(s).map(dependencyKey)));
  return new Set([...first].filter((k) => rest.every((r) => r.has(k))));
}
