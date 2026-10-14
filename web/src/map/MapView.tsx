import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { select, type Selection } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import "d3-transition";
import type { ClassChange, MethodChange } from "../../../src/shared/types";
import type { AreaNode, ClassNode, Dims, MapLayout, Rect } from "./layout";

export interface MapHandle {
  flyTo(rect: Rect, maxScale?: number, rightInset?: number): void;
  /** rightInset: screen pixels covered on the right (by the class panel). */
  flyToClass(name: string, rightInset?: number): void;
  flyToArea(id: string): void;
  fit(): void;
}

interface Props {
  layout: MapLayout;
  phase: number;
  split: boolean;
  selected: string | null;
  focusArea: string | null;
  onSelect(name: string | null): void;
  onView(view: { k: number; openArea: string | null }): void;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * How far an area has "opened" at this zoom: 0 shows its cover, 1 shows its
 * classes. An area opens as it grows to fill the view, like a city on a map.
 */
const openness = (a: Rect, k: number, vp: { w: number; h: number }) =>
  clamp((Math.max((k * a.w) / vp.w, (k * a.h) / vp.h) - 0.5) / 0.2);

/** The map: one canvas, or two side by side (before | after) that pan and zoom together. */
export const MapView = forwardRef<MapHandle, Props>(function MapView(props, ref) {
  const { layout, phase, split } = props;
  const canvases = useRef<({ svg: Selection<SVGSVGElement, unknown, null, undefined>; zoom: ZoomBehavior<SVGSVGElement, unknown> } | null)[]>([]);
  const syncing = useRef(false);
  const current = useRef<ZoomTransform>(zoomIdentity);
  const [k, setK] = useState(1);
  const fitted = useRef<MapLayout | null>(null);

  const register = useCallback((i: number, c: { svg: Selection<SVGSVGElement, unknown, null, undefined>; zoom: ZoomBehavior<SVGSVGElement, unknown> } | null) => {
    canvases.current[i] = c;
    if (c && fitted.current) c.zoom.transform(c.svg, current.current);
  }, []);

  const onZoom = useCallback(
    (i: number, t: ZoomTransform) => {
      current.current = t;
      if (!syncing.current) {
        syncing.current = true;
        canvases.current.forEach((c, j) => {
          if (c && j !== i) c.zoom.transform(c.svg, t);
        });
        syncing.current = false;
      }
      // Re-render only when the zoom crosses a quarter step; the transform itself is applied directly.
      const q = Math.pow(2, Math.round(Math.log2(t.k) * 6) / 6);
      setK((prev) => (prev === q ? prev : q));
    },
    [],
  );

  const size = () => {
    const c = canvases.current.find(Boolean);
    const node = c?.svg.node();
    return node ? { w: node.clientWidth, h: node.clientHeight } : { w: 800, h: 600 };
  };

  const flyTo = useCallback((rect: Rect, maxScale = 2.5, rightInset = 0) => {
    const { w: fullW, h } = size();
    const w = Math.max(240, fullW - rightInset);
    const pad = 60;
    const scale = Math.min(maxScale, (w - pad * 2) / Math.max(rect.w, 1), (h - pad * 2) / Math.max(rect.h, 1));
    const t = zoomIdentity
      .translate(w / 2, h / 2)
      .scale(scale)
      .translate(-(rect.x + rect.w / 2), -(rect.y + rect.h / 2));
    const c = canvases.current.find(Boolean);
    if (c) c.svg.transition().duration(750).call(c.zoom.transform, t);
  }, []);

  const api: MapHandle = useMemo(
    () => ({
      flyTo,
      fit: () => flyTo({ x: 0, y: 0, w: layout.width, h: layout.height }, 1.2),
      flyToArea: (id) => {
        const a = layout.areas.find((x) => x.id === id);
        if (a) flyTo(a, 1.6);
      },
      flyToClass: (name, rightInset = 0) => {
        const n = layout.classes.get(name);
        if (!n) return;
        const pad = n.featured ? 140 : 60;
        flyTo({ x: n.slot.x - pad, y: n.slot.y - pad, w: n.slot.w + pad * 2, h: n.slot.h + pad * 2 }, 2.2, rightInset);
      },
    }),
    [flyTo, layout],
  );
  useImperativeHandle(ref, () => api, [api]);

  // Fit the whole map the first time a layout arrives; later layouts keep the view.
  useEffect(() => {
    if (fitted.current) {
      fitted.current = layout;
      return;
    }
    fitted.current = layout;
    const { w, h } = size();
    const scale = Math.min(1.2, (w - 80) / layout.width, (h - 80) / layout.height);
    const t = zoomIdentity
      .translate(w / 2, h / 2)
      .scale(scale)
      .translate(-layout.width / 2, -layout.height / 2);
    const c = canvases.current.find(Boolean);
    if (c) c.zoom.transform(c.svg, t);
  }, [layout]);

  // Tell the app which area fills the view, for the breadcrumb.
  const { onView } = props;
  useEffect(() => {
    const open = layout.areas
      .map((a) => ({ a, o: openness(a, k, size()) }))
      .filter((x) => x.o > 0.5)
      .sort((x, y) => y.o - x.o);
    let openArea: string | null = null;
    if (open.length) {
      const { w, h } = size();
      const t = current.current;
      const cx = (w / 2 - t.x) / t.k;
      const cy = (h / 2 - t.y) / t.k;
      openArea = (open.find((x) => cx >= x.a.x && cx <= x.a.x + x.a.w && cy >= x.a.y && cy <= x.a.y + x.a.h) ?? open[0]).a.id;
    }
    onView({ k, openArea });
  }, [k, layout, onView]);

  if (split) {
    return (
      <div className="map split">
        <Canvas {...props} index={0} register={register} onZoom={onZoom} k={k} phase={0} tag="before" />
        <Canvas {...props} index={1} register={register} onZoom={onZoom} k={k} phase={1} tag="after" />
      </div>
    );
  }
  return (
    <div className="map">
      <Canvas {...props} index={0} register={register} onZoom={onZoom} k={k} phase={phase} tag={phase < 0.5 ? "before" : "after"} />
    </div>
  );
});

interface CanvasProps extends Props {
  index: number;
  k: number;
  tag: "before" | "after";
  register(i: number, c: { svg: Selection<SVGSVGElement, unknown, null, undefined>; zoom: ZoomBehavior<SVGSVGElement, unknown> } | null): void;
  onZoom(i: number, t: ZoomTransform): void;
}

function Canvas({ index, register, onZoom, k, phase, tag, layout, selected, onSelect, split, focusArea }: CanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const flyArea = useRef<(id: string) => void>(() => {});

  useEffect(() => {
    const svg = select(svgRef.current!);
    const zoom = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.03, 10])
      .on("zoom", (ev: { transform: ZoomTransform }) => {
        gRef.current?.setAttribute("transform", ev.transform.toString());
        onZoom(index, ev.transform);
      });
    svg.call(zoom).on("dblclick.zoom", null);
    register(index, { svg, zoom });
    flyArea.current = (id) => {
      const a = layout.areas.find((x) => x.id === id);
      if (!a) return;
      const node = svgRef.current!;
      const w = node.clientWidth;
      const h = node.clientHeight;
      const scale = Math.min(1.6, (w - 120) / a.w, (h - 120) / a.h);
      const t = zoomIdentity.translate(w / 2, h / 2).scale(scale).translate(-(a.x + a.w / 2), -(a.y + a.h / 2));
      svg.transition().duration(750).call(zoom.transform, t);
    };
    return () => register(index, null);
  }, [index, register, onZoom, layout]);

  // Hovering a class lights up its links, the same way selecting it does.
  const [hover, setHover] = useState<string | null>(null);
  const focus = hover ?? selected;
  const neighbours = useMemo(() => {
    if (!focus) return null;
    const s = new Set([focus]);
    for (const e of layout.edges) {
      if (e.from === focus) s.add(e.to);
      if (e.to === focus) s.add(e.from);
    }
    return s;
  }, [focus, layout]);

  const open = useMemo(() => {
    const node = svgRef.current;
    const vp = { w: node?.clientWidth || 1000, h: node?.clientHeight || 700 };
    return new Map(layout.areas.map((a) => [a.id, openness(a, k, vp)]));
  }, [layout, k]);
  const p = ease(phase);
  // The area this change touched most is where a first look should start.
  const start = useMemo(() => {
    const score = (a: AreaNode) => a.change.changedClasses * 3 + a.change.changedFiles;
    return [...layout.areas].filter((a) => a.changed).sort((a, b) => score(b) - score(a))[0]?.id ?? null;
  }, [layout]);

  return (
    <div className="canvas">
      {split && <div className={`side-tag ${tag}`}>{tag}</div>}
      <svg ref={svgRef} onClick={(e) => e.target === svgRef.current && onSelect(null)}>
        <defs>
          <pattern id={`dots${index}`} width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.2" className="grid-dot" />
          </pattern>
          {(["accent", "muted", "bad", "ink"] as const).map((c) => (
            <marker key={c} id={`arrow-${c}${index}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 1L10 5L0 9z" className={`mk-${c}`} />
            </marker>
          ))}
        </defs>
        <rect width="100%" height="100%" fill={`url(#dots${index})`} pointerEvents="none" />
        <g ref={gRef}>
          {layout.areas.map((a) => (
            <AreaBack key={a.id} area={a} open={open.get(a.id)!} k={k} focus={focusArea === a.id} />
          ))}
          <City layout={layout} k={k} selected={selected} onSelect={onSelect} open={open} />
          <Edges layout={layout} p={p} open={open} selected={focus} index={index} />
          {[...layout.classes.values()]
            .filter((n) => n.featured)
            .map((n) => (
              <ClassBox
                key={n.name}
                node={n}
                p={p}
                k={k}
                open={open.get(n.area) ?? 1}
                selected={selected === n.name}
                dim={neighbours ? !neighbours.has(n.name) : false}
                onHover={setHover}
                onSelect={onSelect}
              />
            ))}
          <AreaLinks layout={layout} open={open} index={index} p={p} />
          {layout.areas.map((a) => (
            <AreaCover key={a.id} area={a} open={open.get(a.id)!} k={k} start={a.id === start} onOpen={(id) => flyArea.current(id)} />
          ))}
        </g>
      </svg>
    </div>
  );
}

function AreaBack({ area, open, k, focus }: { area: AreaNode; open: number; k: number; focus: boolean }) {
  const px = 11;
  return (
    <g>
      {area.changed && <rect x={area.x - 6} y={area.y - 6} width={area.w + 12} height={area.h + 12} rx={20} className="area-glow" strokeWidth={10} />}
      <rect x={area.x} y={area.y} width={area.w} height={area.h} rx={14} className={`area-bg ${area.changed ? "changed" : ""}`} strokeWidth={focus ? 3 : undefined} />
      {open > 0.05 && (
        <g opacity={open}>
          <text x={area.x + 22} y={area.y + 22 + Math.min(px / k, 22)} className="area-label" fontSize={Math.min(px / k, 22)}>
            {area.change.name}
          </text>
          <text x={area.x + 22} y={area.y + 26 + 2 * Math.min(px / k, 22)} className="area-sub" fontSize={Math.min(9.5 / k, 16)}>
            {area.change.after.classes} classes · {area.change.after.codeLines.toLocaleString()} lines
            {area.change.changedClasses ? ` · ${area.change.changedClasses} changed` : ""}
          </text>
        </g>
      )}
    </g>
  );
}

function AreaCover({ area, open, k, start, onOpen }: { area: AreaNode; open: number; k: number; start: boolean; onOpen(id: string): void }) {
  if (open >= 0.98) return null;
  const ch = area.change;
  const screenW = area.w * k;
  // The title fits the tile: smaller tiles get smaller titles, never wider than the tile.
  const titlePx = clamp(Math.min(screenW / 11, (screenW * 0.86) / (ch.name.length * 0.52)), 8, 30);
  const subPx = clamp(titlePx * 0.48, 7, 13);
  const intensity = area.changed ? clamp((ch.changedFiles + ch.changedClasses) / 40, 0, 1) : 0;
  const roomy = screenW > 220;
  const added = ch.after.classes - ch.before.classes;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "es"}`;
  const sub = area.changed
    ? ch.changedClasses
      ? roomy && added > 0
        ? `${plural(ch.changedClasses, "class")} changed, ${added} new`
        : `${plural(ch.changedClasses, "class")} changed`
      : `${ch.changedFiles} file${ch.changedFiles === 1 ? "" : "s"} changed`
    : roomy
      ? `untouched · ${plural(ch.after.classes, "class")}`
      : "untouched";
  return (
    <g
      opacity={1 - open}
      style={{ cursor: "zoom-in", pointerEvents: open > 0.5 ? "none" : undefined }}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(area.id);
      }}
    >
      <title>{`${ch.name}\n${ch.description ?? ""}\n${ch.after.classes} classes · ${ch.after.codeLines.toLocaleString()} lines`}</title>
      <rect x={area.x} y={area.y} width={area.w} height={area.h} rx={14} className={`area-cover ${area.changed ? "changed" : ""} ${start ? "start" : ""}`} fillOpacity={area.changed ? 0.45 + intensity * 0.55 : 0.85} />
      <text x={area.x + area.w / 2} y={area.y + area.h / 2 - (subPx * 0.3) / k} textAnchor="middle" className="area-title" fontSize={titlePx / k}>
        {ch.name}
      </text>
      <text x={area.x + area.w / 2} y={area.y + area.h / 2 + (subPx * 1.6) / k} textAnchor="middle" className="area-sub" fontSize={subPx / k}>
        {sub}
      </text>
      {start && open < 0.3 && (
        <g className="start-here" transform={`translate(${area.x + area.w / 2} ${area.y}) scale(${1 / k})`}>
          <rect x={-42} y={-13} width={84} height={26} rx={13} />
          <text y={4.5} textAnchor="middle">
            Start here
          </text>
        </g>
      )}
    </g>
  );
}

const City = memo(function City({
  layout,
  k,
  selected,
  onSelect,
  open,
}: {
  layout: MapLayout;
  k: number;
  selected: string | null;
  onSelect(n: string): void;
  open: Map<string, number>;
}) {
  const nodes = [...layout.classes.values()].filter((n) => !n.featured);
  return (
    <g>
      {nodes.map((n) => {
        const d = n.after ?? n.before!;
        const showName = k * n.slot.w > 70 && (open.get(n.area) ?? 0) > 0.5;
        return (
          <g key={n.name} className={`cls unchanged ${selected === n.name ? "selected" : ""}`} onClick={(e) => (e.stopPropagation(), onSelect(n.name))}>
            <title>{`${n.name}\n${n.change.shape.after?.interface ?? 0} public · ${n.change.shape.after?.codeLines ?? 0} lines`}</title>
            <rect className="box city" x={n.slot.x} y={n.slot.y} width={d.w} height={d.h} rx={2} />
            {showName && (
              <text className="meta" x={n.slot.x + 3 / k} y={n.slot.y + 10 / k} fontSize={8.5 / k}>
                {n.name.split("::").pop()}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
});

function Edges({ layout, p, open, selected, index }: { layout: MapLayout; p: number; open: Map<string, number>; selected: string | null; index: number }) {
  return (
    <g>
      {layout.edges.map((e) => {
        const fa = layout.classes.get(e.from)!.area;
        const ta = layout.classes.get(e.to)!.area;
        const o = Math.max(open.get(fa) ?? 0, open.get(ta) ?? 0);
        if (o < 0.05) return null;
        const status = e.edge.status;
        const touchesSelected = selected !== null && (e.from === selected || e.to === selected);
        // At first only the links this change made or broke inside an area show. A class's other
        // links, and anything reaching into another area, wait until you hover or pick that class.
        if (!touchesSelected && (e.cross || status === "unchanged")) return null;
        const alpha = status === "added" ? p : status === "removed" ? 1 - p * 0.75 : 1;
        if (alpha < 0.02) return null;
        const hl = touchesSelected;
        const marker = hl ? "ink" : status === "added" ? "accent" : status === "removed" ? "bad" : "muted";
        return (
          <path
            key={e.key}
            d={e.path}
            className={`edge ${status} ${e.edge.kind === "inherits" ? "inherits" : ""} ${e.edge.planned ? "planned" : ""} ${hl ? "hl" : ""}`}
            opacity={o * alpha * (selected && !hl ? 0.25 : status === "unchanged" ? 0.7 : 1)}
            markerEnd={`url(#arrow-${marker}${index})`}
          />
        );
      })}
    </g>
  );
}

