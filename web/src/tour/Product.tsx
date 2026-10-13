import { useEffect, useState } from "react";
import ELK, { type ElkExtendedEdge } from "elkjs/lib/elk.bundled.js";
import type { ChangeStatus, ProductChanges, ProductPart, Story, TableChange } from "../../../src/shared/types";
import { splinePath } from "../map/layout";

/**
 * The first page of the summary: what the change does to the product, read
 * straight from the code. Tables and columns, the states a record moves
 * through, screens, permission rules and background jobs.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const shortController = (name: string) => name.replace(/Controller$/, "");

export const hasProduct = (p: ProductChanges | undefined): p is ProductChanges =>
  !!p && p.tables.length + p.migrations.length + p.screens.length + p.permissions.length + p.lifecycles.length + p.jobs.length + p.routes.added.length + p.routes.removed.length > 0;

export function productCounts(p: ProductChanges): { part: ProductPart; text: string }[] {
  const out: { part: ProductPart; text: string }[] = [];
  const n = (s: ChangeStatus) => p.tables.filter((t) => t.status === s).length;
  if (n("added")) out.push({ part: "data", text: plural(n("added"), "new table") });
  if (n("changed")) out.push({ part: "data", text: plural(n("changed"), "changed table") });
  if (n("removed")) out.push({ part: "data", text: plural(n("removed"), "dropped table") });
  if (p.lifecycles.length) out.push({ part: "lifecycles", text: plural(p.lifecycles.length, "lifecycle change") });
  const screens = p.screens.filter((s) => s.status === "added").length;
  const actions = p.screens.filter((s) => s.status === "changed").reduce((k, s) => k + s.actions.filter((a) => a.status === "added").length, 0);
  if (screens) out.push({ part: "screens", text: plural(screens, "new screen") });
  if (actions) out.push({ part: "screens", text: plural(actions, "new action") });
  const gone = p.screens.filter((s) => s.status === "removed").length;
  if (gone) out.push({ part: "screens", text: plural(gone, "removed screen") });
  if (p.permissions.length) out.push({ part: "permissions", text: plural(p.permissions.length, "permission rule") });
  if (p.jobs.length) out.push({ part: "jobs", text: plural(p.jobs.length, "job or email", "jobs and emails") });
  return out;
}

export function ProductPage({ product: p, story, onNext }: { product: ProductChanges; story: Story | null; onNext(): void }) {
  const caption = (part: ProductPart) => story?.product?.[part];
  const go = (part: ProductPart) => document.getElementById(`product-${part}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const dataOnly = p.migrations.filter((m) => !m.schema);
  return (
    <article className="stop product" key="product">
      <div className="stop-meta">What changed in the product</div>
      <h2 className="stop-heading">What this change adds, removes and reshapes</h2>
      <div className="product-counts">
        {productCounts(p).map((c, i) => (
          <button key={i} className="count-chip" onClick={() => go(c.part)}>
            {c.text}
          </button>
        ))}
      </div>

      {(p.tables.length > 0 || p.migrations.length > 0) && (
        <section className="product-part" id="product-data">
          <h3>Data</h3>
          {caption("data") && <p className="stop-explain">{caption("data")}</p>}
          {p.tables.length > 0 && <TablesDiagram tables={p.tables} />}
          {dataOnly.length > 0 && (
            <p className="product-note">
              {dataOnly.length === 1 ? "One migration only moves data: " : `${dataOnly.length} migrations only move data: `}
              {dataOnly.map((m, i) => (
                <span key={m.file}>
                  {i > 0 && ", "}
                  <b>{m.title}</b>
                </span>
              ))}
              .
            </p>
          )}
          {p.migrations.length > 0 && (
            <details className="product-more">
              <summary>{plural(p.migrations.length, "new migration")}</summary>
              <ul>
                {p.migrations.map((m) => (
                  <li key={m.file}>
                    {m.title}
                    {!m.schema && <span className="pill flat">data only</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {p.lifecycles.length > 0 && (
        <section className="product-part" id="product-lifecycles">
          <h3>Lifecycles</h3>
          {caption("lifecycles") && <p className="stop-explain">{caption("lifecycles")}</p>}
          {p.lifecycles.map((l) => (
            <Lifecycle key={`${l.model}.${l.field}`} l={l} />
          ))}
        </section>
      )}

      {p.screens.length > 0 && (
        <section className="product-part" id="product-screens">
          <h3>Screens</h3>
          {caption("screens") && <p className="stop-explain">{caption("screens")}</p>}
          <ul className="product-list">
            {p.screens.map((s) => (
              <li key={s.controller} className={s.status}>
                <span className={`mark ${s.status}`}>{s.status === "added" ? "new" : s.status === "removed" ? "removed" : "changed"}</span>
                <code>{shortController(s.controller)}</code>
                <span className="actions">
                  {s.actions.map((a) => (
                    <span key={a.name} className={`action ${a.status}`}>
                      {a.name}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          {p.routes.added.length + p.routes.removed.length > 0 && (
            <details className="product-more">
              <summary>Route lines that changed</summary>
              <pre className="routes">
                {[...p.routes.removed.map((r) => `- ${r}`), ...p.routes.added.map((r) => `+ ${r}`)].map((r, i) => (
                  <div key={i} className={r[0] === "+" ? "add" : "del"}>
                    {r}
                  </div>
                ))}
              </pre>
            </details>
          )}
        </section>
      )}

      {p.permissions.length > 0 && (
        <section className="product-part" id="product-permissions">
          <h3>Permissions</h3>
          {caption("permissions") && <p className="stop-explain">{caption("permissions")}</p>}
          <ul className="product-list">
            {[...new Set(p.permissions.map((r) => r.policy))].map((policy) => {
              const rules = p.permissions.filter((r) => r.policy === policy);
              const st: ChangeStatus = rules.every((r) => r.status === "added") ? "added" : rules.every((r) => r.status === "removed") ? "removed" : "changed";
              return (
                <li key={policy} className={st}>
                  <span className={`mark ${st}`}>{st === "added" ? "new" : st}</span>
                  <code>{policy}</code>
                  <span className="actions">
                    {rules.map((r) => (
                      <span key={r.rule} className={`action ${r.status}`} title={r.status === "changed" ? "This rule's code changed" : undefined}>
                        {r.rule}
                        {r.status === "changed" ? " (changed)" : ""}
                      </span>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {p.jobs.length > 0 && (
        <section className="product-part" id="product-jobs">
          <h3>Jobs and emails</h3>
          {caption("jobs") && <p className="stop-explain">{caption("jobs")}</p>}
          <ul className="product-list">
            {p.jobs.map((j) => (
              <li key={j.name} className={j.status}>
                <span className={`mark ${j.status}`}>{j.status === "added" ? "new" : j.status}</span>
                <code>{j.name}</code>
                {j.methods.length > 0 && <span className="actions">{j.methods.map((m) => <span key={m} className="action added">{m}</span>)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="stop-foot">
        <span />
        <span />
        <button className="btn primary" onClick={onNext}>
          How the code changed →
        </button>
      </footer>
    </article>
  );
}

function Lifecycle({ l }: { l: ProductChanges["lifecycles"][number] }) {
  const removed = l.before.filter((s) => !l.after.includes(s));
  const states = [...l.after, ...removed];
  const newMoves = l.moves.filter((m) => m.status === "added");
  const goneMoves = l.moves.filter((m) => m.status === "removed");
  return (
    <div className="lifecycle">
      <div className="lifecycle-name">
        <code>
          {l.model}.{l.field}
        </code>
      </div>
      <div className="lifecycle-states">
        {states.map((s, i) => (
          <span key={s} className="lifecycle-step">
            {i > 0 && <span className="lifecycle-arrow">→</span>}
            <span className={`state ${!l.before.includes(s) ? "added" : !l.after.includes(s) ? "removed" : ""}`}>{s}</span>
          </span>
        ))}
      </div>
      {(newMoves.length > 0 || goneMoves.length > 0) && (
        <p className="product-note">
          {newMoves.length > 0 && (
            <>
              New moves:{" "}
              {newMoves.map((m, i) => (
                <span key={i}>
                  {i > 0 && ", "}
                  <b>
                    {m.from} → {m.to}
                  </b>
                </span>
              ))}
              .{" "}
            </>
          )}
          {goneMoves.length > 0 && <>No longer allowed: {goneMoves.map((m) => `${m.from} → ${m.to}`).join(", ")}.</>}
        </p>
      )}
    </div>
  );
}

// ---------- the tables drawing ----------

const ROW = 15;
const HEAD = 24;
const MAX_ROWS = 9;

interface TableBox {
  name: string;
  status: ChangeStatus;
  rows: { text: string; type: string; status: ChangeStatus }[];
  more: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

function boxFor(t: TableChange | null, name: string): Omit<TableBox, "x" | "y"> {
  if (!t) return { name, status: "unchanged", rows: [], more: null, w: Math.max(80, name.length * 7.4 + 20), h: HEAD };
  // A new table's foreign-key columns show as arrows, so they are left out of its rows.
  const fk = new Set(t.references.map((r) => r.column));
  const cols = t.status === "added" ? t.columns.filter((c) => !fk.has(c.name)) : t.columns;
  const rows = cols.slice(0, MAX_ROWS).map((c) => ({ text: c.name, type: c.type, status: c.status }));
  const extra = cols.length - rows.length;
  const more = [extra > 0 ? `${extra} more` : "", t.otherColumns ? `${t.otherColumns} unchanged columns` : ""].filter(Boolean).join(" · ") || null;
  const wide = Math.max(name.length * 7.6 + (t.status === "changed" ? 0 : 34), ...rows.map((r) => (r.text.length + r.type.length + 3) * 6.3), more ? more.length * 5.8 : 0);
  return { name, status: t.status, rows, more, w: Math.max(110, wide + 24), h: HEAD + rows.length * ROW + (more ? ROW : 0) + 6 };
}

const elk = new ELK();

function TablesDiagram({ tables }: { tables: TableChange[] }) {
  const [drawing, setDrawing] = useState<{ width: number; height: number; boxes: TableBox[]; edges: { path: string; status: ChangeStatus; label: string }[] } | null>(null);
  useEffect(() => {
    let stale = false;
    const byName = new Map(tables.map((t) => [t.name, t]));
    const names = new Set(tables.map((t) => t.name));
    // Bring in the existing tables the change points new references at, for context.
    for (const t of tables) for (const r of t.references) if (r.status !== "unchanged" || t.status === "added") names.add(r.to);
    // Every reference that moved, plus old ones between tables the change touched; one arrow per pair of tables.
    const touched = (n: string) => byName.has(n);
    const seen = new Set<string>();
    const refs = tables
      .flatMap((t) =>
        t.references
          .filter((r) => r.to !== t.name && names.has(r.to) && (r.status !== "unchanged" || t.status === "added" || touched(r.to)))
          .map((r) => ({ from: t.name, ...r })),
      )
      .sort((a, b) => (a.status === "unchanged" ? 1 : 0) - (b.status === "unchanged" ? 1 : 0))
      .filter((r) => !seen.has(`${r.from}>${r.to}`) && !!seen.add(`${r.from}>${r.to}`));
    const boxes = [...names].map((n) => boxFor(byName.get(n) ?? null, n));
    elk
      .layout({
        id: "tables",
        layoutOptions: {
          "elk.algorithm": "layered",
          // References point up at the tables they belong to, so parents sit on top.
          "elk.direction": "UP",
          "elk.spacing.nodeNode": "26",
          "elk.layered.spacing.nodeNodeBetweenLayers": "46",
          "elk.edgeRouting": "SPLINES",
          "elk.aspectRatio": "2.2",
        },
        children: boxes.map((b) => ({ id: b.name, width: b.w, height: b.h })),
        edges: refs.map((r, i) => ({ id: `r${i}`, sources: [r.from], targets: [r.to], r }) as ElkExtendedEdge & { r: (typeof refs)[number] }),
      })
      .then((g) => {
        if (stale) return;
        const PAD = 12;
        const placed = (g.children ?? []).map((n) => ({ ...boxes.find((b) => b.name === n.id)!, x: n.x! + PAD, y: n.y! + PAD }));
        const edges = ((g.edges ?? []) as (ElkExtendedEdge & { r: (typeof refs)[number] })[]).flatMap((e) => {
          const s = e.sections?.[0];
          if (!s) return [];
          const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({ x: p.x + PAD, y: p.y + PAD }));
          return [{ path: splinePath(pts), status: e.r.status, label: e.r.column }];
        });
        setDrawing({ width: (g.width ?? 0) + PAD * 2, height: (g.height ?? 0) + PAD * 2, boxes: placed, edges });
      });
    return () => {
      stale = true;
    };
  }, [tables]);
  if (!drawing) return <div className="figure-loading">Drawing…</div>;
  return (
    <div className="tables-figure">
      <svg viewBox={`0 0 ${drawing.width} ${drawing.height}`} style={{ maxWidth: drawing.width }} role="img" aria-label="Tables the change added or changed, and the tables they reference">
        <defs>
          {(["added", "removed", "unchanged"] as const).map((k) => (
            <marker key={k} id={`tbl-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 1L10 5L0 9z" className={`fig-mk ${k === "added" ? "new" : k === "removed" ? "gone" : "same"}`} />
            </marker>
          ))}
        </defs>
        {drawing.edges.map((e, i) => (
          <path key={i} d={e.path} className={`fig-edge ${e.status === "added" ? "new" : e.status === "removed" ? "gone" : "same"}`} markerEnd={`url(#tbl-${e.status === "changed" ? "unchanged" : e.status})`}>
            <title>{e.label}</title>
          </path>
        ))}
        {drawing.boxes.map((b) => (
          <g key={b.name} className={`tbl ${b.status}`}>
            <title>{`${b.name}: ${b.status === "added" ? "new table" : b.status === "removed" ? "dropped table" : b.status === "changed" ? "changed table" : "existing table, shown for context"}`}</title>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={5} />
            {b.rows.length > 0 && <line x1={b.x} x2={b.x + b.w} y1={b.y + HEAD} y2={b.y + HEAD} />}
            <text className="tbl-name" x={b.x + 10} y={b.y + 16}>
              {b.name}
            </text>
            {b.status !== "unchanged" && (
              <text className="tbl-tag" x={b.x + b.w - 8} y={b.y + 16} textAnchor="end">
                {b.status === "added" ? "new" : b.status === "removed" ? "dropped" : ""}
              </text>
            )}
            {b.rows.map((r, i) => (
              <text key={r.text} className={`tbl-row ${r.status}`} x={b.x + 10} y={b.y + HEAD + 13 + i * ROW}>
                {r.status === "added" && b.status === "changed" ? "+ " : r.status === "removed" ? "− " : r.status === "changed" ? "~ " : ""}
                {r.text}
                <tspan className="tbl-type"> {r.type}</tspan>
              </text>
            ))}
            {b.more && (
              <text className="tbl-more" x={b.x + 10} y={b.y + HEAD + 13 + b.rows.length * ROW}>
                {b.more}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
