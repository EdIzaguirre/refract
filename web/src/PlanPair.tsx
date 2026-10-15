import type { PlanComparison, PlanSide, ProductPart, ProductRow } from "../../src/shared/types";
import { Logo } from "./VerdictStrip";
import { TablesDiagram } from "./tour/Product";
import { ROLE_WORD, StopDiagram, shortName } from "./tour/StopDiagram";
import { Mermaid } from "./Mermaid";
import { toMermaid } from "./ClassPanel";

/**
 * Two plans for one goal, side by side: Ousterhout's "design it twice".
 * Product first, then what the rest of the code must learn, how tangled each
 * plan is, the same request under each, and one short note from the book.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const PART: Record<ProductPart, string> = { data: "Data", lifecycles: "Lifecycle", screens: "Screen", permissions: "Permissions", jobs: "Job" };

export function PlanPair({ pair }: { pair: PlanComparison }) {
  const [A, B] = pair.sides;
  const apart = pair.product.filter((r) => r.where !== "both");
  const same = pair.product.filter((r) => r.where === "both");
  const anyTables = A.product.tables.length + B.product.tables.length > 0;
  const problems = pair.sides.filter((s) => s.plan.problems.length);
  return (
    <div className="app">
      <header className="strip">
        <div className="strip-top">
          <div className="brand">
            <Logo />
            Refract
          </div>
          <div className="refs">
            <span>{A.drawing.repo.name}</span>
            <span className="range-line">
              <b>Two plans</b> for one goal, drawn against <b>{pair.base.ref}</b> as it is today
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
            <div className="pair-cols">
              {pair.sides.map((s) => (
                <div key={s.label} className="pair-head">
                  <span className="pair-label">Plan {s.label}</span>
                  <h2>{s.plan.title}</h2>
                  {s.plan.why && <p>{s.plan.why}</p>}
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
                  ? `Both plans build the same product: ${plural(same.length, "change")} to tables, states, screens and rules. The difference is only in the code.`
                  : `They agree on ${plural(same.length, "thing")} and part ways on ${apart.length}.`}
              </p>
              {apart.length > 0 && <Rows rows={apart} />}
              {same.length > 0 && (
                <details className="product-more" open={apart.length === 0}>
                  <summary>The same in both ({same.length})</summary>
                  <ul>
                    {same.map((r, i) => (
                      <li key={i}>{r.a}</li>
                    ))}
                  </ul>
                </details>
              )}
              {anyTables && (
                <div className="pair-cols">
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
              <div className="pair-cols">
                {pair.sides.map((s) => (
                  <Surface key={s.label} side={s} max={Math.max(A.surface.methods, B.surface.methods, 1)} />
                ))}
              </div>
            </section>

            <section className="product-part">
              <h3>How tangled each plan is</h3>
              <div className="pair-cols">
                {pair.sides.map((s) => (
                  <Tangle key={s.label} side={s} />
                ))}
              </div>
              <div className="pair-drawings">
                {pair.sides.map((s) => (
                  <Drawing key={s.label} side={s} />
                ))}
              </div>
              <p className="product-note">Dashed boxes are planned; classes with no arrows are left out. Green arrows are dependencies the plan adds; grey ones are there today. Boxes sit in Rails layers: controllers, then services and jobs, then models.</p>
            </section>

            {pair.flows.length > 0 && (
              <section className="product-part">
                <h3>The same request under each plan</h3>
                {pair.flows.map((p, i) => (
                  <div key={i} className="pair-flow">
                    <h4>{p.title}</h4>
                    <div className="pair-cols">
                      {pair.sides.map((s) => {
                        const at = s.label === "A" ? p.a : p.b;
                        const f = at === undefined ? null : s.flows[at];
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

function Rows({ rows }: { rows: ProductRow[] }) {
  return (
    <div className="pair-rows" role="table" aria-label="Product facts by plan">
      <div className="pair-row head" role="row">
        <span role="columnheader" />
        <span role="columnheader">Plan A</span>
        <span role="columnheader">Plan B</span>
      </div>
      {rows.map((r, i) => (
        <div key={i} className={`pair-row ${r.where}`} role="row">
          <span className="part" role="cell">
            {PART[r.part]}
          </span>
          <span role="cell" className={r.a ? "" : "absent"}>
            {r.a ?? "not in this plan"}
          </span>
          <span role="cell" className={r.b ? "" : "absent"}>
            {r.b ?? "not in this plan"}
          </span>
        </div>
      ))}
    </div>
  );
}

function Surface({ side: s, max }: { side: PlanSide; max: number }) {
  return (
    <div className="pair-cell">
      <div className="pane-tag">Plan {s.label}</div>
      <div className="pair-big">
        {plural(s.surface.methods, "public method")}
        <span>{plural(s.surface.params, "parameter")}</span>
      </div>
      <div className="pair-bar" aria-hidden>
        <i style={{ width: `${(100 * s.surface.methods) / max}%` }} />
      </div>
      {s.surface.classes.length === 0 && <p className="pair-none">No new public methods outside controllers and policies.</p>}
      <ul className="pair-classes">
        {s.surface.classes.map((k) => (
          <li key={k.name}>
            <b>{shortName(k.name)}</b>
            <span className="pair-small">
              {k.isNew ? "new" : "existing"} {ROLE_WORD[k.role]}
            </span>
            <div className="pair-sigs">
              {k.methods.map((m) => (
                <code key={m}>{m}</code>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tangle({ side: s }: { side: PlanSide }) {
  const k = s.coupling;
  return (
    <div className="pair-cell">
      <div className="pane-tag">Plan {s.label}</div>
      <div className="pair-big">
        {plural(k.arrows, "new arrow")}
        <span>
          {k.crossArea} between business areas · touches {plural(k.touched, "class", "classes")} ({k.created} new, {k.reshaped} reshaped)
        </span>
      </div>
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
