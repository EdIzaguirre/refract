import type { PlanSide } from "./types.js";

/**
 * The public methods every plan adds alike, so a comparison can list them once
 * and each plan's own beneath them, as it does with shared dependencies.
 */

type SurfaceClass = PlanSide["surface"]["classes"][number];

/** A public method a plan adds, as "Class#signature", so the same one in two plans is one key. */
export const methodKey = (cls: string, signature: string) => `${cls}#${signature}`;

/** The public methods every plan adds: the page lists these once instead of in each plan. */
export function sharedMethods(sides: PlanSide[]): Set<string> {
  if (sides.length < 2) return new Set();
  const [first, ...rest] = sides.map((s) => new Set(s.surface.classes.flatMap((k) => k.methods.map((m) => methodKey(k.name, m)))));
  return new Set([...first].filter((k) => rest.every((r) => r.has(k))));
}

/** The side's classes with only the methods `keep` picks; a class left with none drops out. */
export function surfaceClasses(side: PlanSide, keep: (key: string) => boolean): Omit<SurfaceClass, "params">[] {
  return side.surface.classes
    .map(({ params: _, ...k }) => ({ ...k, methods: k.methods.filter((m) => keep(methodKey(k.name, m))) }))
    .filter((k) => k.methods.length);
}
