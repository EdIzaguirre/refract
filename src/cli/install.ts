import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Copies the /refract command into ~/.claude/commands so Claude Code can start Refract. */
export async function installCommand() {
  const source = path.resolve(here, "../../claude/commands/refract.md");
  const target = path.join(os.homedir(), ".claude", "commands", "refract.md");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
  process.stdout.write(`Installed /refract for Claude Code at ${target}\n`);
}
