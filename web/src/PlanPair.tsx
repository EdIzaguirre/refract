import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PlanComparison, PlanSide, ProductPart, ProductRow } from "../../src/shared/types";
import { type SurfaceItem, byLayer, methodCount, sharedSurface, surfaceClasses } from "../../src/shared/plan-surface";
import { Logo } from "./VerdictStrip";
import { TablesDiagram } from "./tour/Product";
import { ROLE_WORD, StopDiagram } from "./tour/StopDiagram";
import { drawTogether } from "../../src/shared/plan-dependencies";
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
  const [focus, setFocus] = useState<string | null>(null);
  const together = useMemo(() => drawTogether(pair.sides, today), [pair, today]);
  const sameSurface = useMemo(() => sharedSurface(pair.sides), [pair]);
  const sameClasses = useMemo(() => surfaceClasses(pair.sides[0], (k) => sameSurface.has(k)), [pair, sameSurface]);
  // Once the plan cards scroll away, the header names each plan, so "Plan C" never needs a trip back up.
  const heads = useRef<HTMLDivElement>(null);
  const [headsGone, setHeadsGone] = useState(false);
  useEffect(() => {
    const el = heads.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setHeadsGone(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
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
        {headsGone && (
          <div className="pair-legend" style={cols}>
            {pair.sides.map((s) => (
              <button key={s.label} type="button" title={`${s.plan.title}: show only this plan in the drawing`} className={focus === s.label ? "on" : ""} onClick={() => setFocus(focus === s.label ? null : s.label)}>
                <b>{s.label}</b> {s.plan.title}
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="main tour-main">
        <div className="tour-stage">
          <article className="stop plan-pair">
            <div className="stop-meta">
              Design it twice <span className="plan-tag">planned</span>
            </div>
            <div className="pair-cols" style={cols} ref={heads}>
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
              <h3>Existing code each plan touches</h3>
              <p className="product-note">
                Each existing class a plan reshapes, most depended on first. <b>Depended on by</b> is measured from today&apos;s code: the classes that name it, inheritance aside. Each plan&apos;s cell is what that plan says it does to the class, in its own words: what it adds (+), what it takes away (−), or its note. Whether callers have to change is yours to judge.
              </p>
              <Existing rows={pair.existing} labels={pair.sides.map((s) => s.label)} every={every} />
            </section>

            <section className="product-part">
              <h3>The classes each plan adds and what they depend on</h3>
              <PlanSwitch labels={pair.sides.map((s) => s.label)} titles={pair.sides.map((s) => s.plan.title)} focus={focus} onFocus={setFocus} />
              <label className="pair-toggle">
                <input type="checkbox" checked={today} onChange={(e) => setToday(e.target.checked)} /> Also draw the dependencies that are there today
              </label>
              <div className="pair-drawings">
                {together.classes.length ? (
                  <div className="pair-cell together">
                    <StopDiagram
                      comparison={together.drawing}
                      classes={together.classes}
                      onOpen={() => {}}
                      only={{ side: "after", tag: focus ? `Plan ${focus}: ${pair.sides.find((s) => s.label === focus)!.plan.title}` : `All ${n} plans` }}
                      plans={{ classes: together.members, edges: together.edgeMembers, focus }}
                    />
                  </div>
                ) : (
                  <p className="pair-none">No plan adds a dependency.</p>
                )}
              </div>
              <p className="product-note">
                Every plan&apos;s classes are drawn in one layout, so each class keeps its place whichever plan you look at. The letters under a box say which plans have it; pick a plan to fade out everything it doesn&apos;t have.{" "}
                {today ? "Green arrows are new dependencies; grey ones are there today." : "Only new dependencies are drawn."} Dashed boxes are planned. Bands run top to bottom: controllers, views (helpers and components), services and jobs, then models, so an arrow pointing up stands out.
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

/** One row per existing class with a cell per plan; rows every plan writes alike fold into one list beneath. */
function Existing({ rows, labels, every }: { rows: PlanComparison["existing"]; labels: string[]; every: string }) {
  if (!rows.length) return <p className="pair-none">No plan reshapes an existing class.</p>;
  const apart = rows.filter((r) => r.where === "some");
  const same = rows.filter((r) => r.where === "all");
  return (
    <>
      {apart.length > 0 && (
        <div className="pair-rows existing" role="table" aria-label="Existing classes each plan touches" style={{ "--n": labels.length } as React.CSSProperties}>
          <div className="pair-row head" role="row">
            <span role="columnheader">Class · depended on by</span>
            {labels.map((l) => (
              <span key={l} role="columnheader">
                Plan {l}
              </span>
            ))}
          </div>
          {apart.map((r) => (
            <div key={r.name} className="pair-row" role="row">
              <span className="part" role="cell">
                <code>{r.name}</code> <b>{r.dependents}</b>
              </span>
              {r.cells.map((t, k) => (
                <span key={k} role="cell" className={t ? "" : "absent"}>
                  {t ?? "untouched"}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
      {same.length > 0 && (
        <details className="product-more" open={apart.length === 0}>
          <summary>
            The same in {every} ({same.length})
          </summary>
          <ul>
            {same.map((r) => (
              <li key={r.name}>
                <code>{r.name}</code> <b>{r.dependents}</b>: {r.cells[0]}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/** All plans, or one: the drawing fades whatever the chosen plan does not have. */
function PlanSwitch({ labels, titles, focus, onFocus }: { labels: string[]; titles: string[]; focus: string | null; onFocus(l: string | null): void }) {
  return (
    <div className="pair-switch" role="group" aria-label="Plan to show">
      <button type="button" className={focus === null ? "on" : ""} onClick={() => onFocus(null)}>
        All plans
      </button>
      {labels.map((l, i) => (
        <button key={l} type="button" title={titles[i]} className={focus === l ? "on" : ""} onClick={() => onFocus(l)}>
          {l}
        </button>
      ))}
    </div>
  );
}
