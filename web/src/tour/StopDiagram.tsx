import { useEffect, useState } from "react";
import ELK, { type ElkExtendedEdge } from "elkjs/lib/elk.bundled.js";
import type { ClassChange, Comparison, EdgeChange, Shape } from "../../../src/shared/types";
import { boxDims, splinePath } from "../map/layout";

/**
 * A stop's drawing: only the stop's classes, before and after side by side,
 * in the same positions on both sides so the eye can compare them.
 */

const SCALE = 0.95;

/** The map's box, with very large classes squeezed a little harder so a stop fits on screen. */
function dims(shape: Shape | null): { w: number; h: number } | null {
  const d = boxDims(shape, SCALE);
  if (!d || !shape) return d;
  const l = shape.codeLines;
  const h = 10 + (l <= 200 ? l * 0.25 : 60 + 30 * Math.log2(l / 200));
  return { w: d.w, h: h * SCALE };
}
const LABEL_TOP = 30;
const LABEL_BOTTOM = 22;
const PAD = 24;

interface Placed {
  change: ClassChange;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Routed {
  edge: EdgeChange;
  path: string;
}

interface Drawing {
  width: number;
  height: number;
  nodes: Placed[];
  edges: Routed[];
}

const elk = new ELK();

async function layout(c: Comparison, names: string[]): Promise<Drawing> {
  const classes = names.map((n) => c.classes.find((k) => k.name === n)).filter((k): k is ClassChange => !!k);
  const set = new Set(classes.map((k) => k.name));
  const edges = c.edges.filter((e) => set.has(e.from) && set.has(e.to) && e.from !== e.to);
  const size = (k: ClassChange) => {
    const b = dims(k.shape.before);
    const a = dims(k.shape.after);
    const label = Math.max(shortName(k.name).length * 8, 90);
    return { w: Math.max(b?.w ?? 0, a?.w ?? 0, label), h: Math.max(b?.h ?? 0, a?.h ?? 0) + LABEL_TOP + LABEL_BOTTOM };
  };
  const graph = await elk.layout({
    id: "stop",
    layoutOptions: {
      "elk.algorithm": "layered",
      // Left to right: a hub and the classes that call it stack in columns, which fits a half-width pane.
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "22",
      "elk.layered.spacing.nodeNodeBetweenLayers": "70",
      "elk.edgeRouting": "SPLINES",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.aspectRatio": "0.8",
    },
    children: classes.map((k) => ({ id: k.name, width: size(k).w, height: size(k).h })),
    edges: edges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to], e }) as ElkExtendedEdge & { e: EdgeChange }),
  });
  const nodes = (graph.children ?? []).map((n) => ({
    change: classes.find((k) => k.name === n.id)!,
    x: n.x! + PAD,
    y: n.y! + PAD,
    w: n.width!,
    h: n.height!,
  }));
  const routed = ((graph.edges ?? []) as (ElkExtendedEdge & { e: EdgeChange })[]).flatMap((ge) => {
    const s = ge.sections?.[0];
    if (!s) return [];
    return [{ edge: ge.e, path: splinePath([s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({ x: p.x + PAD, y: p.y + PAD }))) }];
  });
  return { width: (graph.width ?? 0) + PAD * 2, height: (graph.height ?? 0) + PAD * 2, nodes, edges: routed };
}

export const shortName = (name: string) => name.split("::").pop() ?? name;
const ns = (name: string) => name.split("::").slice(0, -1).join("::");

export function StopDiagram({ comparison, classes, onOpen }: { comparison: Comparison; classes: string[]; onOpen(name: string): void }) {
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  useEffect(() => {
    let stale = false;
    layout(comparison, classes).then((d) => !stale && setDrawing(d));
    return () => {
      stale = true;
    };
  }, [comparison, classes.join(",")]);

  if (!drawing) return <div className="figure-loading">Drawing…</div>;
  return (
    <div className="figure">
      {(["before", "after"] as const).map((side) => (
        <div key={side} className={`pane ${side}`}>
          <div className="pane-tag">{side}</div>
          {drawing.nodes.every((n) => !n.change.shape[side]) && (
            <div className="pane-note">{side === "before" ? "None of these classes existed yet." : "All of these classes were removed."}</div>
          )}
          <Pane drawing={drawing} side={side} onOpen={onOpen} />
        </div>
      ))}
    </div>
  );
}

