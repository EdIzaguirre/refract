import { useRef, useState } from "react";
import type { Timeline } from "../../src/shared/types";

/** A dot per commit since the branch left its base. Drag along it to replay the map commit by commit. */
export function TimelineBar({
  timeline,
  head,
  liveHead,
  fresh,
  onPick,
}: {
  timeline: Timeline | null;
  head: string | null;
  liveHead: string | null;
  fresh: string | null;
  onPick(sha: string): void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const dragging = useRef(false);
  const commits = timeline?.commits ?? [];
  const n = commits.length;
  const pos = (i: number) => (n <= 1 ? 100 : 4 + (i / (n - 1)) * 92);
  const at = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const pct = ((clientX - r.left) / r.width) * 100;
    let best = 0;
    for (let i = 0; i < n; i++) if (Math.abs(pos(i) - pct) < Math.abs(pos(best) - pct)) best = i;
    return best;
  };
  const current = commits.findIndex((c) => c.sha === head);
  const isLive = head && head === liveHead;

  return (
    <footer className="timeline">
      <span className="label">
        {n} commit{n === 1 ? "" : "s"}
        {timeline?.watching ? ` on ${timeline.watching}` : ""}
      </span>
      <div
        className="track"
        ref={track}
        onPointerDown={(e) => {
          if (!n) return;
          dragging.current = true;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          onPick(commits[at(e.clientX)].sha);
        }}
        onPointerMove={(e) => {
          if (!n) return;
          const i = at(e.clientX);
          setHover(i);
          if (dragging.current && commits[i].sha !== head) onPick(commits[i].sha);
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerLeave={() => setHover(null)}
      >
        <div className="rail-line" />
        <div className="fill" style={{ width: `${current >= 0 ? pos(current) : 0}%` }} />
        <div className="base" title="Where the branch left its base" />
        {commits.map((c, i) => (
          <div
            key={c.sha}
            className={`dot ${i < current ? "past" : ""} ${i === current ? "on" : ""} ${fresh === c.sha ? "fresh" : ""}`}
            style={{ left: `${pos(i)}%` }}
          />
        ))}
        {hover !== null && commits[hover] && (
          <div className="tip" style={{ left: `${pos(hover)}%` }}>
            {commits[hover].short} · {commits[hover].subject}
          </div>
        )}
      </div>
      <span className="now">
        {current >= 0 && (
          <>
            <span className="mono">
              {current + 1}/{n}
            </span>
            {isLive ? (
              <span className="pill accent">{timeline?.watching ? "live" : "latest"}</span>
            ) : (
              liveHead && (
                <button className="btn" onClick={() => onPick(liveHead)}>
                  Jump to latest
                </button>
              )
            )}
          </>
        )}
      </span>
    </footer>
  );
}
