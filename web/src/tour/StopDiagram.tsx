import { useEffect, useState } from "react";
import ELK, { type ElkExtendedEdge } from "elkjs/lib/elk.bundled.js";
import type { ClassChange, Comparison, EdgeChange, Role, Shape } from "../../../src/shared/types";
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
/** Room above the first band for its heading. */
const HEAD = 26;

/**
 * Rails layers, top to bottom: what handles a request, what it renders, what
 * does the work, what holds the data. Each is a band, so where a box sits says what kind of
 * class it is, and an arrow pointing up (a model reaching into a service) stands out.
 * A concern sits with services: it is mixed into a class, not a table.
 */
const LAYERS: { title: string; roles: Role[] }[] = [
  { title: "Controllers", roles: ["controller"] },
  // Helpers and view components serve what a controller renders, so they sit just below it.
  { title: "Views", roles: ["component", "helper"] },
  { title: "Services and jobs", roles: ["service", "job", "mailer", "policy", "lib", "concern", "other"] },
  { title: "Models", roles: ["model"] },
];
const layerOf = (r: Role) => Math.max(0, LAYERS.findIndex((l) => l.roles.includes(r)));

export const ROLE_WORD: Record<Role, string> = {
  model: "model",
  controller: "controller",
  service: "service",
  job: "job",
  mailer: "mailer",
  helper: "helper",
  concern: "concern",
  policy: "policy",
  component: "component",
  lib: "library",
  other: "class",
};

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
  /** A band for each Rails layer the drawing uses, from its top to its bottom. */
  layers: { title: string; y0: number; y1: number }[];
}

const elk = new ELK();

/** Room under a box for its row of plan chips. */
const CHIPS = 18;

/**
 * Several plans drawn as one: which plans have each class and each arrow (by "From → To"), and the
 * plan in focus, if any. Everything not in the focused plan fades; nothing moves, so the shared
 * layout makes what differs between plans the only thing that changes.
 */
export interface PlanMembers {
  classes: Record<string, string[]>;
  edges: Record<string, string[]>;
  focus: string | null;
}

async function layout(c: Comparison, names: string[], chips = false): Promise<Drawing> {
  const classes = names.map((n) => c.classes.find((k) => k.name === n)).filter((k): k is ClassChange => !!k);
  const set = new Set(classes.map((k) => k.name));
  const edges = c.edges.filter((e) => set.has(e.from) && set.has(e.to) && e.from !== e.to);
  const size = (k: ClassChange) => {
    const b = dims(k.shape.before);
    const a = dims(k.shape.after);
    // Room for the name and for the "service · 113 lines (+76) · 7 public" line under the box.
    const nums = Math.max(
      k.shape.before ? `${ROLE_WORD[k.role]} · ${numbers(k.shape.before, null)}`.length : 0,
      k.shape.after ? `${ROLE_WORD[k.role]} · ${numbers(k.shape.after, k.shape.before, k.sizeUnknown)}`.length : 0,
    );
    // Several plans in one drawing show only the role pill under a box (the numbers move to its tooltip), so it stays narrow.
    const label = chips ? Math.max(shortName(k.name).length * 8, ROLE_WORD[k.role].length * 6.3 + 20, 70) : Math.max(shortName(k.name).length * 8, nums * 6.4 + 8, 90);
    return { w: Math.max(b?.w ?? 0, a?.w ?? 0, label), h: Math.max(b?.h ?? 0, a?.h ?? 0) + LABEL_TOP + LABEL_BOTTOM + (chips ? CHIPS : 0) };
  };
  const graph = await elk.layout({
    id: "stop",
    layoutOptions: {
      "elk.algorithm": "layered",
      // Top to bottom, a band per Rails layer: requests come in at the top and data sits at the bottom.
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "28",
      "elk.layered.spacing.nodeNodeBetweenLayers": "56",
      "elk.edgeRouting": "SPLINES",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      // Many plans in one drawing get tall and narrow, so the page can show it near full size and scroll.
      "elk.aspectRatio": chips ? "1.4" : "2.4",
      "elk.partitioning.activate": "true",
      // One layout for every cluster of classes, so the bands line up across all of them.
      "elk.separateConnectedComponents": "false",
    },
    children: classes.map((k) => ({
      id: k.name,
      width: size(k).w,
      height: size(k).h,
      layoutOptions: { "elk.partitioning.partition": String(layerOf(k.role)) },
    })),
    edges: edges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to], e }) as ElkExtendedEdge & { e: EdgeChange }),
  });
  const nodes = (graph.children ?? []).map((n) => ({
    change: classes.find((k) => k.name === n.id)!,
    x: n.x! + PAD,
    y: n.y! + PAD + HEAD,
    w: n.width!,
    h: n.height!,
  }));
  const routed = ((graph.edges ?? []) as (ElkExtendedEdge & { e: EdgeChange })[]).flatMap((ge) => {
    const s = ge.sections?.[0];
    if (!s) return [];
    return [{ edge: ge.e, path: splinePath([s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({ x: p.x + PAD, y: p.y + PAD + HEAD }))) }];
  });
  const layers = LAYERS.flatMap((l, i) => {
    const inLayer = nodes.filter((n) => layerOf(n.change.role) === i);
    if (!inLayer.length) return [];
    return [{ title: l.title, y0: Math.min(...inLayer.map((n) => n.y)) - HEAD, y1: Math.max(...inLayer.map((n) => n.y + n.h)) + 6 }];
  });
  return { width: (graph.width ?? 0) + PAD * 2, height: (graph.height ?? 0) + PAD * 2 + HEAD, nodes, edges: routed, layers };
}

