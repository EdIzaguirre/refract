import ELK, { type ElkNode, type ElkExtendedEdge } from "elkjs/lib/elk.bundled.js";
import type { AreaChange, ClassChange, Comparison, EdgeChange, Shape } from "../../../src/shared/types";

/**
 * Turns a Comparison into map geometry. Every class is an Ousterhout box:
 * width is its public interface, height is the code behind it. Classes the
 * change touched, and their nearest neighbours, are laid out as a dependency
 * graph inside their area; every other class is packed below as a small
 * "city" so an area's size still shows how much code it holds.
 */

export interface Dims {
  w: number;
  h: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ClassNode {
  name: string;
  area: string;
  change: ClassChange;
  featured: boolean;
  /** The space reserved for the box: room for the larger of before and after. */
  slot: Rect;
  before: Dims | null;
  after: Dims | null;
}

export interface AreaNode extends Rect {
  id: string;
  change: AreaChange;
  changed: boolean;
  featuredCount: number;
  cityCount: number;
}

export interface EdgeRoute {
  key: string;
  from: string;
  to: string;
  edge: EdgeChange;
  path: string;
  cross: boolean;
}

export interface AreaLink {
  from: string;
  to: string;
  before: number;
  after: number;
  path: string;
  status: "added" | "removed" | "unchanged";
}

export interface MapLayout {
  width: number;
  height: number;
  areas: AreaNode[];
  classes: Map<string, ClassNode>;
  edges: EdgeRoute[];
  areaLinks: AreaLink[];
}

const LABEL = 30;
const AREA_HEAD = 54;
const AREA_PAD = 22;

export function boxDims(shape: Shape | null, scale = 1): Dims | null {
  if (!shape) return null;
  const i = shape.interface;
  const w = Math.min(260, 18 + 10 * Math.min(i, 20) + 2.5 * Math.max(0, i - 20));
  const l = shape.codeLines;
  const h = 10 + (l <= 400 ? l * 0.25 : 100 + 45 * Math.log2(l / 400));
  return { w: w * scale, h: h * scale };
}

function labelWidth(name: string): number {
  const parts = name.split("::");
  const last = parts.pop() ?? name;
  return Math.max(last.length * 6.6, parts.join("::").length * 5.4) + 8;
}

/** Classes worth drawing in full: what changed, plus a few of the classes each one talks to. */
function featuredSet(c: Comparison): Set<string> {
  const moved = new Set(c.classes.filter((k) => k.status !== "unchanged").map((k) => k.name));
  const byName = new Map(c.classes.map((k) => [k.name, k]));
  const featured = new Set(moved);
  const neighbours = new Map<string, EdgeChange[]>();
  for (const e of c.edges) {
    for (const [self, other] of [[e.from, e.to], [e.to, e.from]]) {
      if (moved.has(self) && !moved.has(other)) neighbours.set(self, [...(neighbours.get(self) ?? []), e]);
    }
  }
  const rank = (e: EdgeChange) => (e.status !== "unchanged" ? 0 : e.kind === "association" ? 1 : e.kind === "reference" ? 2 : 3);
  for (const [self, list] of neighbours) {
    let n = 0;
    for (const e of list.sort((a, b) => rank(a) - rank(b))) {
      const other = e.from === self ? e.to : e.from;
      const k = byName.get(other);
      // Base classes everyone inherits from would pull in the whole app.
      if (!k || (e.kind === "inherits" && e.status === "unchanged" && k.descendants > 25)) continue;
      if (e.status === "unchanged" && n >= 6) continue;
      featured.add(other);
      n++;
    }
  }
  return featured;
}

const elk = new ELK();

export async function layoutMap(c: Comparison): Promise<MapLayout> {
  const featured = featuredSet(c);
  const byArea = new Map<string, ClassChange[]>();
  for (const k of c.classes) byArea.set(k.area, [...(byArea.get(k.area) ?? []), k]);
  const areaChanges = new Map(c.areas.map((a) => [a.id, a]));

  const classes = new Map<string, ClassNode>();
  const edges: EdgeRoute[] = [];
  const blocks: { area: AreaChange; w: number; h: number; place: (x: number, y: number) => void; featuredCount: number; cityCount: number }[] = [];

  await Promise.all(
    [...byArea].map(async ([areaId, list]) => {
      const area = areaChanges.get(areaId) ?? {
        id: areaId,
        name: areaId,
        status: "unchanged" as const,
        before: { files: 0, codeLines: 0, classes: 0 },
        after: { files: 0, codeLines: 0, classes: 0 },
        changedFiles: 0,
        changedClasses: 0,
      };
      const feat = list.filter((k) => featured.has(k.name));
      const city = list.filter((k) => !featured.has(k.name)).sort((a, b) => (b.shape.after ?? b.shape.before)!.codeLines - (a.shape.after ?? a.shape.before)!.codeLines);

      // Featured classes: a layered dependency graph.
      const local: { name: string; x: number; y: number; w: number; h: number; before: Dims | null; after: Dims | null; change: ClassChange }[] = [];
      let featW = 0;
      let featH = 0;
      const localEdges: { e: EdgeChange; sections: { x: number; y: number }[] }[] = [];
      if (feat.length) {
        const names = new Set(feat.map((k) => k.name));
        const nodes: ElkNode[] = feat.map((k) => {
          const b = boxDims(k.shape.before);
          const a = boxDims(k.shape.after);
          const w = Math.max(b?.w ?? 0, a?.w ?? 0, labelWidth(k.name));
          const h = Math.max(b?.h ?? 0, a?.h ?? 0) + LABEL;
          return { id: k.name, width: w, height: h };
        });
        const graphEdges: ElkExtendedEdge[] = c.edges
          .filter((e) => names.has(e.from) && names.has(e.to) && e.from !== e.to)
          .map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to], e }) as ElkExtendedEdge & { e: EdgeChange });
        const graph = await elk.layout({
          id: areaId,
          layoutOptions: {
            "elk.algorithm": "layered",
            "elk.direction": "DOWN",
            "elk.spacing.nodeNode": "34",
            "elk.layered.spacing.nodeNodeBetweenLayers": "46",
            "elk.spacing.componentComponent": "40",
            "elk.edgeRouting": "SPLINES",
            "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
            "elk.aspectRatio": "1.6",
          },
          children: nodes,
          edges: graphEdges,
        });
        for (const n of graph.children ?? []) {
          const k = feat.find((x) => x.name === n.id)!;
          local.push({ name: k.name, x: n.x!, y: n.y!, w: n.width!, h: n.height!, before: boxDims(k.shape.before), after: boxDims(k.shape.after), change: k });
        }
        for (const ge of (graph.edges ?? []) as (ElkExtendedEdge & { e: EdgeChange })[]) {
          const s = ge.sections?.[0];
          if (!s) continue;
          localEdges.push({ e: ge.e, sections: [s.startPoint, ...(s.bendPoints ?? []), s.endPoint] });
        }
        featW = graph.width ?? 0;
        featH = graph.height ?? 0;
      }

