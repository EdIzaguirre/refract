import type { Comparison, Delta, Timeline } from "../../src/shared/types";
import { RangeLine } from "./RangeLine";
import type { Screen } from "./App";
import { ViewSwitch } from "./Views";

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
  screen,
  onScreen,
  watching,
  timeline,
  more,
  onMore,
}: {
  comparison: Comparison | null;
  screen: Screen;
  onScreen(s: Screen): void;
  watching: string | null;
  timeline: Timeline | null;
  more: boolean;
  onMore(): void;
}) {
  return (
    <header className="strip">
      <div className="strip-top">
        <ViewSwitch />
        {c && (
          <div className="refs">
            <span>{c.repo.name}</span>
            <RangeLine comparison={c} timeline={timeline} watching={watching} />
          </div>
        )}
        <div className="spacer" />
        {screen === "explore" && (
          <button className={`btn more ${more ? "on" : ""}`} aria-pressed={more} onClick={onMore} title="The numbers, what the authors think, and the commits one by one (m)">
            {more ? "Less" : "More"}
          </button>
        )}
        <div className="seg views" role="group" aria-label="View">
          {(["tour", "explore"] as Screen[]).map((v) => (
            <button key={v} aria-pressed={screen === v} onClick={() => onScreen(v)} title={v === "tour" ? "The key changes, explained (t)" : "Poke around the whole codebase (e)"}>
              {v === "tour" ? "Summary" : "Explore"}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}

/** The verdict and the measures that moved, for the More drawer. */
export function Numbers({ comparison: c, onDelta }: { comparison: Comparison; onDelta(t?: Delta["target"]): void }) {
  return (
    <section className="numbers">
      <h2>The numbers</h2>
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
    </section>
  );
}