export const shortName = (name: string) => name.split("::").pop() ?? name;
const ns = (name: string) => name.split("::").slice(0, -1).join("::");

export function StopDiagram({
  comparison,
  classes,
  onOpen,
  only,
  plans,
}: {
  comparison: Comparison;
  classes: string[];
  onOpen(name: string): void;
  /** Draw one side alone, under this tag: a plan beside another plan has no "before" of its own. */
  only?: { side: "before" | "after"; tag: string };
  /** Several plans in one drawing: chips under each box, and the plan in focus. */
  plans?: PlanMembers;
}) {
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const chips = !!plans;
  useEffect(() => {
    let stale = false;
    layout(comparison, classes, chips).then((d) => !stale && setDrawing(d));
    return () => {
      stale = true;
    };
    // Focus is left out on purpose: switching plans must not move anything.
  }, [comparison, classes.join(","), chips]);

  if (!drawing) return <div className="figure-loading">Drawing…</div>;
  return (
    <div className={`figure ${only ? "one" : ""}`}>
      {(only ? [only.side] : (["before", "after"] as const)).map((side) => (
        <div key={side} className={`pane ${side}`}>
          <div className="pane-tag">{only?.tag ?? side}</div>
          {drawing.nodes.every((n) => !n.change.shape[side]) && (
            <div className="pane-note">{side === "before" ? "None of these classes existed yet." : "All of these classes were removed."}</div>
          )}
          <Pane drawing={drawing} side={side} onOpen={onOpen} plans={plans} />
        </div>
      ))}
    </div>
  );
}

let figures = 0;

function Pane({ drawing, side, onOpen, plans }: { drawing: Drawing; side: "before" | "after"; onOpen(name: string): void; plans?: PlanMembers }) {
  // Two drawings of the same side can share a page, so each needs its own arrowhead ids.
  const [id] = useState(() => `fig-${side}-${figures++}`);
  return (
    <svg viewBox={`0 0 ${drawing.width} ${drawing.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`The classes ${side} the change`}>
      <defs>
        {(["new", "gone", "same"] as const).map((k) => (
          <marker key={k} id={`${id}-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 1L10 5L0 9z" className={`fig-mk ${k}`} />
          </marker>
        ))}
      </defs>
      {drawing.layers.map((l) => (
        <g key={l.title}>
          <rect className="fig-band" x={4} y={l.y0} width={drawing.width - 8} height={l.y1 - l.y0} rx={8} />
          <text className="fig-layer" x={14} y={l.y0 + 16}>
            {l.title}
          </text>
        </g>
      ))}
      {drawing.edges.map((r, i) => {
        const present = side === "before" ? r.edge.before > 0 : r.edge.after > 0;
        if (!present) return null;
        const kind = side === "before" ? (r.edge.after === 0 ? "gone" : "same") : r.edge.before === 0 ? "new" : "same";
        const dim = !!plans?.focus && !(plans.edges[`${r.edge.from} → ${r.edge.to}`] ?? []).includes(plans.focus);
        return <path key={i} d={r.path} className={`fig-edge ${kind} ${side === "after" && r.edge.planned ? "planned" : ""} ${dim ? "dim" : ""}`} markerEnd={`url(#${id}-${kind})`} />;
      })}
      {drawing.nodes.map((n) => (
        <Box key={n.change.name} node={n} side={side} onOpen={onOpen} plans={plans} />
      ))}
    </svg>
  );
}

