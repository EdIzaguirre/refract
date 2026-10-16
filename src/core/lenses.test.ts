import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { makeSampleRepo } from "../test/sample.js";
import { Workspace } from "./workspace.js";
import { cachedLenses, factsFor, runLenses } from "./lenses.js";
import { extractJson } from "./claude.js";

describe("lenses", () => {
  let ws: Workspace;
  beforeAll(async () => {
    ws = await Workspace.open(makeSampleRepo());
    // A stand-in for `claude -p` that answers each lens and the disagreement pass.
    const fake = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fake-claude-")), "claude");
    fs.writeFileSync(
      fake,
      `#!/usr/bin/env node
let input = "";
process.stdin.on("data", (d) => (input += d)).on("end", () => {
  const out = input.includes("Find the places where they would disagree")
    ? { disagreements: [{ topic: "Receipts", positions: { metz: "likes it", ousterhout: "asks" }, tradeoff: "one place or more classes" }] }
    : { questions: [{ tone: "asks", text: "Who else queues the receipt job?", evidence: "fan-in 2 to 1", source: "2.3.1", target: { kind: "class", name: "Receipts" } }] };
  process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "", structured_output: out }));
});
`,
    );
    fs.chmodSync(fake, 0o755);
    process.env.REFRACT_CLAUDE = fake;
  });

  it("asks all three lenses, finds disagreements and caches the report", async () => {
    const { base, head } = await ws.range("main..agent/receipts");
    const c = await ws.compare(base, head);
    const facts = factsFor(c);
    expect(facts.classes.map((k) => k.name)).toContain("Receipts");
    expect(facts.classes.every((k) => k.status !== "unchanged")).toBe(true);

    const report = await runLenses(ws, c);
    expect(report.status).toBe("done");
    expect(report.lenses.map((l) => l.lens).sort()).toEqual(["copeland", "metz", "ousterhout"]);
    expect(report.lenses[0].questions[0].target?.name).toBe("Receipts");
    expect(report.disagreements[0].topic).toBe("Receipts");
    expect((await cachedLenses(ws, c))?.head).toBe(c.head.sha);
  });

  it("pulls JSON out of a fenced reply", () => {
    expect(extractJson<{ a: number }>('Here you go:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });
});
