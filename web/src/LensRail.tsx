import type { ReactNode } from "react";
import type { Comparison, LensId, LensQuestion, LensReport } from "../../src/shared/types";

export const LENS_INFO: Record<LensId, { who: string; book: string; initials: string }> = {
  metz: { who: "Sandi Metz", book: "Practical Object-Oriented Design", initials: "SM" },
  ousterhout: { who: "John Ousterhout", book: "A Philosophy of Software Design", initials: "JO" },
  copeland: { who: "David Bryant Copeland", book: "Sustainable Web Development with Rails", initials: "DC" },
};
const ORDER: LensId[] = ["metz", "ousterhout", "copeland"];

export function LensRail({
  report,
  comparison,
  onRun,
  onTarget,
  children,
}: {
  report: LensReport | null;
  comparison: Comparison | null;
  onRun(): void;
  onTarget(t?: LensQuestion["target"]): void;
  children?: ReactNode;
}) {
  const running = report?.status === "running";
  const has = report && report.lenses.some((l) => l.questions.length);
  return (
    <aside className="rail" aria-label="More">
      {children}
      <div className="rail-head">
        <h2>What the authors think</h2>
        <button className={`btn ${has ? "" : "primary"}`} onClick={onRun} disabled={running || !comparison}>
          {running ? <span className="spinner" /> : null}
          {running ? "Asking…" : has ? "Ask again" : "Ask the lenses"}
        </button>
      </div>
      {!has && !running && (
        <div className="empty">
          <p style={{ margin: 0 }}>
            Metz, Ousterhout and Copeland read the measurements and the diff and answer with pointed questions, each tied to a rule in their book. They run
            through your Claude Code, on demand, and on their own once a watched branch goes quiet.
          </p>
          {report?.status === "error" && <div className="callout">Last run failed: {report.error}</div>}
        </div>
      )}
      {ORDER.map((id) => {
        const info = LENS_INFO[id];
        const result = report?.lenses.find((l) => l.lens === id);
        if (!result && !running) return null;
        return (
          <section key={id} className="lens">
            <div className="lens-who">
              <div className={`avatar ${id}`}>{info.initials}</div>
              <div>
                <div className="n">{info.who}</div>
                <div className="b">{info.book}</div>
              </div>
            </div>
            {!result && running && (
              <div style={{ display: "grid", gap: 6 }}>
                <div className="skeleton" style={{ width: "90%" }} />
                <div className="skeleton" style={{ width: "70%" }} />
                <div className="skeleton" style={{ width: "80%" }} />
              </div>
            )}
            {result?.error && <div className="callout">{result.error}</div>}
            {result?.questions.map((q, i) => (
              <div key={i} className="q" role="button" tabIndex={0} onClick={() => onTarget(q.target)} onKeyDown={(e) => e.key === "Enter" && onTarget(q.target)}>
                <div className="top">
                  <span className={`pill ${q.tone}`}>{q.tone}</span>
                  {q.target && <span className="target">{q.target.name}</span>}
                </div>
                <div className="text">{q.text}</div>
                <div className="ev">{q.evidence}</div>
                <div className="src">
                  {q.source}
                  {q.quote ? `: “${q.quote.replace(/^["“]|["”]$/g, "")}”` : ""}
                </div>
              </div>
            ))}
          </section>
        );
      })}
      {report?.disagreements.map((d, i) => (
        <section key={i} className="disagree" onClick={() => onTarget(d.target)}>
          <h3>Where they disagree: {d.topic}</h3>
          <div className="pos">
            {ORDER.filter((id) => d.positions[id]).map((id) => (
              <div key={id} style={{ display: "contents" }}>
                <b>{LENS_INFO[id].who.split(" ").pop()}</b>
                <span>{d.positions[id]}</span>
              </div>
            ))}
          </div>
          <div className="tradeoff">{d.tradeoff}</div>
        </section>
      ))}
      {report?.finishedAt && (
        <div className="rail-note">
          Asked {new Date(report.finishedAt).toLocaleString()} about {report.head.slice(0, 8)}. Follow up in Claude Code with <code>/refract</code>.
        </div>
      )}
    </aside>
  );
}