      // Everything else: a packed city of small boxes, largest first.
      const scale = 0.42;
      const cityDims = city.map((k) => boxDims(k.shape.after ?? k.shape.before, scale)!);
      const total = cityDims.reduce((s, d) => s + (d.w + 6) * (d.h + 6), 0);
      const cityWidth = Math.max(featW, Math.sqrt(total) * 1.5, 160);
      const cityPlaced: { k: ClassChange; x: number; y: number; d: Dims }[] = [];
      let cx = 0;
      let cy = 0;
      let rowH = 0;
      cityDims.forEach((d, i) => {
        if (cx + d.w > cityWidth && cx > 0) {
          cx = 0;
          cy += rowH + 6;
          rowH = 0;
        }
        cityPlaced.push({ k: city[i], x: cx, y: cy, d });
        cx += d.w + 6;
        rowH = Math.max(rowH, d.h);
      });
      const cityH = cityPlaced.length ? cy + rowH : 0;
      const innerW = Math.max(featW, cityPlaced.length ? cityWidth : 0, 220);
      const gap = feat.length && cityPlaced.length ? 30 : 0;
      const w = innerW + AREA_PAD * 2;
      const h = AREA_HEAD + featH + gap + cityH + AREA_PAD;

      blocks.push({
        area,
        w,
        h,
        featuredCount: feat.length,
        cityCount: city.length,
        place: (ax, ay) => {
          const fx = ax + AREA_PAD + (innerW - featW) / 2;
          const fy = ay + AREA_HEAD;
          for (const n of local) {
            classes.set(n.name, {
              name: n.name,
              area: areaId,
              change: n.change,
              featured: true,
              slot: { x: fx + n.x, y: fy + n.y, w: n.w, h: n.h },
              before: n.before,
              after: n.after,
            });
          }
          for (const le of localEdges) {
            edges.push({
              key: `${le.e.from}>${le.e.to}`,
              from: le.e.from,
              to: le.e.to,
              edge: le.e,
              path: splinePath(le.sections.map((p) => ({ x: p.x + fx, y: p.y + fy }))),
              cross: false,
            });
          }
          const cyTop = fy + featH + gap;
          for (const p of cityPlaced) {
            const d = p.d;
            classes.set(p.k.name, {
              name: p.k.name,
              area: areaId,
              change: p.k,
              featured: false,
              slot: { x: ax + AREA_PAD + p.x, y: cyTop + p.y, w: d.w, h: d.h },
              before: p.k.shape.before ? boxDims(p.k.shape.before, scale) : null,
              after: p.k.shape.after ? boxDims(p.k.shape.after, scale) : null,
            });
          }
        },
      });
    }),
  );

  // Areas: shelf-packed tallest first, in rows about as wide as a screen is to its height.
  blocks.sort((a, b) => b.h - a.h || b.w - a.w);
  const GAP = 70;
  const totalArea = blocks.reduce((s, b) => s + (b.w + GAP) * (b.h + GAP), 0);
  const maxW = Math.max(Math.sqrt(totalArea * 1.7), ...blocks.map((b) => b.w));
  const areas: AreaNode[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  let width = 0;
  for (const b of blocks) {
    if (x + b.w > maxW && x > 0) {
      x = 0;
      y += rowH + GAP;
      rowH = 0;
    }
    b.place(x, y);
    areas.push({
      id: b.area.id,
      x,
      y,
      w: b.w,
      h: b.h,
      change: b.area,
      changed: b.area.status !== "unchanged",
      featuredCount: b.featuredCount,
      cityCount: b.cityCount,
    });
    x += b.w + GAP;
    width = Math.max(width, x - GAP);
    rowH = Math.max(rowH, b.h);
  }
  const height = y + rowH;

  // Dependencies that cross areas, between classes drawn in full.
  for (const e of c.edges) {
    const a = classes.get(e.from);
    const b = classes.get(e.to);
    if (!a || !b || !a.featured || !b.featured || a.area === b.area) continue;
    if (e.status === "unchanged" && e.kind === "inherits") continue;
    edges.push({ key: `${e.from}>${e.to}`, from: e.from, to: e.to, edge: e, path: curveBetween(a.slot, b.slot), cross: true });
  }

  const areaById = new Map(areas.map((a) => [a.id, a]));
  const areaLinks: AreaLink[] = c.areaEdges
    .filter((e) => areaById.has(e.from) && areaById.has(e.to))
    .map((e) => ({
      ...e,
      status: e.before === 0 ? "added" : e.after === 0 ? "removed" : "unchanged",
      path: curveBetween(areaById.get(e.from)!, areaById.get(e.to)!),
    }));

  return { width, height, areas, classes, edges, areaLinks };
}

function splinePath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  if (pts.length === 2) return `M${pts[0].x},${pts[0].y}L${pts[1].x},${pts[1].y}`;
  // ELK spline sections come as start, control points, end.
  let d = `M${pts[0].x},${pts[0].y}`;
  const rest = pts.slice(1);
  if (rest.length % 3 === 0) {
    for (let i = 0; i < rest.length; i += 3) d += `C${rest[i].x},${rest[i].y} ${rest[i + 1].x},${rest[i + 1].y} ${rest[i + 2].x},${rest[i + 2].y}`;
  } else {
    for (const p of rest) d += `L${p.x},${p.y}`;
  }
  return d;
}

/** A gentle curve from the edge of one box to the edge of another. */
export function curveBetween(a: Rect, b: Rect): string {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const p1 = clip(a, ac, bc);
  const p2 = clip(b, bc, ac);
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const bend = 0.18;
  return `M${p1.x},${p1.y}Q${mx - dy * bend},${my + dx * bend} ${p2.x},${p2.y}`;
}

function clip(r: Rect, from: { x: number; y: number }, to: { x: number; y: number }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return from;
  const sx = dx !== 0 ? r.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? r.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: from.x + dx * s, y: from.y + dy * s };
}
