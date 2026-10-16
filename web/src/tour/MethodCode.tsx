import { useEffect, useState } from "react";
import type { ClassChange, Comparison } from "../../../src/shared/types";
import { api } from "../api";
import { DiffLines, parse, type Line } from "../CodeDiff";

/** Resolves a lens target like "Foo#bar" or "Foo.bar" to the class and method it names. */
export function resolveTarget(c: Comparison, name: string): { change: ClassChange; method: string | null } | null {
  const m = name.match(/^([^#.]+)(?:[#.](.+))?$/);
  if (!m) return null;
  const cls = m[1];
  const change = c.classes.find((k) => k.name === cls) ?? c.classes.find((k) => k.name.endsWith(`::${cls}`));
  if (!change) return null;
  return { change, method: m[2] ?? null };
}

/**
 * One method's code with what the change did to it: added lines in green,
 * removed lines in red, the rest as context.
 */
export function MethodCode({ comparison, change, method }: { comparison: Comparison; change: ClassChange; method: string }) {
  const [lines, setLines] = useState<Line[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const side = change.after ? "after" : "before";
  const unit = change[side];
  const facts = unit?.methods.find((x) => x.name === method.replace(/^self\./, "") && x.kind === "def") ?? unit?.methods.find((x) => x.name === method.replace(/^self\./, ""));
  const loc = facts && unit ? (unit.locations.find((l) => facts.line >= l.line && facts.endLine <= l.endLine) ?? unit.locations[0]) : null;

  useEffect(() => {
    if (!facts || !loc) return;
    let stale = false;
    // The whole file as one hunk, so the method's lines can be cut out with their diff marks.
    api
      .diff(comparison.head.sha, [loc.path], 100000)
      .then(async ({ diff }) => {
        let parsed = diff ? parse(diff) : [];
        if (!parsed.length) {
          // The file did not change: show the method as plain code.
          const { text } = await api.source(comparison.head.sha, loc.path);
          parsed = parse(`diff --git a/x.rb b/x.rb\n@@ -1 +1 @@\n${text.split("\n").map((l) => ` ${l}`).join("\n")}`);
        }
        const key = side === "after" ? "new" : "old";
        const out: Line[] = [];
        let inRange = false;
        for (const l of parsed) {
          if (l.kind === "file" || l.kind === "hunk") continue;
          const no = l[key];
          if (no !== undefined) inRange = no >= facts.line && no <= facts.endLine;
          if (inRange) out.push(l);
        }
        if (!stale) setLines(out);
      })
      .catch((e: Error) => !stale && setError(e.message));
    return () => {
      stale = true;
    };
  }, [comparison.head.sha, loc?.path, facts?.line, facts?.endLine, side]);

  if (!facts || !loc) return <p className="rail-note">Refract could not find {method} in {change.name}.</p>;
  if (error) return <p className="rail-note">Could not load the code: {error}</p>;
  if (!lines) return <div className="skeleton" />;
  return (
    <div className="method-code">
      <div className="method-code-path">
        {loc.path}:{facts.line}
        {change.status === "removed" ? " (removed)" : ""}
      </div>
      <DiffLines lines={lines} />
    </div>
  );
}
