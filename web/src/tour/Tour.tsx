import { useEffect, useState } from "react";
import { ClassPanel, type PanelTab } from "../ClassPanel";
import type { Comparison, LensId, LensQuestion, LensReport, Story } from "../../../src/shared/types";
import { StopDiagram, shortName } from "./StopDiagram";

const WHO: Record<LensId, string> = { metz: "Sandi Metz", ousterhout: "John Ousterhout", copeland: "David Bryant Copeland" };
const TONE_WORD = { good: "Better", bad: "Worse", ask: "A question", flat: "Context" } as const;

/**
 * The default view: the change told as a short tour. A plain summary, then
 * a few stops, each with a small before/after drawing of only the classes
 * it is about and what the lenses asked about them.
 */
export function Tour({
  comparison: c,
  story,
  storyMissing,
  lenses,
  stop,
  onStop,
  onOpen,
  onTell,
}: {
  comparison: Comparison;
  story: Story | null;
  storyMissing: boolean;
  lenses: LensReport | null;
  stop: number;
  onStop(i: number): void;
  onOpen(name: string): void;
  onTell(): void;
}) {
  const stops = story?.stops ?? [];
  const i = Math.min(stop, Math.max(0, stops.length - 1));
  const current = stops[i];
  // Clicking a box opens that class's panel over the summary, without leaving it.
  const [modal, setModal] = useState<string | null>(null);
  const [tab, setTab] = useState<PanelTab>("shape");
  const modalChange = modal ? (c.classes.find((k) => k.name === modal) ?? null) : null;
  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal]);
  useEffect(() => {
    document.querySelector(".tour-stage")?.scrollTo({ top: 0, behavior: "smooth" });
  }, [i]);

  return (
    <div className="tour">
      <aside className="tour-nav">
        <div className="kicker">What this change does</div>
        <h1 className="tour-summary">{story?.summary ?? c.verdict.summary}</h1>
        {stops.length > 0 && <Verdict stops={stops} />}
        {stops.length > 0 && <div className="kicker">Key changes</div>}
        <ol className="tour-stops">
          {stops.map((s, j) => (
            <li key={s.id}>
              <button aria-current={j === i} onClick={() => onStop(j)}>
                <span className={`stop-num ${s.tone}`}>{j + 1}</span>
                <span className="stop-title">{s.title}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="tour-source">
          {story?.status === "running" ? (
            <>
              <span className="spinner small" /> Claude Code is writing a plainer version of this summary.
            </>
          ) : story?.source === "claude" || !story ? null : (
            <button className="linkish" onClick={onTell}>
              Ask Claude Code to write this summary
            </button>
          )}
        </div>
        {story && (
          <details className="how made">
            <summary>How this summary was made</summary>
            {story.source === "claude" ? (
              <p>
                Refract measured every class at the start of the branch and at its newest commit: its size, its public methods and what it depends on. Claude Code read those measurements, the diff and the questions from the three books, then picked the 3 to 5 changes that matter most to the code's structure and wrote each one up, most important first. The drawings come from the measurements, not from Claude.
              </p>
            ) : (
              <p>
                Refract measured every class at the start of the branch and at its newest commit: its size, its public methods and what it depends on. Each key change here is one of the measured shifts that stood out, such as a class many others use getting fewer callers, a large class growing or shrinking, or new classes. Claude Code has not written this one up yet.
              </p>
            )}
          </details>
        )}
        <HowToRead />
      </aside>

      <section className="tour-stage">
        {current ? (
          <article className="stop" key={`${story?.source}-${current.id}`}>
            <div className="stop-meta">
              Change {i + 1} of {stops.length}
              <span className={`pill ${current.tone}`}>{TONE_WORD[current.tone]}</span>
            </div>
            <h2 className="stop-heading">{current.title}</h2>
            <p className="stop-explain">{current.explain}</p>
            <StopDiagram
              comparison={c}
              classes={current.classes}
              onOpen={(name) => {
                setTab("shape");
                setModal(name);
              }}
            />
            <p className="stop-look">
              <EyeIcon /> {current.look}
            </p>
            <LensNotes lenses={lenses} classes={current.classes} />
            <footer className="stop-foot">
              <button className="btn" disabled={i === 0} onClick={() => onStop(i - 1)}>
                ← Back
              </button>
              <button className="btn ghost" onClick={() => onOpen(current.classes[0])}>
                Explore {shortName(current.classes[0])} in the map
              </button>
              <button className="btn primary" disabled={i === stops.length - 1} onClick={() => onStop(i + 1)}>
                Next →
              </button>
            </footer>
          </article>
        ) : !story ? (
          <div className="stop empty">
            {storyMissing ? (
              <>
                <h2 className="stop-heading">Restart Refract to see the summary</h2>
                <p className="stop-explain">
                  This page is newer than the Refract server running it. Stop <code>refract</code> with Ctrl-C and start it again; the Explore view works meanwhile.
                </p>
              </>
            ) : (
              <>
                <h2 className="stop-heading">Preparing the summary</h2>
                <p className="stop-explain">
                  <span className="spinner small" /> Measuring this commit.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="stop empty">
            <h2 className="stop-heading">Nothing structural to show</h2>
            <p className="stop-explain">No class changed shape or dependencies in this range. The Explore view still shows the files that changed.</p>
          </div>
        )}
      </section>
      {modalChange && (
        <div className="modal-back" onClick={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="modal" role="dialog" aria-modal="true">
            <ClassPanel
              key={modalChange.name}
              change={modalChange}
              comparison={c}
              lenses={lenses}
              head={c.head.sha}
              tab={tab}
              onTab={setTab}
              onClose={() => setModal(null)}
              onGo={setModal}
            />
            <button className="btn ghost modal-map" onClick={() => onOpen(modalChange.name)}>
              Show {shortName(modalChange.name)} in the map
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The verdict, counted over the key changes the reader can see. */
function Verdict({ stops }: { stops: Story["stops"] }) {
  const n = (t: string) => stops.filter((s) => s.tone === t).length;
  const good = n("good");
  const bad = n("bad");
  const ask = n("ask");
  const [label, tone] =
    good > bad
      ? [bad === 0 ? "Better" : "Mostly better", "good"]
      : bad > good
        ? [good === 0 ? "Worse" : "Mostly worse", "bad"]
        : good > 0
          ? ["Mixed", "ask"]
          : ask > 0
            ? ["Open questions", "ask"]
            : ["Neutral", "flat"];
  const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const parts = [
    good && plural(good, "makes the code better", "make the code better"),
    bad && plural(bad, "makes it worse", "make it worse"),
    ask && plural(ask, "is an open question", "are open questions"),
  ].filter(Boolean) as string[];
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return (
    <div className="tour-verdict">
      <span className={`verdict-label ${tone}`}>{label}</span>
      {list && (
        <span className="tour-counts">
          Of the {stops.length} key changes below, {list}.
        </span>
      )}
    </div>
  );
}

/** What the lenses said about this stop's classes: at most three, the most pointed first. */
function LensNotes({ lenses, classes }: { lenses: LensReport | null; classes: string[] }) {
  if (!lenses || lenses.status === "idle") return null;
  const names = new Set(classes);
  // Which of the stop's classes a question is about; the stop's main class comes first.
  const about = (q: LensQuestion) => {
    const n = q.target?.name.split(/[#.]/)[0];
    if (!n) return -1;
    return classes.findIndex((c) => c === n || c.endsWith(`::${n}`));
  };
  const rank = { worries: 0, asks: 1, likes: 2 } as const;
  const notes = lenses.lenses
    .flatMap((l) => l.questions.map((q) => ({ lens: l.lens, q, at: about(q) })))
    .filter((x) => x.at >= 0 && names.size > 0)
    .sort((a, b) => a.at - b.at || rank[a.q.tone] - rank[b.q.tone])
    .slice(0, 3);
  if (!notes.length) return null;
  return (
    <div className="stop-lenses">
      <div className="kicker">What the books ask about this</div>
      {notes.map(({ lens, q }, j) => (
        <div key={j} className="stop-lens">
          <div className="who">
            {WHO[lens]} <span className={`pill ${q.tone}`}>{q.tone}</span>
          </div>
          <p>{q.text}</p>
        </div>
      ))}
    </div>
  );
}

function HowToRead() {
  return (
    <details className="how">
      <summary>How to read the drawings</summary>
      <div className="how-row">
        <svg width="46" height="34" viewBox="0 0 46 34" aria-hidden>
          <rect x="2" y="8" width="12" height="24" rx="2" className="how-box" />
          <rect x="22" y="22" width="22" height="10" rx="2" className="how-box" />
        </svg>
        <span>
          Each box is a class. <b>Width</b> is how many public methods it has; <b>height</b> is how much code it holds. Narrow and tall means a lot of work behind a small interface.
        </span>
      </div>
      <div className="how-row">
        <svg width="46" height="16" viewBox="0 0 46 16" aria-hidden>
          <path d="M2 4H40" className="fig-edge new" />
          <path d="M2 12H40" className="fig-edge gone" />
        </svg>
        <span>
          Arrows point from a class to one it uses. <b className="t-good">Green</b> is new, <b className="t-bad">dashed red</b> went away.
        </span>
      </div>
      <div className="how-row">
        <svg width="46" height="16" viewBox="0 0 46 16" aria-hidden>
          <rect x="2" y="2" width="16" height="12" rx="2" className="fig-box-new" />
          <rect x="26" y="2" width="16" height="12" rx="2" className="fig-box-changed" />
        </svg>
        <span>Filled teal is a new class; a teal outline is one that changed. Click any box for its details.</span>
      </div>
    </details>
  );
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
