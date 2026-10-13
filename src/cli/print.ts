import type { Comparison, Tone } from "../shared/types.js";

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = paint("2");
const bold = paint("1");
const toneColor: Record<Tone, (s: string) => string> = {
  good: paint("32"),
  bad: paint("31"),
  ask: paint("33"),
  flat: paint("2"),
};

/** The comparison as a terminal report: verdict, deltas, then the classes that moved. */
export function printComparison(c: Comparison): string {
  const out: string[] = [];
  out.push(bold(`Refract · ${c.repo.name}`));
  out.push(dim(`${c.base.ref} (${c.base.short}) → ${c.head.ref} (${c.head.short})  ${c.head.subject}`));
  out.push(
    dim(
      `${c.stats.files} files · +${c.stats.additions} −${c.stats.deletions} · ${c.stats.appFiles} app, ${c.stats.testFiles} test · areas ${c.areaSource === "file" ? `from ${c.areaFile}` : "inferred (run `refract areas --draft`)"}`,
    ),
  );
  out.push("");
  out.push(`${toneColor[c.verdict.tone](bold(c.verdict.label))}  ${c.verdict.summary}`);
  out.push("");
  for (const d of c.deltas) {
    const nums = d.before != null ? `${d.before} → ${d.after}` : d.after;
    out.push(`  ${toneColor[d.tone]("●")} ${d.what}: ${bold(nums)} ${toneColor[d.tone](`(${d.change})`)}`);
    out.push(dim(`      ${d.why}`));
  }
  out.push("");

  const moved = c.classes.filter((k) => k.status !== "unchanged");
  const byArea = new Map<string, typeof moved>();
  for (const k of moved) byArea.set(k.area, [...(byArea.get(k.area) ?? []), k]);
  const areaName = (id: string) => c.areas.find((a) => a.id === id)?.name ?? id;
  out.push(bold("Classes that changed shape"));
  out.push(dim("  public methods × code lines (Ousterhout: width × height)"));
  for (const [area, list] of [...byArea].sort((a, b) => b[1].length - a[1].length)) {
    out.push(`  ${bold(areaName(area))}`);
    for (const k of list.sort((a, b) => a.name.localeCompare(b.name))) {
      const s = (x: typeof k.shape.before) => (x ? `${x.interface} × ${x.codeLines}` : "—");
      const mark = k.status === "added" ? toneColor.good("+") : k.status === "removed" ? toneColor.bad("−") : "~";
      const methods = k.methods.filter((m) => m.status !== "unchanged");
      const detail = methods
        .slice(0, 6)
        .map((m) => {
          const sign = m.status === "added" ? "+" : m.status === "removed" ? "−" : "~";
          const lines = m.before && m.after ? ` ${m.before.codeLines}→${m.after.codeLines}` : "";
          return `${sign}${m.scope === "class" ? "self." : ""}${m.name}${lines}`;
        })
        .join(" ");
      out.push(`    ${mark} ${k.name.padEnd(46)} ${s(k.shape.before).padStart(9)} → ${s(k.shape.after).padEnd(9)} ${dim(detail)}${methods.length > 6 ? dim(` +${methods.length - 6}`) : ""}`);
    }
  }
  const added = c.edges.filter((e) => e.status === "added");
  const removed = c.edges.filter((e) => e.status === "removed");
  if (added.length || removed.length) {
    out.push("");
    out.push(bold("Dependencies"));
    for (const e of removed.slice(0, 20)) out.push(`  ${toneColor.bad("−")} ${e.from} → ${e.to} ${dim(e.kind)}`);
    for (const e of added.slice(0, 20)) out.push(`  ${toneColor.good("+")} ${e.from} → ${e.to} ${dim(e.kind)}`);
    const more = Math.max(0, removed.length - 20) + Math.max(0, added.length - 20);
    if (more) out.push(dim(`  … and ${more} more`));
  }
  return out.join("\n");
}
