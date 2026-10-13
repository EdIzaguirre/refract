import { useState } from "react";
import type { ClassChange, Comparison } from "../../src/shared/types";
import type { PanelTab } from "./ClassPanel";

/** Where you are on the map: areas, one area, one class, its code. Each step is clickable. */
export function Crumbs({
  comparison,
  openArea,
  selected,
  tab,
  onAreas,
  onArea,
  onTab,
}: {
  comparison: Comparison;
  openArea: string | null;
  selected: ClassChange | null;
  tab: PanelTab;
  onAreas(): void;
  onArea(id: string): void;
  onTab(t: PanelTab): void;
}) {
  const areaId = selected?.area ?? openArea;
  const area = comparison.areas.find((a) => a.id === areaId);
  const level = selected ? (tab === "code" ? 4 : 3) : area ? 2 : 1;
  return (
    <nav className="crumbs" aria-label="Zoom level">
      <button className={level === 1 ? "on" : ""} onClick={onAreas}>
        <span className="n">1</span>Business areas
      </button>
      {area && (
        <>
          <span className="sep">›</span>
          <button className={level === 2 ? "on" : ""} onClick={() => onArea(area.id)}>
            <span className="n">2</span>
            {area.name}
          </button>
        </>
      )}
      {selected && (
        <>
          <span className="sep">›</span>
          <button className={level === 3 ? "on" : ""} onClick={() => onTab("shape")}>
            <span className="n">3</span>
            {selected.name.split("::").pop()}
          </button>
          <span className="sep">›</span>
          <button className={level === 4 ? "on" : ""} onClick={() => onTab("code")}>
            <span className="n">4</span>Code
          </button>
        </>
      )}
    </nav>
  );
}

export function Legend({ comparison, areasPath, onDraft }: { comparison: Comparison; areasPath: string; onDraft(): void }) {
  const [open, setOpen] = useState(true);
  if (!open)
    return (
      <button className="legend closed" onClick={() => setOpen(true)}>
        Legend
      </button>
    );
  return (
    <div className="legend">
      <button className="x" onClick={() => setOpen(false)} aria-label="Hide legend">
        ×
      </button>
      <div className="row">
        <svg width="34" height="20">
          <rect x="1" y="6" width="14" height="13" rx="2" fill="var(--accent-soft)" stroke="var(--accent)" />
          <rect x="19" y="1" width="14" height="18" rx="2" fill="var(--accent-soft)" stroke="var(--accent)" />
        </svg>
        <span>Each class is a box: width is its public interface, height its code. Deep modules are narrow and tall.</span>
      </div>
      <div className="row">
        <svg width="34" height="10">
          <path d="M1 5H33" stroke="var(--accent)" strokeWidth="2" />
        </svg>
        <span>new dependency</span>
        <svg width="34" height="10">
          <path d="M1 5H33" stroke="var(--bad)" strokeWidth="1.5" strokeDasharray="5 4" />
        </svg>
        <span>removed</span>
      </div>
      <div className="row">
        <span>
          Areas {comparison.areaSource === "file" ? "from " : "inferred from dependencies. "}
          {comparison.areaSource === "file" ? (
            <code title={areasPath}>areas.yml</code>
          ) : (
            <button className="btn" style={{ padding: "0 8px" }} onClick={onDraft}>
              Draft with Claude
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
