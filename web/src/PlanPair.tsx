import type React from "react";
import { useMemo, useState } from "react";
import type { Comparison, PlanComparison, PlanSide, ProductPart, ProductRow } from "../../src/shared/types";
import { dependencyKey, newDependencies, sharedDependencies } from "../../src/shared/plan-dependencies";
import { type SurfaceItem, byLayer, methodCount, sharedSurface, surfaceClasses } from "../../src/shared/plan-surface";
import { Logo } from "./VerdictStrip";
import { TablesDiagram } from "./tour/Product";
import { ROLE_WORD, StopDiagram } from "./tour/StopDiagram";
import { Mermaid } from "./Mermaid";
import { toMermaid } from "./ClassPanel";

/**
 * Two to four plans for one goal, side by side: Ousterhout's "design it twice".
 * They share a goal, so each heading says how the plan differs (its approach), not why.
 * Product first, then what the rest of the code must learn, how tangled each
 * plan is, the same request under each, and one short note from the book.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const NUMBER = ["", "", "Two", "Three", "Four"];
const PART: Record<ProductPart, string> = { data: "Data", lifecycles: "Lifecycle", screens: "Screen", permissions: "Permissions", jobs: "Job" };

export function PlanPair({ pair }: { pair: PlanComparison }) {
  const n = pair.sides.length;
  const every = n === 2 ? "both" : "all";
  const apart = pair.product.filter((r) => r.where === "some");
  const same = pair.product.filter((r) => r.where === "all");
  const anyTables = pair.sides.some((s) => s.product.tables.length > 0);
  const cols = { "--n": n } as React.CSSProperties;
  const problems = pair.sides.filter((s) => s.plan.problems.length);
  const [today, setToday] = useState(false);
  const shared = useMemo(() => sharedDependencies(pair.sides), [pair]);
  const sameSurface = useMemo(() => sharedSurface(pair.sides), [pair]);
  const sameClasses = useMemo(() => surfaceClasses(pair.sides[0], (k) => sameSurface.has(k)), [pair, sameSurface]);
  return (
    <div className="app">
      <header className="strip">
        <div className="strip-top">
          <div className="brand">
            <Logo />
            Refract
          </div>
          <div className="refs">
            <span>{pair.sides[0].drawing.repo.name}</span>
            <span className="range-line">
              <b>{NUMBER[n] ?? n} plans</b> for one goal, drawn against <b>{pair.base.ref}</b> as it is today
            </span>
          </div>
        </div>
      </header>
      <div className="main tour-main">
        <div className="tour-stage">
          <article className="stop plan-pair">
            <div className="stop-meta">
              Design it twice <span className="plan-tag">planned</span>
            </div>
            <div className="pair-cols" style={cols}>
              {pair.sides.map((s) => (
                <div key={s.label} className="pair-head">
                  <span className="pair-label">Plan {s.label}</span>
                  <h2>{s.plan.title}</h2>
                  {s.plan.approach && <p>{s.plan.approach}</p>}
                  <code className="pair-file">{s.plan.file}</code>
                </div>
              ))}
            </div>
            {problems.map((s) => (
              <p key={s.label} className="pair-problems">
                Refract could not read part of Plan {s.label}: {s.plan.problems.join(" ")}
              </p>
            ))}

            <section className="product-part">
              <h3>What each plan adds to the product</h3>
              <p className="stop-explain">
                {apart.length === 0
                  ? `${n === 2 ? "Both plans" : `All ${n} plans`} build the same product: ${plural(same.length, "change")} to tables, states, screens and rules. The difference is only in the code.`
                  : `They agree on ${plural(same.length, "thing")} and part ways on ${apart.length}.`}
              </p>
              {apart.length > 0 && <Rows rows={apart} labels={pair.sides.map((s) => s.label)} />}
              {same.length > 0 && (
                <details className="product-more" open={apart.length === 0}>
                  <summary>
                    The same in {every} ({same.length})
                  </summary>
                  <ul>
                    {same.map((r, i) => (
                      <li key={i}>{r.cells[0]}</li>
                    ))}
                  </ul>
                </details>
              )}
              {anyTables && (
                // Drawings need the width: four plans go two by two here, where text sections stay in one row.
                <div className="pair-cols" style={{ "--n": n === 4 ? 2 : n } as React.CSSProperties}>
                  {pair.sides.map((s) => (
                    <div key={s.label} className="product planned pair-tables">
                      <div className="pane-tag">Plan {s.label}: tables</div>
                      {s.product.tables.length ? <TablesDiagram tables={s.product.tables} /> : <p className="pair-none">No table changes.</p>}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="product-part">
              <h3>What the rest of the code must learn</h3>
              <p className="product-note">
                The public methods each plan adds outside controllers, policies, jobs and mailers (those are screens, rules and emails above). Each one is something a caller has to know about.
              </p>
              {sameClasses.length > 0 && (
                <div className="pair-cell">
                  <div className="pane-tag">
                    The same in {every} plans: {plural(methodCount(sameClasses), "public method")}
                  </div>
                  <SurfaceLayers classes={sameClasses} />
                </div>
              )}
              <div className="pair-cols" style={cols}>
                {pair.sides.map((s) => (
                  <Surface key={s.label} side={s} shared={sameSurface} max={Math.max(1, ...pair.sides.map((x) => x.surface.methods))} />
                ))}
              </div>
            </section>

            <section className="product-part">
              <h3>How far each plan's changes reach</h3>
              <p className="product-note">
                A new dependency is not a risk in itself. Changing a class many others lean on is: each of them may have to change too. So each plan leads with the existing classes whose behavior it changes (it takes a method away, or names the class without giving it anything new) and how many classes outside the plan depend on them today. A class it only adds methods or associations to is listed apart: its callers keep working.
              </p>
              <div className="pair-cols" style={cols}>
                {pair.sides.map((s) => (
                  <Tangle key={s.label} side={s} />
                ))}
              </div>
              <label className="pair-toggle">
                <input type="checkbox" checked={today} onChange={(e) => setToday(e.target.checked)} /> Also draw the dependencies that are there today
              </label>
              <div className="pair-drawings">
                {today ? (
                  pair.sides.map((s) => <Drawing key={s.label} side={s} />)
                ) : (
                  <>
                    {shared.size > 0 && <NewDrawing side={pair.sides[0]} keep={(k) => shared.has(k)} tag={`The same in ${every} plans`} />}
                    {pair.sides.map((s) => (
                      <NewDrawing key={s.label} side={s} keep={(k) => !shared.has(k)} tag={shared.size ? `Plan ${s.label} only` : `Plan ${s.label}`} />
                    ))}
                  </>
                )}
              </div>
              <p className="product-note">
                {today
                  ? "Dashed boxes are planned; classes with no arrows are left out. Green arrows are new dependencies the plan adds; grey ones are there today. Boxes sit in Rails layers: controllers, then services and jobs, then models."
                  : `Only the new dependencies are drawn${shared.size ? `: those ${every} plans add once, then each plan's own` : ""}. Dashed boxes are planned. Boxes sit in Rails layers: controllers, then services and jobs, then models.`}
              </p>
            </section>

            {pair.flows.length > 0 && (
              <section className="product-part">
                <h3>The same request under each plan</h3>
                {pair.flows.map((p, i) => (
                  <div key={i} className="pair-flow">
                    <h4>{p.title}</h4>
                    <div className="pair-cols" style={cols}>
                      {pair.sides.map((s, k) => {
                        const at = p.at[k];
                        const f = at === null ? null : s.flows[at];
                        return (
                          <div key={s.label} className="pair-cell">
                            <div className="pane-tag">Plan {s.label}</div>
                            {f ? (
                              <>
                                <div className="seq">
                                  <Mermaid text={toMermaid(f.sequence)} />
                                </div>
                                <p className="pair-small">
                                  The entry point makes {plural(f.entryCalls, "call")} itself; {plural(f.sequence.messages.length, "call")} in all.
                                </p>
                              </>
                            ) : (
                              <p className="pair-none">This plan does not draw this request.</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </section>
            )}

            <aside className="stop-lens pair-note">
              <div className="who">John Ousterhout · {pair.note.source}</div>
              {pair.note.lines.map((l, i) => (
                <p key={i} className={i === pair.note.lines.length - 1 ? "pair-small" : undefined}>
                  {l}
                </p>
              ))}
            </aside>
          </article>
        </div>
      </div>
    </div>
  );
}

function Rows({ rows, labels }: { rows: ProductRow[]; labels: string[] }) {
  return (
    <div className="pair-rows" role="table" aria-label="Product facts by plan" style={{ "--n": labels.length } as React.CSSProperties}>
      <div className="pair-row head" role="row">
        <span role="columnheader" />
        {labels.map((l) => (
          <span key={l} role="columnheader">
            Plan {l}
          </span>
        ))}
      </div>
      {rows.map((r, i) => (
        <div key={i} className="pair-row" role="row">
          <span className="part" role="cell">
            {PART[r.part]}
          </span>
          {r.cells.map((t, k) => (
            <span key={k} role="cell" className={t ? "" : "absent"}>
              {t ?? "not in this plan"}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function Surface({ side: s, shared, max }: { side: PlanSide; shared: Set<string>; max: number }) {
  const own = surfaceClasses(s, (k) => !shared.has(k));
  return (
    <div className="pair-cell">
      <div className="pane-tag">{shared.size ? `Plan ${s.label} only` : `Plan ${s.label}`}</div>
      <div className="pair-big">
        {plural(s.surface.methods, "public method")}
        <span>
          {plural(s.surface.params, "parameter")}
          {shared.size > 0 && ` · ${methodCount(own)} of its own`}
        </span>
      </div>
      <div className="pair-bar" aria-hidden>
        <i style={{ width: `${(100 * s.surface.methods) / max}%` }} />
      </div>
      {s.surface.classes.length === 0 && <p className="pair-none">No new public methods or models outside controllers and policies.</p>}
      {s.surface.classes.length > 0 && own.length === 0 && <p className="pair-none">None of its own: everything is shared, above.</p>}
      <SurfaceLayers classes={own} />
    </div>
  );
}

/**
 * Models, then services, then other classes: persistence apart from logic. In each, a new class
 * is all new interface; an existing one gains what is marked +.
 */
