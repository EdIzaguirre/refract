import { useMemo } from "react";
import hljs from "highlight.js/lib/core";
import ruby from "highlight.js/lib/languages/ruby";

hljs.registerLanguage("ruby", ruby);

export interface Line {
  kind: "add" | "del" | "ctx" | "hunk" | "file";
  old?: number;
  new?: number;
  html: string;
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A unified diff with line numbers and Ruby highlighting. */
export function CodeDiff({ diff }: { diff: string }) {
  const lines = useMemo(() => parse(diff), [diff]);
  return <DiffLines lines={lines} />;
}

export function DiffLines({ lines }: { lines: Line[] }) {
  return (
    <div className="diff">
      {lines.map((l, i) =>
        l.kind === "file" ? (
          <div key={i} className="file" dangerouslySetInnerHTML={{ __html: l.html }} />
        ) : (
          <div key={i} className={`ln ${l.kind}`}>
            <span className="no">{l.old ?? ""}</span>
            <span className="no">{l.new ?? ""}</span>
            <span dangerouslySetInnerHTML={{ __html: l.html }} />
          </div>
        ),
      )}
    </div>
  );
}

export function parse(diff: string): Line[] {
  const out: Line[] = [];
  let o = 0;
  let n = 0;
  let ruby = false;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git")) {
      const file = raw.split(" b/").pop() ?? raw;
      ruby = /\.(rb|rake)$/.test(file);
      out.push({ kind: "file", html: escape(file) });
      continue;
    }
    if (/^(index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(raw)) continue;
    const h = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (h) {
      o = Number(h[1]);
      n = Number(h[2]);
      out.push({ kind: "hunk", html: escape(raw) });
      continue;
    }
    if (raw === "" || raw.startsWith("\\")) continue;
    const sign = raw[0];
    const code = raw.slice(1);
    const html = ruby ? hljs.highlight(code, { language: "ruby", ignoreIllegals: true }).value : escape(code);
    if (sign === "+") out.push({ kind: "add", new: n++, html: `+${html}` });
    else if (sign === "-") out.push({ kind: "del", old: o++, html: `-${html}` });
    else out.push({ kind: "ctx", old: o++, new: n++, html: ` ${html}` });
  }
  return out;
}