function Pane({ drawing, side, onOpen }: { drawing: Drawing; side: "before" | "after"; onOpen(name: string): void }) {
  const id = `fig-${side}`;
  return (
    <svg viewBox={`0 0 ${drawing.width} ${drawing.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`The classes ${side} the change`}>
      <defs>
        {(["new", "gone", "same"] as const).map((k) => (
          <marker key={k} id={`${id}-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 1L10 5L0 9z" className={`fig-mk ${k}`} />
          </marker>
        ))}
      </defs>
      {drawing.edges.map((r, i) => {
        const present = side === "before" ? r.edge.before > 0 : r.edge.after > 0;
        if (!present) return null;
        const kind = side === "before" ? (r.edge.after === 0 ? "gone" : "same") : r.edge.before === 0 ? "new" : "same";
        return <path key={i} d={r.path} className={`fig-edge ${kind}`} markerEnd={`url(#${id}-${kind})`} />;
      })}
      {drawing.nodes.map((n) => (
        <Box key={n.change.name} node={n} side={side} onOpen={onOpen} />
      ))}
    </svg>
  );
}

function Box({ node, side, onOpen }: { node: Placed; side: "before" | "after"; onOpen(name: string): void }) {
  const k = node.change;
  const shape = k.shape[side];
  const other = k.shape[side === "before" ? "after" : "before"];
  const cx = node.x + node.w / 2;
  if (!shape) {
    // Not there on this side: a faint placeholder keeps the two sides aligned.
    const d = dims(other)!;
    return (
      <g className="fig-absent">
        <rect x={cx - d.w / 2} y={node.y + LABEL_TOP} width={d.w} height={d.h} rx={4} />
        <text x={cx} y={node.y + LABEL_TOP + d.h / 2 + 4} textAnchor="middle">
          {side === "before" ? "not yet" : "removed"}
        </text>
      </g>
    );
  }
  const d = dims(shape)!;
  const state = side === "before" ? (k.status === "removed" ? "gone" : "plain") : k.status === "added" ? "new" : k.status === "changed" ? "changed" : "plain";
  const space = ns(k.name);
  return (
    <g className={`fig-box ${state}`} onClick={() => onOpen(k.name)}>
      <title>{`${k.name}: ${shape.interface} public methods, ${shape.codeLines} lines of code. Click to explore it.`}</title>
      {space && (
        <text className="fig-ns" x={cx} y={node.y + 10} textAnchor="middle">
          {space}::
        </text>
      )}
      <text className="fig-name" x={cx} y={node.y + LABEL_TOP - 8} textAnchor="middle">
        {shortName(k.name)}
      </text>
      <rect x={cx - d.w / 2} y={node.y + LABEL_TOP} width={d.w} height={d.h} rx={4} />
      <text className="fig-nums" x={cx} y={node.y + LABEL_TOP + d.h + 16} textAnchor="middle">
        {numbers(shape, side === "after" ? k.shape.before : null)}
      </text>
    </g>
  );
}

function numbers(s: Shape, before: Shape | null): string {
  const lines = `${s.codeLines} lines`;
  const pub = `${s.interface} public`;
  if (!before) return `${lines} · ${pub}`;
  const dl = s.codeLines - before.codeLines;
  const di = s.interface - before.interface;
  const sign = (n: number) => (n > 0 ? `+${n}` : `−${-n}`);
  return `${lines}${dl ? ` (${sign(dl)})` : ""} · ${pub}${di ? ` (${sign(di)})` : ""}`;
}
