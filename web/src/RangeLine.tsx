import { useEffect, useRef, useState } from "react";
import type { BranchHistory, Comparison, Timeline } from "../../src/shared/types";

/**
 * The header's answer to "what am I looking at?": one sentence naming the
 * branch, how much work it holds and what it is measured against. Clicking it
 * opens a small drawing of the history with the two compared points marked.
 */
export function RangeLine({ comparison: c, timeline, watching }: { comparison: Comparison; timeline: Timeline | null; watching: string | null }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  const h = timeline?.history;
  const head = branchName(c.head);
  const commits = timeline?.commits ?? [];
  const work = commits.length - (h?.merges.length ?? 0);
  const lastMerge = h && commits.find((x) => x.sha === h.merges[h.merges.length - 1]);

  return (
    <div className="range" ref={box}>
      <button className="range-line" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="What is being compared">
        {watching && <span className="live-dot" title={`Watching ${watching} for new commits`} />}
        {h ? (
          <span>
            <b>{head}</b>: {work} commit{work === 1 ? "" : "s"} of work since <b>{h.baseRef}</b>
            <span className="range-when">{lastMerge ? ` · caught up with ${h.baseRef} ${ago(lastMerge.date)}` : ` · branched ${ago(h.base.date)}`}</span>
          </span>
        ) : (
          <span>
            <b>{head}</b> compared with <b>{branchName(c.base)}</b>
          </span>
        )}
        <span className="range-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="range-pop" role="dialog" aria-label="What is being compared">
          {h ? <HistoryDrawing c={c} h={h} timeline={timeline!} head={head} /> : <Plain c={c} />}
        </div>
      )}
    </div>
  );
}

function HistoryDrawing({ c, h, timeline, head }: { c: Comparison; h: BranchHistory; timeline: Timeline; head: string }) {
  const commits = timeline.commits;
  const shown = Math.max(0, commits.findIndex((x) => x.sha === c.head.sha));
  const W = 560;
  const devY = 46;
  const brY = 128;
  const x0 = 96;
  const x1 = W - 90;
  const n = commits.length;
  const xAt = (i: number) => (n <= 1 ? x1 : x0 + 30 + (i / (n - 1)) * (x1 - x0 - 30));
  const merges = new Set(h.merges);
  const mergeIdx = commits.map((x, i) => (merges.has(x.sha) ? i : -1)).filter((i) => i >= 0);
  // "Before" sits on dev where the branch last took it in: the last merge, or the fork when there is none.
  const beforeX = mergeIdx.length ? xAt(mergeIdx[mergeIdx.length - 1]) - 26 : x0;
  const afterX = xAt(shown);
  const devEnd = h.baseAhead ? W - 30 : beforeX + 20;
  const work = n - h.merges.length;
  const lastMerge = mergeIdx.length ? commits[mergeIdx[mergeIdx.length - 1]] : null;

  return (
    <div className="history">
      <svg width={W} height={170} viewBox={`0 0 ${W} 170`} aria-hidden>
        <rect x={xAt(0) - 10} y={brY - 16} width={afterX - xAt(0) + 20} height={32} rx={16} className="hist-shade" />
        <text x={(xAt(0) + afterX) / 2} y={brY + 32} textAnchor="middle" className="hist-note accent">
          what Refract shows: {work} commit{work === 1 ? "" : "s"} of work
        </text>
        <line x1={14} y1={devY} x2={devEnd} y2={devY} className="hist-dev" />
        {h.baseAhead > 0 && (
          <>
            <line x1={beforeX} y1={devY} x2={devEnd} y2={devY} className="hist-dev later" />
            <circle cx={devEnd} cy={devY} r={4} className="hist-dot faint" />
            <text x={devEnd + 4} y={devY + 20} textAnchor="end" className="hist-note">
              now
            </text>
          </>
        )}
        <text x={14} y={devY - 12} className="hist-name">
          {h.baseRef}
        </text>
        <path d={`M ${x0} ${devY} C ${x0 + 12} ${devY + 40}, ${xAt(0) - 20} ${brY}, ${xAt(0)} ${brY}`} className="hist-branch" />
        <line x1={xAt(0)} y1={brY} x2={xAt(n - 1)} y2={brY} className="hist-branch" />
        <text x={14} y={brY + 5} className="hist-name">
          {head.length > 12 ? `${head.slice(0, 11)}…` : head}
        </text>
        {mergeIdx.map((i) => (
          <path key={i} d={`M ${xAt(i) - 26} ${devY} L ${xAt(i)} ${brY}`} className="hist-merge" />
        ))}
        {commits.map((x, i) => (
          <circle key={x.sha} cx={xAt(i)} cy={brY} r={merges.has(x.sha) ? 3 : 2.6} className={`hist-dot ${merges.has(x.sha) ? "merge" : ""} ${i > shown ? "faint" : ""}`}>
            <title>{`${x.short} ${x.subject}`}</title>
          </circle>
        ))}
        <circle cx={beforeX} cy={devY} r={7} className="hist-mark before" />
        <text x={beforeX} y={devY - 14} textAnchor="middle" className="hist-label">
          Before
        </text>
        <circle cx={afterX} cy={brY} r={7} className="hist-mark after" />
        <text x={afterX} y={brY - 16} textAnchor="middle" className="hist-label">
          After
        </text>
      </svg>
      <dl>
        <dt>Before</dt>
        <dd>
          {h.baseRef} {lastMerge ? `as ${head} last merged it in, ${ago(lastMerge.date)}` : `where ${head} branched off it`}
          <span className="mono"> · {h.base.short}</span>
        </dd>
        <dt>After</dt>
        <dd>
          {head} {shown === commits.length - 1 ? "now" : `at commit ${shown + 1} of ${commits.length}`}
          <span className="mono"> · {c.head.short}</span> {c.head.subject}
        </dd>
      </dl>
      {mergeIdx.length > 0 && (
        <p>
          The grey links are the {mergeIdx.length === 1 ? "time" : `${mergeIdx.length} times`} {head} merged {h.baseRef} in. What they brought is already in Before, so it
          doesn't count as change.
        </p>
      )}
      {h.baseAhead > 0 && (
        <p>
          {h.baseRef} has {h.baseAhead} newer commit{h.baseAhead === 1 ? "" : "s"} that {head} hasn't merged yet. They aren't part of this comparison.
        </p>
      )}
    </div>
  );
}

function Plain({ c }: { c: Comparison }) {
  return (
    <div className="history">
      <dl>
        <dt>Before</dt>
        <dd>
          <span className="mono">{c.base.short}</span> {c.base.subject}
        </dd>
        <dt>After</dt>
        <dd>
          <span className="mono">{c.head.short}</span> {c.head.subject}
        </dd>
      </dl>
    </div>
  );
}

/** A branch name reads better than a SHA; fall back to the short SHA when the ref is one. */
export function branchName(r: Comparison["head"]): string {
  return !r.ref || /^[0-9a-f]{7,40}$/i.test(r.ref) || r.ref === "HEAD" ? r.short : r.ref.replace(/^origin\//, "");
}

function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} hour${Math.round(s / 3600) === 1 ? "" : "s"} ago`;
  const d = Math.round(s / 86400);
  return d < 14 ? `${d} day${d === 1 ? "" : "s"} ago` : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
