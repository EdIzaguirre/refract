import type { Comparison, EdgeChange, PlanSide } from "./types.js";

/**
 * The new dependencies each plan adds, and every plan's drawn together in one
 * layout with which plans have each class and arrow.
 */

/** A dependency a plan adds, as "From → To", so the same one in two plans is one key. */
export const dependencyKey = (e: { from: string; to: string }) => `${e.from} → ${e.to}`;
const isNew = (e: EdgeChange) => !!e.planned && e.from !== e.to && e.after > 0;

/** The new dependencies a plan adds. */
export function newDependencies(side: PlanSide): EdgeChange[] {
  return side.drawing.edges.filter(isNew);
}

/**
 * Every plan's classes and arrows in one drawing, with which plans have each. An arrow is a plan's when
 * it is new in that plan (or, with `today`, there at all in its drawing); a class is a plan's when one of its arrows touches it.
 */
export function drawTogether(sides: PlanSide[], today: boolean) {
  const members: Record<string, string[]> = {};
  const edgeMembers: Record<string, string[]> = {};
  const classes = new Map<string, Comparison["classes"][number]>();
  const edges = new Map<string, Comparison["edges"][number]>();
  for (const s of sides) {
    const own = today ? s.drawing.edges.filter((e) => e.after > 0 && e.from !== e.to) : newDependencies(s);
    const linked = new Set(own.flatMap((e) => [e.from, e.to]));
    for (const e of own) {
      const key = dependencyKey(e);
      if (!edges.has(key)) edges.set(key, e);
      (edgeMembers[key] ??= []).push(s.label);
    }
    for (const k of s.drawing.classes) {
      if (!linked.has(k.name)) continue;
      // A class a plan adds or reshapes is drawn as that plan has it, over one it only points at.
      if (!classes.has(k.name) || (k.planned && !classes.get(k.name)!.planned)) classes.set(k.name, k);
      (members[k.name] ??= []).push(s.label);
    }
  }
  const drawing: Comparison = { ...sides[0].drawing, classes: [...classes.values()], edges: [...edges.values()] };
  return { drawing, classes: [...classes.keys()], members, edgeMembers };
}
