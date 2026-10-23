import type { Holding } from "../../src/shared/types";

/**
 * UML's "has" notation, as Metz draws it in POODR ch 8: a black diamond where the whole holds
 * its parts (composition: they go when it goes), and how many it holds at the far end.
 */

type Pt = { x: number; y: number };

/** Where the multiplicity sits: a little back from the arrowhead and off to its side, so it clears the box. */
export function nearEnd(pts: Pt[]): Pt | undefined {
  if (pts.length < 2) return undefined;
  const p = pts[pts.length - 1];
  const q = pts[pts.length - 2];
  const len = Math.hypot(p.x - q.x, p.y - q.y) || 1;
  const ux = (p.x - q.x) / len;
  const uy = (p.y - q.y) / len;
  return { x: p.x - ux * 18 - uy * 9, y: p.y - uy * 18 + ux * 9 };
}

/** A diamond marker for the start of a line, in the line's own colour class. */
export function DiamondMarker({ id, className }: { id: string; className: string }) {
  return (
    <marker id={id} viewBox="0 0 14 8" refX="0" refY="4" markerWidth="9" markerHeight="5" orient="auto">
      <path d="M0 4L7 0L14 4L7 8z" className={className} />
    </marker>
  );
}

export function Multiplicity({ at, has, className = "" }: { at?: Pt; has?: Holding; className?: string }) {
  if (!at || !has) return null;
  return (
    <text x={at.x} y={at.y} className={`fig-many ${className}`} textAnchor="middle" dominantBaseline="middle">
      {has.many}
    </text>
  );
}

/** The relationship for lists: "owns *" for composition, else the dependency kind with how many: "association 1". */
export function holdingWords(has: Holding | undefined, kind: string): string | undefined {
  if (!has) return undefined;
  return has.owns ? `owns ${has.many}` : `${kind} ${has.many}`;
}
