import { existsSync } from "node:fs";
import { AreaAssigner, UNASSIGNED } from "../core/areas.js";
import { draftAreas } from "../core/draft-areas.js";
import type { Workspace } from "../core/workspace.js";

/** `refract areas`: shows the current areas, or drafts them with Claude Code. */
export async function runAreasCommand(ws: Workspace, spec: string | undefined, draft: boolean) {
  const { head } = await ws.range(spec);
  const snap = await ws.store.snapshot(await ws.git.resolve(head));
  if (draft) {
    process.stderr.write(`Asking Claude Code to draft business areas for ${Object.keys(snap.classes).length} classes…\n`);
    await draftAreas(ws, snap, { overwrite: true });
    process.stderr.write(`Wrote ${ws.areasPath}. Edit it freely; Refract re-reads it on change.\n`);
  }
  const map = await ws.areaMap(snap);
  const assigner = new AreaAssigner(map, [snap]);
  const counts = new Map<string, { classes: number; lines: number }>();
  for (const u of Object.values(snap.classes)) {
    const id = assigner.areaOfClass(u.name);
    const c = counts.get(id) ?? { classes: 0, lines: 0 };
    c.classes++;
    c.lines += u.codeLines;
    counts.set(id, c);
  }
  process.stdout.write(
    `${map.source === "file" ? `Areas from ${map.file}` : `Inferred areas (no ${ws.areasPath}${existsSync(ws.areasPath) ? "" : " yet; run refract areas --draft"})`}\n\n`,
  );
  for (const a of [...map.areas, { id: UNASSIGNED, name: "Unassigned", description: "" }]) {
    const c = counts.get(a.id);
    if (!c) continue;
    process.stdout.write(`  ${a.name.padEnd(36)} ${String(c.classes).padStart(4)} classes ${String(c.lines).padStart(7)} lines\n`);
  }
}
