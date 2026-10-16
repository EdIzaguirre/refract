import { useEffect, useMemo, useState } from "react";
import { ClassPanel, type PanelTab } from "../ClassPanel";
import type { Comparison, LensId, LensQuestion, LensReport, Story } from "../../../src/shared/types";
import { StopDiagram, shortName } from "./StopDiagram";
import { MethodCode, resolveTarget } from "./MethodCode";
import { LENS_INFO } from "../LensRail";
import { ProductPage, hasProduct, productCounts } from "./Product";

interface Note {
  lens: LensId;
  q: LensQuestion;
}

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
  onAskBooks,
}: {
  comparison: Comparison;
  story: Story | null;
  storyMissing: boolean;
  lenses: LensReport | null;
  stop: number;
  onStop(i: number): void;
  onOpen(name: string): void;
  onTell(again?: boolean): void;
  onAskBooks(): void;
}) {
  const stops = story?.stops ?? [];
  // Each key change carries the one sharpest question from the books; the books' overall take,
  // where they disagree and every other question live on one page after the key changes.
  const picks = useMemo(() => pickQuestions(lenses, stops), [lenses, stops]);
  // Pages: what changed in the product (when anything did), the key changes, then the books.
  const P = hasProduct(c.product) ? 1 : 0;
  const pages = P + stops.length + (stops.length ? 1 : 0);
  const page = Math.min(stop, Math.max(0, pages - 1));
  const onProduct = P === 1 && page === 0;
  const i = page - P;
  const current = i >= 0 ? stops[i] : undefined;
  const onBooks = !onProduct && !current && stops.length > 0 && i === stops.length;
  // Clicking a box opens that class's panel over the summary, without leaving it. Following a
  // dependency inside the panel keeps a trail, so Back and Forward work like a browser's.
  const [trail, setTrail] = useState<{ names: string[]; at: number }>({ names: [], at: -1 });
  const modal = trail.names[trail.at] ?? null;
  const [tab, setTab] = useState<PanelTab>("shape");
  const openClass = (name: string, t: PanelTab = "shape") => {
    setTab(t);
    setTrail({ names: [name], at: 0 });
  };
  const goClass = (name: string) => setTrail((tr) => ({ names: [...tr.names.slice(0, tr.at + 1), name], at: tr.at + 1 }));
  const step = (d: number) => setTrail((tr) => ({ ...tr, at: Math.max(0, Math.min(tr.names.length - 1, tr.at + d)) }));
  const closeModal = () => setTrail({ names: [], at: -1 });
  const modalChange = modal ? (c.classes.find((k) => k.name === modal) ?? null) : null;
  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        step(e.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal]);
  useEffect(() => {
    document.querySelector(".tour-stage")?.scrollTo({ top: 0, behavior: "smooth" });
  }, [page]);

  return (
    <div className="tour">
      <aside className="tour-nav">
        <div className="kicker">What this change does</div>
        <h1 className="tour-summary">{story?.summary ?? c.verdict.summary}</h1>
        {P === 1 && (
          <ol className="tour-stops product-link">
            <li>
              <button aria-current={onProduct} onClick={() => onStop(0)}>
                <span className="stop-num flat">
                  <TableIcon />
                </span>
                <span className="stop-title">
                  What changed in the product
                  <span className="stop-sub">{productCounts(c.product!).slice(0, 3).map((x) => x.text).join(" · ")}</span>
                </span>
              </button>
            </li>
          </ol>
        )}
        {stops.length > 0 && <div className="kicker">How the code changed</div>}
        {stops.length > 0 && <Verdict stops={stops} />}
        <ol className="tour-stops">
          {stops.map((s, j) => (
            <li key={s.id}>
              <button aria-current={j === i} onClick={() => onStop(P + j)}>
                <span className={`stop-num ${s.tone}`}>{j + 1}</span>
                <span className="stop-title">{s.title}</span>
              </button>
            </li>
          ))}
        </ol>
        {stops.length > 0 && (
          <ol className="tour-stops books-link">
            <li>
              <button aria-current={onBooks} onClick={() => onStop(P + stops.length)}>
                <span className="stop-num flat">
                  <BookIcon />
                </span>
                <span className="stop-title">What the authors think</span>
              </button>
            </li>
          </ol>
        )}
        <div className="tour-source">
          {story?.status === "running" ? (
            <>
              <span className="spinner small" /> Claude Code is writing a plainer version of this summary.
            </>
          ) : story?.source === "claude" || !story ? null : (
            <button className="linkish" onClick={() => onTell()}>
              Ask Claude Code to write this summary
            </button>
          )}
        </div>
        {story && (
          <details className="how made">
            <summary>How this summary was made</summary>
            {story.source === "claude" ? (
              <p>
                Refract measured every class at the start of the branch and at its newest commit: its size, its public methods and what it depends on. Claude Code read those measurements, the diff and the notes from the three authors, then picked the 3 to 5 changes that matter most to the code's structure and wrote each one up, most important first. The drawings come from the measurements, not from Claude.{" "}
                <button className="linkish" onClick={() => onTell(true)}>
                  Write it again
                </button>
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
        {onProduct ? (
          <ProductPage product={c.product!} story={story} onNext={() => onStop(1)} />
        ) : current ? (
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
              onOpen={(name) => openClass(name)}
            />
            <p className="stop-look">
              <EyeIcon /> {current.look}
            </p>
            {picks.byStop[i] && <BookLine comparison={c} note={picks.byStop[i]!} onOpen={openClass} />}
            <footer className="stop-foot">
              <button className="btn" disabled={page === 0} onClick={() => onStop(page - 1)}>
                ← Back
              </button>
              <button className="btn ghost" onClick={() => onOpen(current.classes[0])}>
                Explore {shortName(current.classes[0])} in the map
              </button>
              <button className="btn primary" disabled={page === pages - 1} onClick={() => onStop(page + 1)}>
                Next →
              </button>
            </footer>
          </article>
        ) : onBooks ? (
          <BooksPage comparison={c} lenses={lenses} rest={picks.rest} onOpen={openClass} onAsk={onAskBooks} onBack={() => onStop(page - 1)} />
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
        <div className="modal-back" onClick={(e) => e.target === e.currentTarget && closeModal()}>
          <div className="modal" role="dialog" aria-modal="true">
            {trail.names.length > 1 && (
              <nav className="modal-trail" aria-label="Classes you opened">
                <button className="btn" disabled={trail.at === 0} onClick={() => step(-1)} title="Back (←)">
                  ← {trail.at > 0 ? shortName(trail.names[trail.at - 1]) : "Back"}
                </button>
                <span className="modal-trail-path">
                  {trail.names.map((n, j) => (
                    <button key={j} className={`linkish ${j === trail.at ? "here" : ""}`} onClick={() => setTrail((tr) => ({ ...tr, at: j }))}>
                      {shortName(n)}
                    </button>
                  ))}
                </span>
                <button className="btn" disabled={trail.at === trail.names.length - 1} onClick={() => step(1)} title="Forward (→)">
                  {trail.at < trail.names.length - 1 ? shortName(trail.names[trail.at + 1]) : "Forward"} →
                </button>
              </nav>
            )}
            <ClassPanel
              key={modalChange.name}
              change={modalChange}
              comparison={c}
              lenses={lenses}
              showLenses={false}
              head={c.head.sha}
              tab={tab}
              onTab={setTab}
              onClose={closeModal}
              onGo={goClass}
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

/**
 * Picks the one question each key change shows: about the key change's main
 * class if possible, else another class it draws; one that names a method the
 * key change mentions wins, then worries before asks before likes. Each
 * question is shown once; the rest go to the books' page.
 */
function pickQuestions(lenses: LensReport | null, stops: Story["stops"]): { byStop: (Note | null)[]; rest: Note[] } {
  const all: Note[] = (lenses?.lenses ?? []).flatMap((l) => l.questions.map((q) => ({ lens: l.lens, q })));
  const used = new Set<Note>();
  const same = (a: string, n: string) => a === n || a.endsWith(`::${n}`);
  const rank = { worries: 0, asks: 1, likes: 2 } as const;
  const byStop = stops.map((s) => {
    const text = `${s.title} ${s.explain} ${s.look}`;
    const score = (n: Note) => {
      const [cls, method] = n.q.target?.name.split(/[#.]/) ?? [];
      if (!cls) return -1;
      const main = same(s.classes[0], cls);
      if (!main && !s.classes.some((k) => same(k, cls))) return -1;
      return (main ? 20 : 10) + (method && text.includes(method) ? 5 : 0) + (2 - rank[n.q.tone]);
    };
    const best = all.filter((n) => !used.has(n) && score(n) >= 0).sort((x, y) => score(y) - score(x))[0] ?? null;
    if (best) used.add(best);
    return best;
  });
  const rest = all.filter((n) => !used.has(n)).sort((a, b) => rank[a.q.tone] - rank[b.q.tone]);
  return { byStop, rest };
}

/** Each author's overall take on the whole change, where they disagree, and every other question. */
function BooksPage({
  comparison,
  lenses,
  rest,
  onOpen,
  onAsk,
  onBack,
}: {
  comparison: Comparison;
  lenses: LensReport | null;
  rest: Note[];
  onOpen(name: string, tab?: PanelTab): void;
  onAsk(): void;
  onBack(): void;
}) {
  const results = (["metz", "ousterhout", "copeland"] as LensId[]).map((id) => ({ id, r: lenses?.lenses.find((l) => l.lens === id) }));
  const ran = lenses && lenses.status !== "idle";
  return (
    <article className="stop" key="books">
      <div className="stop-meta">After the key changes</div>
      <h2 className="stop-heading">What the authors think</h2>
      <p className="stop-explain">
        Three authors on code design each look at the whole change and say what they would want from it. They often agree, but not always. Each argues only from a checklist built from their own book, with its quotes checked.
      </p>
      {!ran ? (
        <div className="books-empty">
          <p>The authors have not looked at this change yet.</p>
          <button className="btn primary" onClick={onAsk}>
            Ask the authors
          </button>
        </div>
      ) : lenses.status === "running" ? (
        <p className="stop-explain">
          <span className="spinner small" /> The authors are reading the change.
        </p>
      ) : (
        <>
          <div className="books">
            {results.map(({ id, r }) => (
              <section key={id} className="book">
                <div className="book-head">
                  <span className={`avatar ${id}`}>{LENS_INFO[id].initials}</span>
                  <div>
                    <div className="book-who">{LENS_INFO[id].who}</div>
                    <div className="book-title">{LENS_INFO[id].book}</div>
                  </div>
                </div>
                <p className="book-take">
                  {r?.overall ??
                    (r?.questions[0]?.text ? `${r.questions[0].text}` : r?.error ? "This author could not read the change." : "No take yet.")}
                </p>
              </section>
            ))}
          </div>
          {!results.some(({ r }) => r?.overall) && (
            <p className="rail-note">
              These notes were written before the authors spoke in their own voice.{" "}
              <button className="linkish" onClick={onAsk}>
                Ask the authors again
              </button>
            </p>
          )}
          {lenses.disagreements.length > 0 && (
            <div className="stop-lenses">
              <div className="kicker">Where they disagree</div>
              {lenses.disagreements.map((d, j) => (
                <div key={j} className="stop-lens disagree">
                  <p className="topic">{d.topic}</p>
                  {(Object.entries(d.positions) as [LensId, string][]).map(([id, pos]) => (
                    <div key={id} className="position">
                      <b>{LENS_INFO[id].who.split(" ").pop()}:</b> {pos}
                    </div>
                  ))}
                  <div className="tradeoff">{d.tradeoff}</div>
                </div>
              ))}
            </div>
          )}
          {rest.length > 0 && (
            <details className="all-questions">
              <summary>
                {rest.length} more note{rest.length === 1 ? "" : "s"} from the authors
              </summary>
              <div className="stop-lenses">
                {rest.map((n, j) => (
                  <LensNote key={j} comparison={comparison} note={n} onOpen={onOpen} />
                ))}
              </div>
            </details>
          )}
        </>
      )}
      <footer className="stop-foot">
        <button className="btn" onClick={onBack}>
          ← Back
        </button>
      </footer>
    </article>
  );
}

function LensNote({ comparison, note: { lens, q }, onOpen }: { comparison: Comparison; note: Note; onOpen(name: string, tab?: PanelTab): void }) {
  const [open, setOpen] = useState(false);
  const target = q.target ? resolveTarget(comparison, q.target.name) : null;
  return (
    <div className="stop-lens">
      <div className="who">
        {WHO[lens]} <span className={`pill ${q.tone}`}>{q.tone}</span>
        {target && (
          <button className="target-chip" onClick={() => (target.method ? setOpen(!open) : onOpen(target.change.name, "code"))} title={target.method ? "Show this method's code" : "Open this class's code"}>
            {shortName(target.change.name)}
            {target.method ? `#${target.method}` : ""}
          </button>
        )}
      </div>
      <p>{q.text}</p>
      {target?.method && (
        <button className="linkish code-toggle" onClick={() => setOpen(!open)}>
          {open ? "Hide the code" : `Show ${target.method}`}
        </button>
      )}
      {open && target?.method && <MethodCode comparison={comparison} change={target.change} method={target.method} />}
    </div>
  );
}

/** One quiet line from an author under a key change; it opens into the full note. */
function BookLine({ comparison, note, onOpen }: { comparison: Comparison; note: Note; onOpen(name: string, tab?: PanelTab): void }) {
  const [open, setOpen] = useState(false);
  const verb = { likes: "likes", asks: "asks", worries: "worries" }[note.q.tone];
  if (open)
    return (
      <div className="stop-lenses">
        <LensNote comparison={comparison} note={note} onOpen={onOpen} />
        <button className="linkish" onClick={() => setOpen(false)}>
          Hide
        </button>
      </div>
    );
  return (
    <button className="book-line" onClick={() => setOpen(true)} title="Read the whole note">
      <BookIcon /> <b>{WHO[note.lens].split(" ").pop()}</b> {`${verb}: `}
      {note.q.text}
    </button>
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

function BookIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
      <path d="M4 19V5" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M9 10v10" />
    </svg>
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
