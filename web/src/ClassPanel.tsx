import { useEffect, useMemo, useState } from "react";
import type { ClassChange, Comparison, LensReport, MethodChange, Sequence } from "../../src/shared/types";
import { api } from "./api";
import { boxDims } from "./map/layout";
import { Mermaid } from "./Mermaid";
import { CodeDiff } from "./CodeDiff";
import { LENS_INFO } from "./LensRail";
import { holdingWords } from "./holding";

export type PanelTab = "shape" | "flow" | "code";

/** Zooms 3 and 4: one class before and after, a request through it, then its code. */
export function ClassPanel({
  change: c,
  comparison,
  lenses,
  head,
  tab,
  onTab,
  onClose,
  onGo,
  showLenses = true,
}: {
  change: ClassChange;
  comparison: Comparison;
  lenses: LensReport | null;
  head: string;
  tab: PanelTab;
  onTab(t: PanelTab): void;
  onClose(): void;
  onGo(name: string): void;
  /** Off where the lens notes already live elsewhere on the page, like the summary. */
  showLenses?: boolean;
}) {
  const area = comparison.areas.find((a) => a.id === c.area);
  return (
    <section className="panel" aria-label={c.name}>
      <div className="panel-head">
        <div className="row">
          <span className={`pill ${c.status === "added" ? "good" : c.status === "removed" ? "bad" : c.status === "changed" ? "accent" : "flat"}`}>{c.status}</span>
          <h2 title={c.name}>{c.name}</h2>
          <button className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="meta">
          <span>{c.role}</span>
          {area && <span>{area.name}</span>}
          {c.superclass && <span>inherits {c.superclass}</span>}
          {c.descendants > 0 && <span>inherited by {c.descendants}</span>}
          {c.nested.length > 0 && <span>holds {c.nested.map((n) => n.split("::").pop()).join(", ")}</span>}
          <span className="mono">{c.paths[0]}</span>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {(
          [
            ["shape", "Shape"],
            ["flow", "Request flow"],
            ["code", "Code"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => onTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {tab === "shape" && <ShapeTab c={c} comparison={comparison} lenses={showLenses ? lenses : null} onGo={onGo} />}
        {tab === "flow" && <FlowTab c={c} head={head} />}
        {tab === "code" && <CodeTab c={c} head={head} />}
      </div>
    </section>
  );
}

function ShapeTab({ c, comparison, lenses, onGo }: { c: ClassChange; comparison: Comparison; lenses: LensReport | null; onGo(n: string): void }) {
  const questions = (lenses?.lenses ?? []).flatMap((l) =>
    l.questions.filter((q) => q.target && q.target.name.split(/[#.]/)[0] === c.name).map((q) => ({ ...q, lens: l.lens })),
  );
  const out = comparison.edges.filter((e) => e.from === c.name);
  const inbound = comparison.edges.filter((e) => e.to === c.name);
  const b = c.shape.before;
  const a = c.shape.after;
  return (
    <>
      <div className="pair">
        {(["before", "after"] as const).map((side) => {
          const s = c.shape[side];
          const d = boxDims(s);
          // One scale for both sides so the boxes compare honestly.
          const db = boxDims(c.shape.before);
          const da = boxDims(c.shape.after);
          const scale = Math.min(3, 300 / Math.max(db?.w ?? 1, da?.w ?? 1), 220 / Math.max(db?.h ?? 1, da?.h ?? 1));
          const H = Math.max(db?.h ?? 0, da?.h ?? 0) * scale;
          return (
            <div key={side}>
              <div className={`side-label ${side}`}>{side}</div>
              {s && d ? (
                <svg className="shape-svg" width="100%" height={H + 40} viewBox={`0 0 340 ${H + 40}`}>
                  <rect
                    x={10}
                    y={10 + H - d.h * scale}
                    width={d.w * scale}
                    height={d.h * scale}
                    rx={4}
                    fill={side === "after" ? "var(--accent-soft)" : "var(--before-soft)"}
                    stroke={side === "after" ? "var(--accent)" : "var(--before)"}
                    strokeWidth={1.5}
                  />
                  <text x={10} y={H + 30}>
                    {side === "after" && c.sizeUnknown
                      ? `${s.interface} public · planned, so its size waits for real code`
                      : `${s.interface} public × ${s.codeLines} lines · ${Math.round(s.codeLines / Math.max(1, s.interface))} per public method`}
                  </text>
                </svg>
              ) : (
                <p className="rail-note">{side === "before" ? "Did not exist." : "Removed."}</p>
              )}
            </div>
          );
        })}
      </div>
      {b && a && c.planned && (
        <p className="rail-note" style={{ margin: 0 }}>
          {a.interface > b.interface ? `The plan widens its interface by ${a.interface - b.interface}.` : "The plan keeps its interface as it is."}
        </p>
      )}
      {b && a && !c.planned && (
        <p className="rail-note" style={{ margin: 0 }}>
          {a.interface > b.interface ? `The interface grew by ${a.interface - b.interface}. ` : a.interface < b.interface ? `The interface shrank by ${b.interface - a.interface}. ` : "Same interface. "}
          {a.codeLines !== b.codeLines ? `The code ${a.codeLines > b.codeLines ? "grew" : "shrank"} by ${Math.abs(a.codeLines - b.codeLines)} lines.` : "Same amount of code."}
        </p>
      )}
      {questions.length > 0 && (
        <div>
          <h3>The lenses on this class</h3>
          <div style={{ display: "grid", gap: 10 }}>
            {questions.map((q, i) => (
              <div key={i} className="lens-mini">
                <span className="who">
                  {LENS_INFO[q.lens].who} · <span className={`pill ${q.tone}`}>{q.tone}</span>
                </span>
                <span className="text">{q.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <MethodsTable methods={c.methods} unit={c.after ?? c.before} />
      <div className="pair">
        <DepList title="Depends on" edges={out.map((e) => ({ name: e.to, status: e.status, kind: holdingWords(e.has, e.kind) ?? e.kind, owns: e.has?.owns }))} onGo={onGo} />
        <DepList title="Used by" edges={inbound.map((e) => ({ name: e.from, status: e.status, kind: e.has?.owns ? "owns this" : e.kind, owns: e.has?.owns }))} onGo={onGo} />
      </div>
    </>
  );
}

function MethodsTable({ methods, unit }: { methods: MethodChange[]; unit: ClassChange["after"] }) {
  const rows: MethodChange[] = methods.length
    ? methods
    : (unit?.methods ?? []).map((m) => ({
        name: m.name,
        scope: m.scope,
        status: "unchanged",
        before: { visibility: m.visibility, codeLines: m.codeLines, params: m.params, branches: m.branches },
        after: { visibility: m.visibility, codeLines: m.codeLines, params: m.params, branches: m.branches },
      }));
  const order = (m: MethodChange) => (m.status === "unchanged" ? 1 : 0);
  const sorted = [...rows].sort((x, y) => order(x) - order(y) || ((x.after ?? x.before)!.visibility === "public" ? -1 : 1) - ((y.after ?? y.before)!.visibility === "public" ? -1 : 1));
  const longest = Math.max(1, ...rows.map((m) => Math.max(m.before?.codeLines ?? 0, m.after?.codeLines ?? 0)));
  if (!rows.length) return null;
  return (
    <div>
      <h3>Methods, before and after</h3>
      <table className="mtable">
        <thead>
          <tr>
            <th>Method</th>
            <th>Lines</th>
            <th></th>
            <th>Params</th>
            <th>Branches</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => {
            const v = (m.after ?? m.before)!;
            const num = (x: number | undefined, y: number | undefined) => (x === undefined ? `${y}` : y === undefined ? `${x}` : x === y ? `${y}` : `${x} → ${y}`);
            return (
              <tr key={`${m.scope}${m.name}`} className={m.status}>
                <td className="name">
                  {m.scope === "class" ? "self." : ""}
                  {m.name} <span className="vis">{v.visibility !== "public" ? v.visibility : ""}</span>
                </td>
                <td>{num(m.before?.codeLines, m.after?.codeLines)}</td>
                <td>
                  <div className="bars">
                    {m.before && <span className="b" style={{ width: `${(m.before.codeLines / longest) * 100}%` }} />}
                    {m.after && <span className="a" style={{ width: `${(m.after.codeLines / longest) * 100}%` }} />}
                  </div>
                </td>
                <td>{num(m.before?.params, m.after?.params)}</td>
                <td>{num(m.before?.branches, m.after?.branches)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DepList({ title, edges, onGo }: { title: string; edges: { name: string; status: string; kind: string; owns?: boolean }[]; onGo(n: string): void }) {
  const order = { added: 0, removed: 1, unchanged: 2 } as Record<string, number>;
  const list = [...edges].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  return (
    <div>
      <h3>
        {title} ({edges.filter((e) => e.status !== "removed").length})
      </h3>
      <div className="deplist">
        {list.slice(0, 40).map((e) => (
          <div key={e.name}>
            <span className={e.status === "added" ? "plus" : e.status === "removed" ? "minus" : ""}>{e.status === "added" ? "+ " : e.status === "removed" ? "− " : "  "}</span>
            <button onClick={() => onGo(e.name)}>{e.name}</button>{" "}
            <span className="vis" title={e.owns ? "Composition: these go when the owner goes" : undefined}>
              {e.owns ? "◆ " : ""}
              {e.kind}
            </span>
          </div>
        ))}
        {list.length > 40 && <span className="vis">and {list.length - 40} more</span>}
      </div>
    </div>
  );
}

/**
 * A class name broken between its words, never inside one: "TimesheetPdfGenerationJob"
 * becomes "TimesheetPdf / GenerationJob" on two lines. A namespace goes on its own line.
 */
function actorName(name: string): string {
  const parts = name.split("::");
  const last = parts.pop()!;
  const words = last.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z\d]+/g) ?? [last];
  const lines: string[] = [];
  for (const w of words) {
    if (lines.length && lines[lines.length - 1].length + w.length <= 14) lines[lines.length - 1] += w;
    else lines.push(w);
  }
  if (parts.length) lines.unshift(`${parts.slice(-1)[0]}::`);
  return lines.join("<br/>").replace(/[;#"]/g, " ");
}

export function toMermaid(seq: Sequence): string {
  const id = new Map(seq.participants.map((p, i) => [p, `p${i}`]));
  const label = (s: string) => s.replace(/[;:#"]/g, " ");
  const lines = ["sequenceDiagram"];
  for (const p of seq.participants) lines.push(`  participant ${id.get(p)} as ${actorName(p)}`);
  for (const m of seq.messages) lines.push(`  ${id.get(m.from)}${m.observed ? "->>" : "-->>"}${id.get(m.to)}: ${label(m.label)}`);
  if (!seq.messages.length) lines.push(`  Note over ${id.get(seq.participants[0])}: no calls into the app's own classes`);
  return lines.join("\n");
}

function FlowTab({ c, head }: { c: ClassChange; head: string }) {
  const unit = c.after ?? c.before;
  const candidates = useMemo(() => {
    const changed = c.methods.filter((m) => m.status !== "unchanged").map((m) => m.name);
    const pub = (unit?.methods ?? []).filter((m) => m.visibility === "public" && m.kind === "def").map((m) => m.name);
    // The constructor is rarely the interesting request, so it goes last.
    const all = [...new Set([...changed.filter((n) => pub.includes(n)), ...changed, ...pub])];
    return [...all.filter((n) => n !== "initialize"), ...all.filter((n) => n === "initialize")].slice(0, 14);
  }, [c, unit]);
  const [method, setMethod] = useState(candidates[0] ?? "");
  const [seqs, setSeqs] = useState<{ before: Sequence | null; after: Sequence | null }>({ before: null, after: null });
  const [trace, setTrace] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!method) return;
    let stale = false;
    Promise.all([
      c.before ? api.sequence(head, "before", c.name, method).catch(() => null) : Promise.resolve(null),
      c.after ? api.sequence(head, "after", c.name, method).catch(() => null) : Promise.resolve(null),
    ]).then(([before, after]) => !stale && setSeqs({ before, after }));
    return () => {
      stale = true;
    };
  }, [c, head, method, tick]);

  const runTrace = async () => {
    setTrace("Running the tests that touch this change, on both sides, with Ruby's TracePoint on…");
    const [b, a] = await Promise.all([api.trace(head, "before"), api.trace(head, "after")]);
    const say = (r: typeof a, side: string) => (r?.status === "traced" ? `${side}: ${r.flows} flows from ${r.tests.length} test files.` : `${side}: ${r?.error ?? "no result"}`);
    setTrace(`${say(b, "Before")} ${say(a, "After")}`);
    setTick((t) => t + 1);
  };

  if (!candidates.length) return <p className="rail-note">This class has no methods to follow.</p>;
  const traced = seqs.before?.traced || seqs.after?.traced;
  return (
    <>
      <div className="picker">
        {candidates.map((m) => (
          <button key={m} aria-pressed={m === method} onClick={() => setMethod(m)}>
            {m}
          </button>
        ))}
      </div>
      <div className="seq-legend">
        <span>
          <svg width="30" height="8">
            <path d="M0 4H30" stroke="currentColor" strokeWidth="1.5" />
          </svg>{" "}
          seen when the tests ran
        </span>
        <span>
          <svg width="30" height="8">
            <path d="M0 4H30" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
          </svg>{" "}
          only found in the code
        </span>
        <button className="btn" onClick={runTrace}>
          {traced ? "Trace again" : "Trace with the tests"}
        </button>
      </div>
      {trace && <div className="callout">{trace}</div>}
      <div className="seq-stack">
        {(["before", "after"] as const).map((side) => (
          <div key={side} className="seq">
            <div className={`side-label ${side}`}>{side}</div>
            {seqs[side] ? <Mermaid text={toMermaid(seqs[side]!)} /> : <p className="rail-note">{c[side] === null && side === "before" ? "Did not exist." : c[side] === null ? "Removed." : "…"}</p>}
          </div>
        ))}
      </div>
      <p className="rail-note" style={{ margin: 0 }}>
        A sequence diagram, the kind Metz uses in POODR to ask which object should own each message (§4.3.3).
      </p>
    </>
  );
}

function CodeTab({ c, head }: { c: ClassChange; head: string }) {
  const [diff, setDiff] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    // A planned class has no code to diff yet.
    if (c.planned) return setDiff("");
    api.diff(head, c.paths).then((d) => !stale && setDiff(d.diff));
    return () => {
      stale = true;
    };
  }, [c, head]);
  return (
    <>
      <div>
        <h3>Structure</h3>
        <pre className="outline">
          <span>
            {(c.after ?? c.before)?.kind === "module" ? "module" : "class"} {c.name}
            {c.superclass ? ` < ${c.superclass}` : ""}
            {c.shape.before && c.shape.after && c.shape.before.codeLines !== c.shape.after.codeLines ? `   # ${c.shape.before.codeLines} → ${c.shape.after.codeLines} code lines` : ""}
          </span>
          {c.methods
            .filter((m) => m.status !== "unchanged")
            .map((m) => {
              const cls = m.status === "added" ? "add" : m.status === "removed" ? "del" : "";
              const sign = m.status === "added" ? "+" : m.status === "removed" ? "-" : " ";
              const v = (m.after ?? m.before)!;
              const lines = c.planned && m.status === "added" ? `planned, ${v.params} parameter${v.params === 1 ? "" : "s"}` : m.before && m.after ? `${m.before.codeLines} → ${m.after.codeLines} lines` : `${v.codeLines} lines`;
              return (
                <span key={`${m.scope}${m.name}`} className={cls}>
                  {sign} {v.visibility !== "public" ? `${v.visibility} ` : ""}
                  {m.scope === "class" ? "self." : ""}
                  {m.name}
                  {"   "}# {lines}
                </span>
              );
            })}
          <span className="note">  … {c.methods.filter((m) => m.status === "unchanged").length} methods unchanged</span>
        </pre>
      </div>
      <div>
        <h3>Line by line</h3>
        {diff === null ? (
          <div className="skeleton" />
        ) : diff ? (
          <CodeDiff diff={diff} />
        ) : (
          <p className="rail-note">{c.planned ? "No code yet: this is what the plan says the class will offer." : "No line changes in this class's files."}</p>
        )}
      </div>
    </>
  );
}