function AreaLinks({ layout, open, index, p }: { layout: MapLayout; open: Map<string, number>; index: number; p: number }) {
  // Only links this change made or broke; the standing ones are background a first look doesn't need.
  const shown = layout.areaLinks.filter((l) => l.status !== "unchanged");
  return (
    <g>
      {shown.map((l) => {
        const o = 1 - Math.max(open.get(l.from) ?? 0, open.get(l.to) ?? 0);
        const alpha = l.status === "added" ? p : l.status === "removed" ? 1 - p * 0.8 : 1;
        if (o * alpha < 0.03) return null;
        const count = lerp(l.before, l.after, p);
        const quiet = l.status === "unchanged";
        return (
          <path
            key={`${l.from}>${l.to}`}
            d={l.path}
            className={`aedge ${l.status}`}
            strokeWidth={quiet ? 1 + Math.min(Math.sqrt(count), 4) : 3 + Math.sqrt(count)}
            opacity={o * alpha * (quiet ? 0.35 : 0.9)}
            markerEnd={`url(#arrow-${l.status === "added" ? "accent" : l.status === "removed" ? "bad" : "muted"}${index})`}
            pointerEvents="none"
          />
        );
      })}
    </g>
  );
}

function boxAt(slot: Rect, d: Dims): Rect {
  return { x: slot.x + (slot.w - d.w) / 2, y: slot.y + slot.h - d.h, w: d.w, h: d.h };
}