function SurfaceLayers({ classes }: { classes: SurfaceItem[] }) {
  return (
    <>
      {byLayer(classes).map((l) => (
        <div key={l.title} className="pair-group">
          <h4>{l.title}</h4>
          <ul className="pair-classes">
            {l.classes.map((k) => (
              <li key={k.name} className={k.isNew ? "new" : "existing"}>
                <div className="pair-class-name">
                  <b>{k.name}</b>
                  <span className="pair-small">
                    {k.isNew ? "new" : "existing"} {ROLE_WORD[k.role]}
                  </span>
                </div>
                {k.methods.length + k.associations.length > 0 ? (
                  <div className="pair-sigs">
                    {k.associations.map((a) => (
                      <code key={a} className="assoc">
                        {k.isNew ? a : `+ ${a}`}
                      </code>
                    ))}
                    {k.methods.map((m) => (
                      <code key={m}>{k.isNew ? m : `+ ${m}`}</code>
                    ))}
                  </div>
                ) : (
                  <p className="pair-none">No associations or public methods: persistence only.</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

/** How many unplanned classes lean on what the plan changes, the biggest first; what it only extends, and the arrow counts, beneath. */
function Tangle({ side: s }: { side: PlanSide }) {
  const k = s.coupling;
  const SHOWN = 4;
  const changed = k.hubs.filter((h) => h.changes === "behavior");
  const extended = k.hubs.filter((h) => h.changes === "extends");
  return (
    <div className="pair-cell">
      <div className="pane-tag">Plan {s.label}</div>
      <div className="pair-big">
        {plural(k.reach, "class", "classes")}
        <span>outside the plan depend on what it changes</span>
      </div>
      {changed.length > 0 ? (
        <ul className="pair-hubs">
          {changed.slice(0, SHOWN).map((h) => (
            <li key={h.name}>
              <b>{h.name}</b> <span className="pair-small">{plural(h.dependents, "class", "classes")} depend on it</span>
            </li>
          ))}
          {changed.length > SHOWN && <li className="pair-small">and {plural(changed.length - SHOWN, "more changed class", "more changed classes")}</li>}
        </ul>
      ) : (
        <p className="pair-none">It changes nothing other classes depend on.</p>
      )}
      {extended.length > 0 && (
        <p className="pair-small">
          Only extends, so callers keep working: {extended.map((h) => `${h.name} (${plural(h.dependents, "dependent")})`).join(", ")}
        </p>
      )}
      <p className="pair-small">
        {plural(k.arrows, "new dependency", "new dependencies")}, {k.crossArea} between business areas · touches {plural(k.touched, "class", "classes")} ({k.created} new, {k.reshaped} reshaped)
      </p>
    </div>
  );
}

/** The plan's classes and the classes they point at, full width so the boxes stay readable. */
function Drawing({ side: s }: { side: PlanSide }) {
  // Classes with no arrows (a policy gaining a rule, a new settings screen) are product facts above; leaving them out keeps the layers in order.
  const linked = new Set(s.drawing.edges.filter((e) => e.after > 0 && e.from !== e.to).flatMap((e) => [e.from, e.to]));
  const classes = s.drawing.classes.map((c) => c.name).filter((n) => linked.has(n));
  if (!classes.length) return null;
  return (
    <div className="pair-cell">
      <StopDiagram comparison={s.drawing} classes={classes} onOpen={() => {}} only={{ side: "after", tag: `Plan ${s.label}` }} />
    </div>
  );
}

/** Only the new dependencies `keep` picks, and the classes at their ends. */
function NewDrawing({ side: s, keep, tag }: { side: PlanSide; keep(key: string): boolean; tag: string }) {
  const drawing = useMemo((): Comparison => ({ ...s.drawing, edges: newDependencies(s).filter((e) => keep(dependencyKey(e))) }), [s, tag]);
  const linked = new Set(drawing.edges.flatMap((e) => [e.from, e.to]));
  const classes = drawing.classes.map((c) => c.name).filter((n) => linked.has(n));
  return (
    <div className="pair-cell">
      {classes.length ? (
        <StopDiagram comparison={drawing} classes={classes} onOpen={() => {}} only={{ side: "after", tag }} />
      ) : (
        <>
          <div className="pane-tag">{tag}</div>
          <p className="pair-none">No new dependencies of its own.</p>
        </>
      )}
    </div>
  );
}
