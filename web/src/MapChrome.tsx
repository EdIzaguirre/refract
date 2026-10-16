import { useState } from "react";
import type { ClassChange, Comparison } from "../../src/shared/types";
import type { Mode } from "./App";

/** How deep you are: 1 all areas, 2 inside one area, 3 one class. */
export type Level = 1 | 2 | 3;

/** Where you are on the map. Shown once you are inside an area; each step is clickable. */
export function Crumbs({
  comparison,
  openArea,
  selected,
  onAreas,
  onArea,
}: {
  comparison: Comparison;
  openArea: string | null;
  selected: ClassChange | null;
  onAreas(): void;
  onArea(id: string): void;
}) {
  const area = comparison.areas.find((a) => a.id === (selected?.area ?? openArea));
  if (!area) return null;
  return (
    <nav className="crumbs" aria-label="Where you are">
      <button onClick={onAreas}>All areas</button>
      <span className="sep">›</span>
      <button className={selected ? "" : "on"} onClick={() => onArea(area.id)}>
        {area.name}
      </button>
      {selected && (
        <>
          <span className="sep">›</span>
          <button className="on">{selected.name.split("::").pop()}</button>
        </>
      )}
    </nav>
  );
}

const SEEN = "refract.hints.seen";
const readSeen = (): Level[] => {
  try {
    return JSON.parse(localStorage.getItem(SEEN) ?? "[]");
  } catch {
    return [];
  }
};

/**
 * "What am I looking at?": one short card per zoom level, shown the first
 * time you reach that level. The ? button brings it back.
 */
export function useHints(level: Level) {
  const [seen, setSeen] = useState<Level[]>(readSeen);
  const [asked, setAsked] = useState(false);
  const open = asked || !seen.includes(level);
  const close = () => {
    const next = [...new Set([...seen, level])];
    setSeen(next);
    setAsked(false);
    try {
      localStorage.setItem(SEEN, JSON.stringify(next));
    } catch {
      /* hints just come back next time */
    }
  };
  return { open, close, ask: () => setAsked(true) };
}

export function Hint({ level, comparison, areasPath, onDraft, onClose }: { level: Level; comparison: Comparison; areasPath: string; onDraft(): void; onClose(): void }) {
  return (
    <div className="hint" role="note">
      <button className="x" onClick={onClose} aria-label="Got it">
        ×
      </button>
      <div className="hint-q">What am I looking at?</div>
      {level === 1 && (
        <>
          <p>Each tile is one part of the product. Bigger tiles hold more code. Teal tiles are the parts this change touched, and the deeper the teal, the more it touched.</p>
          <p>Click a tile, or scroll to zoom, to look inside.</p>
          <p className="hint-src">
            Areas {comparison.areaSource === "file" ? "come from " : "are guessed from who calls whom. "}
            {comparison.areaSource === "file" ? (
              <code title={areasPath}>areas.yml</code>
            ) : (
              <button className="link" onClick={onDraft}>
                Name them with Claude
              </button>
            )}
          </p>
        </>
      )}
      {level === 2 && (
        <>
          <div className="hint-row">
            <svg width="34" height="20" aria-hidden>
              <rect x="1" y="6" width="14" height="13" rx="2" fill="var(--accent-soft)" stroke="var(--accent)" />
              <rect x="19" y="1" width="14" height="18" rx="2" fill="var(--accent-soft)" stroke="var(--accent)" />
            </svg>
            <span>Each box is a class. Its width is what it shows the rest of the code (public methods); its height is the code it keeps inside.</span>
          </div>
          <div className="hint-row">
            <svg width="34" height="10" aria-hidden>
              <path d="M1 5H33" stroke="var(--accent)" strokeWidth="2" />
            </svg>
            <span>A teal arrow is a new dependency: one class now calls another. A red dashed one was removed.</span>
          </div>
          <p>Hold space to see how it looked before. Click a box to open it.</p>
        </>
      )}
      {level === 3 && <p>Shape compares the class before and after. Request flow shows what it calls when a request comes in. Code shows the lines that changed.</p>}
    </div>
  );
}

/** Hold to see the map before the change; or put before and after side by side. */
export function Peek({ mode, onMode }: { mode: Mode; onMode(m: Mode): void }) {
  const split = mode === "split";
  return (
    <div className="peek" role="group" aria-label="Before and after">
      {!split && (
        <button
          className={mode === "before" ? "on" : ""}
          onPointerDown={() => onMode("before")}
          onPointerUp={() => onMode("after")}
          onPointerLeave={() => mode === "before" && onMode("after")}
          title="Hold to see before (or hold space)"
        >
          {mode === "before" ? "Showing before" : "Hold to see before"}
          <kbd>space</kbd>
        </button>
      )}
      <button className={split ? "on" : ""} onClick={() => onMode(split ? "after" : "split")} title="Before and after side by side (s)">
        {split ? "Back to one map" : "Side by side"}
        <kbd>s</kbd>
      </button>
    </div>
  );
}