function ClassBox({
  node,
  p,
  k,
  open,
  selected,
  dim,
  onSelect,
  onHover,
}: {
  node: ClassNode;
  p: number;
  k: number;
  open: number;
  selected: boolean;
  dim: boolean;
  onSelect(n: string): void;
  onHover(n: string | null): void;
}) {
  const { change: c, before: b, after: a, slot } = node;
  let d: Dims;
  let cls: string;
  let opacity = 1;
  if (b && a) {
    d = { w: lerp(b.w, a.w, p), h: lerp(b.h, a.h, p) };
    cls = c.status;
  } else if (a) {
    // Arrives in the accent colour as the map moves to "after".
    d = { w: a.w * (0.3 + 0.7 * p), h: a.h * (0.3 + 0.7 * p) };
    cls = p < 0.15 ? "ghost" : "added";
    opacity = 0.35 + 0.65 * p;
  } else {
    // Fades to a ghost.
    d = b!;
    cls = p > 0.85 ? "ghost" : "removed";
    opacity = 1 - 0.55 * p;
  }
  const r = boxAt(slot, d);
  const maxH = Math.max(b?.h ?? 0, a?.h ?? 0);
  const showLabel = k >= 0.45 && open > 0.3;
  const font = Math.min(11 / k, 14);
  const parts = c.name.split("::");
  const last = parts.pop()!;
  const ns = parts.join("::");
  const labelY = slot.y + slot.h - maxH - 6;
  const showMethods = k * r.w >= 120 && k * r.h >= 60 && open > 0.6;
  const prev = c.status === "changed" && b && a && p > 0.5 ? boxAt(slot, b) : null;
  const shape = p < 0.5 ? (c.shape.before ?? c.shape.after) : (c.shape.after ?? c.shape.before);

  return (
    <g
      className={`cls ${cls} ${c.planned ? "planned" : ""} ${selected ? "selected" : ""} ${dim ? "dim" : ""}`}
      opacity={opacity * Math.max(open, 0.15)}
      onPointerEnter={() => open > 0.5 && onHover(c.name)}
      onPointerLeave={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(c.name);
      }}
    >
      <title>{`${c.name} (${c.planned ? `planned, ${c.status === "added" ? "new" : "reshaped"}` : c.status})\n${shape?.interface ?? 0} public methods · ${c.sizeUnknown ? "size unknown until there is code" : `${shape?.codeLines ?? 0} code lines`}${c.descendants ? `\ninherited by ${c.descendants}` : ""}`}</title>
      <rect className="box" x={r.x} y={r.y} width={Math.max(r.w, 1)} height={Math.max(r.h, 1)} rx={3} />
      {prev && <rect className="prev" x={prev.x} y={prev.y} width={prev.w} height={prev.h} rx={3} opacity={(p - 0.5) * 2} />}
      {showLabel && (
        <g>
          {ns && (
            <text className="meta" x={slot.x + slot.w / 2} y={labelY - font * 1.05} fontSize={font * 0.8} textAnchor="middle">
              {ns}::
            </text>
          )}
          <text className="name" x={slot.x + slot.w / 2} y={labelY} fontSize={font} textAnchor="middle">
            {last}
          </text>
        </g>
      )}
      {showMethods && <MethodRows change={c} rect={r} k={k} p={p} />}
    </g>
  );
}

