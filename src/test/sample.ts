import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Builds the sample shop repo (main plus agent/receipts) in a fresh temp dir. */
export function makeSampleRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "refract-test-"));
  const repo = path.join(dir, "shop");
  execFileSync("bash", [path.resolve(here, "../../scripts/make-sample-repo.sh"), repo], { stdio: "ignore" });
  process.env.REFRACT_HOME = path.join(dir, "home");
  return repo;
}
