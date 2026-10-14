import type { Comparison, PlanItem, PlanSection, PlanStatus, ProductPart } from "../../../src/shared/types";
import type { PanelTab } from "../ClassPanel";

/**
 * The before-merge page: the plan laid beside what the branch built. What
 * was built but never planned comes first, since that is the part worth a
 * conversation; what was built as planned comes last.
 */

const GROUPS: { status: PlanStatus; title: string; sub: string; empty: string }[] = [
  { status: "surprise", title: "Built but not in the plan", sub: "Worth a conversation: each of these is a decision the plan did not make.", empty: "Nothing. Everything built was in the plan." },
  { status: "missing", title: "In the plan but not built", sub: "Planned, and not in the code yet.", empty: "Nothing. Everything planned is there." },
  { status: "different", title: "Different from the plan", sub: "Built, but not the way the plan said.", empty: "Nothing." },
  { status: "built", title: "As planned", sub: "", empty: "Nothing from the plan is built yet." },
];

const WHERE: Record<PlanSection, string> = {
  tables: "Data",
  lifecycles: "Lifecycle",
  screens: "Screen",
  permissions: "Permission",
  jobs: "Job",
  classes: "Class",
  flows: "Flow",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function planCounts(c: Comparison): string {
  const items = c.planCheck?.items ?? [];
  const n = (s: PlanStatus) => items.filter((i) => i.status === s).length;
  const parts = [n("surprise") && plural(n("surprise"), "surprise"), n("missing") && `${n("missing")} missing`, n("different") && `${n("different")} different`].filter(Boolean);
  return parts.length ? parts.join(" · ") : `${n("built")} as planned`;
}

export function PlanCheckPage({
  comparison: c,
  onClass,
  onProduct,
  onNext,
  nextLabel,
}: {
  comparison: Comparison;
  onClass(name: string, tab?: PanelTab): void;
  onProduct(part: ProductPart): void;
  onNext?: () => void;
  nextLabel: string;
}) {
  const plan = c.plan!;
  const items = c.planCheck?.items ?? [];
  const open = (i: PlanItem) => {
    if (!i.target) return;
    if (i.target.kind === "class") onClass(i.target.name, i.target.method ? "code" : "shape");
    else onProduct(i.target.part);
  };
  return (
    <article className="stop plan-check" key="plan-check">
      <div className="stop-meta">Before merge</div>
      <h2 className="stop-heading">Plan check</h2>
      <p className="stop-explain">
        The plan, <b>{plan.title}</b>, laid beside what <b>{c.head.ref}</b> built.{plan.why ? ` ${plan.why}` : ""}
      </p>
      {plan.problems.length > 0 && (
        <div className="callout">
          Refract could not read {plural(plan.problems.length, "line")} of the plan, so {plan.problems.length === 1 ? "it was" : "they were"} left out:
          <ul className="plan-problems">
            {plan.problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {GROUPS.map((g) => {
        const list = items.filter((i) => i.status === g.status);
        return (
          <section key={g.status} className={`plan-group ${g.status}`}>
            <h3>
              {g.title} <span className="n">{list.length}</span>
            </h3>
            {g.sub && list.length > 0 && <p className="sub">{g.sub}</p>}
            {list.length === 0 ? (
              <p className="planned-note">{g.empty}</p>
            ) : (
              <ul className="plan-items">
                {list.map((i, j) => {
                  const body = (
                    <>
                      <span className="where">{WHERE[i.section]}</span>
                      <span className="what">
                        <span>{i.text}</span>
                        {i.detail && <span className="detail">{i.detail}</span>}
                      </span>
                    </>
                  );
                  return (
                    <li key={j}>
                      {i.target ? (
                        <button onClick={() => open(i)} title={i.target.kind === "class" ? `Open ${i.target.name}` : "Show it on the product page"}>
                          {body}
                        </button>
                      ) : (
                        <div>{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
      <details className="how made">
        <summary>How this check works</summary>
        <p>
          Refract reads the plan in <code>{plan.file}</code> and compares each line with what it reads from the code at the newest commit: tables and columns from <code>db/schema.rb</code>, states and moves from the models, controller actions, policy rules, jobs, each class's public methods and what it depends on, and the calls in the code for each flow. Edit the plan and this page follows. To see the plan drawn on its own, run <code>refract --plan {plan.name}</code>.
        </p>
      </details>
      {onNext && (
        <footer className="stop-foot">
          <span />
          <span />
          <button className="btn primary" onClick={onNext}>
            {nextLabel} →
          </button>
        </footer>
      )}
    </article>
  );
}
