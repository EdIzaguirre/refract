import type { Comparison, Delta } from "../../src/shared/types";
import type { Mode } from "./App";

export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M3 20 L12 4 L21 20 Z" />
      <path d="M2 12 H9" />
      <path d="M14.5 10.5 L22 7" />
      <path d="M14.5 12.5 L22 12" />
      <path d="M14.5 14.5 L22 17" />
    </svg>
  );
}

export function VerdictStrip({
  comparison: c,
  mode,
  onMode,
  status,
  watching,
  onDelta,
}: {
  comparison: Comparison | null;
  mode: Mode;
  onMode(m: Mode): void;
  status: string;
  watching: string | null;
  onDelta(t?: Delta["target"]): void;
}) {
  return (
    <header className="strip">
      <div className="strip-top">
        <div className="brand">
          <Logo />
          Refract
        </div>
        {c && (
          <div className="refs">
            <span>{c.repo.name}</span>
            <span>·</span>
            <b>{c.base.short}</b>
            <span>→</span>
            <b>{c.head.short}</b>
            <span className="subject" title={c.head.subject}>
              {c.head.subject}
            </span>
            <span>
              · {c.stats.files} files · +{c.stats.additions} −{c.stats.deletions}
            </span>
          </div>
        )}
        <div className="spacer" />
        {watching && (
          <span className="status" title={status}>
            <span className="live-dot" /> watching <b>{watching}</b>
          </span>
        )}
        <span className="status" title={status}>
          {status}
        </span>
        <div className="seg" role="group" aria-label="Before or after">
          {(["before", "after", "split"] as Mode[]).map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => onMode(m)}>
              {m === "split" ? "Side by side" : m[0].toUpperCase() + m.slice(1)}
              <kbd>{m === "split" ? "s" : m === "before" ? "space" : ""}</kbd>
            </button>
          ))}
        </div>
      </div>
      {c && (
        <>
          <div className="verdict-line">
            <span className={`verdict-label ${c.verdict.tone}`}>{c.verdict.label}</span>
            <span className="summary">{c.verdict.summary}</span>
          </div>
          <div className="deltas">
            {c.deltas.map((d) => (
              <button key={d.id} className="delta" onClick={() => onDelta(d.target)} title={d.why}>
                <span className="what">{d.what}</span>
                <span className="nums">
                  {d.before != null && <span className="b">{d.before}</span>}
                  {d.before != null && <span style={{ color: "var(--muted)" }}>→</span>}
                  <span>{d.after}</span>
                  <span className={`pill ${d.tone}`}>{d.change}</span>
                </span>
                <span className="why">{d.why}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </header>
  );
}