/** Inside a box at close zoom: one row per method, its bar the method's length. */
function MethodRows({ change, rect, k, p }: { change: ClassChange; rect: Rect; k: number; p: number }) {
  const unit = (p < 0.5 ? change.before : change.after) ?? change.after ?? change.before;
  const fromDiff: MethodChange[] = change.methods.length
    ? change.methods
    : (unit?.methods ?? []).map((m) => ({
        name: m.name,
        scope: m.scope,
        status: "unchanged" as const,
        before: { visibility: m.visibility, codeLines: m.codeLines, params: m.params, branches: m.branches },
        after: { visibility: m.visibility, codeLines: m.codeLines, params: m.params, branches: m.branches },
      }));
  const visible = fromDiff.filter((m) => (p < 0.5 ? m.before : m.after) || m.status === "removed" || m.status === "added");
  const order = (m: MethodChange) => (m.status !== "unchanged" ? 0 : 1) * 10 + ((p < 0.5 ? m.before : m.after)?.visibility === "public" ? 0 : 1);
  const rows = visible.sort((x, y) => order(x) - order(y) || x.name.localeCompare(y.name));
  const rowH = 13 / k;
  const max = Math.max(0, Math.floor((rect.h - 6 / k) / rowH));
  const longest = Math.max(1, ...rows.map((m) => Math.max(m.before?.codeLines ?? 0, m.after?.codeLines ?? 0)));
  const barMax = rect.w * 0.35;
  return (
    <g pointerEvents="none">
      {rows.slice(0, max).map((m, i) => {
        const y = rect.y + 4 / k + i * rowH;
        const lines = lerp(m.before?.codeLines ?? 0, m.after?.codeLines ?? 0, p);
        const vis = (m.after ?? m.before)!.visibility;
        return (
          <g key={`${m.scope}${m.name}`}>
            <rect className={`mbar ${m.status}`} x={rect.x + rect.w - 4 / k - (barMax * lines) / longest} y={y + 2 / k} width={Math.max((barMax * lines) / longest, 1 / k)} height={rowH - 5 / k} rx={1 / k} />
            <text className="method" x={rect.x + 5 / k} y={y + rowH * 0.72} fontSize={9 / k} opacity={vis === "public" ? 1 : 0.6}>
              {m.status === "added" ? "+ " : m.status === "removed" ? "− " : m.status === "changed" ? "~ " : "  "}
              {m.scope === "class" ? "self." : ""}
              {m.name}
            </text>
          </g>
        );
      })}
      {rows.length > max && max > 0 && (
        <text className="meta" x={rect.x + 5 / k} y={rect.y + rect.h - 3 / k} fontSize={8 / k}>
          +{rows.length - max} more
        </text>
      )}
    </g>
  );
}
