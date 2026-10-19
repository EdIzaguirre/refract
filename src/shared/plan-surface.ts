import type { PlanSide, Role } from "./types.js";

/**
 * What every plan adds to the code's interface alike, so a comparison can list
 * it once and each plan's own beneath, as it does with shared dependencies; and
 * the Rails layers the list is grouped by.
 */

type SurfaceClass = PlanSide["surface"]["classes"][number];
export type SurfaceItem = Omit<SurfaceClass, "params">;

/** One thing a plan adds, "Class#signature" or "Class#belongs_to :home", so the same one in two plans is one key. */
export const surfaceKey = (cls: string, item: string) => `${cls}#${item}`;
/** A new class itself, so a new model with no methods still pairs up across plans. */
const classKey = (cls: string) => `${cls}#`;

const keysOf = (k: SurfaceClass) => [...(k.isNew ? [classKey(k.name)] : []), ...[...k.methods, ...k.associations].map((m) => surfaceKey(k.name, m))];

/** What every plan adds: the page lists these once instead of in each plan. */
export function sharedSurface(sides: PlanSide[]): Set<string> {
  if (sides.length < 2) return new Set();
  const [first, ...rest] = sides.map((s) => new Set(s.surface.classes.flatMap(keysOf)));
  return new Set([...first].filter((k) => rest.every((r) => r.has(k))));
}

/** The side's classes with only what `keep` picks; a class left with nothing drops out, unless it is new and kept itself. */
export function surfaceClasses(side: PlanSide, keep: (key: string) => boolean): SurfaceItem[] {
  return side.surface.classes
    .map(({ params: _, ...k }) => ({
      ...k,
      methods: k.methods.filter((m) => keep(surfaceKey(k.name, m))),
      associations: k.associations.filter((a) => keep(surfaceKey(k.name, a))),
    }))
    .filter((k) => k.methods.length || k.associations.length || (k.isNew && keep(classKey(k.name))));
}

/** The public methods among `classes`, counted. */
export const methodCount = (classes: SurfaceItem[]) => classes.reduce((n, k) => n + k.methods.length, 0);

/** Models hold persistence and services the logic, so the list reads by layer; everything else is "other classes". */
export const SURFACE_LAYERS: { title: string; roles: Role[] | null }[] = [
  { title: "Models", roles: ["model"] },
  { title: "Services", roles: ["service"] },
  { title: "Other classes", roles: null },
];

/** `classes` by layer, new classes first in each, empty layers left out. */
export function byLayer(classes: SurfaceItem[]): { title: string; classes: SurfaceItem[] }[] {
  const named = SURFACE_LAYERS.flatMap((l) => l.roles ?? []);
  return SURFACE_LAYERS.map((l) => ({
    title: l.title,
    classes: classes
      .filter((k) => (l.roles ? l.roles.includes(k.role) : !named.includes(k.role)))
      .sort((x, y) => Number(y.isNew) - Number(x.isNew)),
  })).filter((l) => l.classes.length);
}
