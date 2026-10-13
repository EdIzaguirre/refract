import { existsSync } from "node:fs";
import type { AreaMap, Snapshot } from "../shared/types.js";
import { AreaAssigner, UNASSIGNED, inferAreas, writeAreaFile } from "./areas.js";
import { askClaude } from "./claude.js";
import type { Workspace } from "./workspace.js";

const SCHEMA = {
  type: "object",
  properties: {
    areas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          classes: { type: "array", items: { type: "string" } },
          paths: { type: "array", items: { type: "string" } },
        },
        required: ["name", "classes", "paths"],
      },
    },
  },
  required: ["areas"],
};

/**
 * Asks Claude Code to group the codebase into business areas, once. The
 * result is written to ~/.refract/<repo>/areas.yml for the person to correct;
 * Refract never redrafts over their edits unless asked.
 */
export async function draftAreas(ws: Workspace, snap: Snapshot, opts: { overwrite?: boolean } = {}): Promise<AreaMap> {
  if (existsSync(ws.areasPath) && !opts.overwrite) throw new Error(`${ws.areasPath} already exists`);
  const units = Object.values(snap.classes).sort((a, b) => a.name.localeCompare(b.name));
  const lines = units.map((u) => {
    const deps = u.dependsOn
      .filter((d) => d.kind !== "inherits")
      .slice(0, 6)
      .map((d) => d.to)
      .join(",");
    return `${u.name} | ${u.role} | ${u.locations[0]?.path} | ${u.codeLines} | ${deps}`;
  });
  const guess = inferAreas(snap);
  const prompt = `Group this codebase into its business areas: the parts a product person would name (for example "Invitations & Sign-in", "Billing", "Reporting"), not technical layers. A developer will use the areas to see where a code change landed, so each area should hold the models, controllers, services, jobs and views of one part of the product.

Aim for 8 to 16 areas. Every class should land in an area; put shared infrastructure (base classes, auth plumbing, utilities) in one area such as "Platform". Give each area a one-sentence description.

Match classes with "classes" globs on the fully qualified class name, with "::" written as "/" (for example "ClientInvitation*", "**/ClientInvitation*", "Kvc/**"). Match files with "paths" globs on repository paths (for example "app/**/kvc/**"). Prefer a few broad globs over listing every class. Earlier areas win when globs overlap, so put specific areas first.

An automatic grouping by dependencies, for reference (often wrong about names and boundaries):
${guess.areas.map((a) => `- ${a.name}: ${a.classes.slice(0, 8).join(", ")}${a.classes.length > 8 ? ", …" : ""}`).join("\n")}

Classes (name | role | file | code lines | depends on):
${lines.join("\n")}`;
  const out = await askClaude<{ areas: { name: string; description?: string; classes: string[]; paths: string[] }[] }>(prompt, SCHEMA, {
    cwd: ws.git.root,
  });
  const map: AreaMap = {
    source: "file",
    file: ws.areasPath,
    areas: out.areas.map((a, i) => ({
      id: a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || `area-${i}`,
      name: a.name,
      description: a.description,
      classes: a.classes ?? [],
      paths: a.paths ?? [],
    })),
  };
  const assigner = new AreaAssigner(map, [snap]);
  const missed = units.filter((u) => assigner.areaOfClass(u.name) === UNASSIGNED).length;
  await writeAreaFile(
    ws.areasPath,
    map,
    `Drafted by Claude Code on ${new Date().toISOString().slice(0, 10)} from ${units.length} classes${missed ? `; ${missed} matched no area` : ""}.`,
  );
  return map;
}