function Box({ node, side, onOpen, plans }: { node: Placed; side: "before" | "after"; onOpen(name: string): void; plans?: PlanMembers }) {
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
    <g className={`fig-box ${state} ${side === "after" && k.planned ? "planned" : ""} ${plans?.focus && !(plans.classes[k.name] ?? []).includes(plans.focus) ? "dim" : ""}`} onClick={() => onOpen(k.name)}>
      <title>{`${k.name}: ${shape.interface} public methods, ${side === "after" && k.sizeUnknown ? "planned, so its size is unknown" : `${shape.codeLines} lines of code`}. Click for its shape, request flow and code.`}</title>
      {space && (
        <text className="fig-ns" x={cx} y={node.y + 10} textAnchor="middle">
          {space}::
        </text>
      )}
      <text className="fig-name" x={cx} y={node.y + LABEL_TOP - 8} textAnchor="middle">
        {shortName(k.name)}
      </text>
      <rect x={cx - d.w / 2} y={node.y + LABEL_TOP} width={d.w} height={d.h} rx={4} />
      <RoleLine cx={cx} y={node.y + LABEL_TOP + d.h + 16} role={k.role} text={plans ? "" : numbers(shape, side === "after" ? k.shape.before : null, side === "after" && k.sizeUnknown)} />
      {plans && <PlanChips cx={cx} y={node.y + LABEL_TOP + d.h + 16 + CHIPS} labels={plans.classes[k.name] ?? []} focus={plans.focus} />}
    </g>
  );
}

/** Which plans have this class, as a row of letters; the plan in focus stands out. */
function PlanChips({ cx, y, labels, focus }: { cx: number; y: number; labels: string[]; focus: string | null }) {
  const W = 16;
  const x0 = cx - (labels.length * (W + 3) - 3) / 2;
  return (
    <g className="fig-chips">
      <title>{`In plan${labels.length === 1 ? "" : "s"} ${labels.join(", ")}`}</title>
      {labels.map((l, i) => (
        <g key={l} className={`fig-chip ${l === focus ? "on" : ""}`}>
          <rect x={x0 + i * (W + 3)} y={y - 11} width={W} height={14} rx={4} />
          <text x={x0 + i * (W + 3) + W / 2} y={y} textAnchor="middle">
            {l}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Pills group the roles by hue: mailers read as jobs, and helpers, components and libraries as other classes. */
const PILL: Record<Role, string> = {
  controller: "controller",
  service: "service",
  job: "job",
  mailer: "job",
  concern: "concern",
  model: "model",
  policy: "policy",
  helper: "other",
  component: "other",
  lib: "other",
  other: "other",
};

/** The class's role as a coloured pill, then its numbers, centred under the box together. */
function RoleLine({ cx, y, role, text }: { cx: number; y: number; role: Role; text: string }) {
  const word = ROLE_WORD[role];
  const pillW = word.length * 6.3 + 12;
  const gap = 6;
  const x0 = text ? cx - (pillW + gap + text.length * 6.4) / 2 : cx - pillW / 2;
  return (
    <g>
      <g className={`fig-pill ${PILL[role]}`}>
        <rect x={x0} y={y - 11} width={pillW} height={15} rx={7.5} />
        <text x={x0 + pillW / 2} y={y} textAnchor="middle">
          {word}
        </text>
      </g>
      <text className="fig-nums" x={x0 + pillW + gap} y={y}>
        {text}
      </text>
    </g>
  );
}

function numbers(s: Shape, before: Shape | null, sizeUnknown = false): string {
  const pub = `${s.interface} public`;
  // A planned class has no code yet, so its height is a placeholder and its line count means nothing.
  if (sizeUnknown) return `planned · ${pub} · size unknown`;
  const lines = `${s.codeLines} lines`;
  if (!before) return `${lines} · ${pub}`;
  const dl = s.codeLines - before.codeLines;
  const di = s.interface - before.interface;
  const sign = (n: number) => (n > 0 ? `+${n}` : `−${-n}`);
  return `${lines}${dl ? ` (${sign(dl)})` : ""} · ${pub}${di ? ` (${sign(di)})` : ""}`;
}
