import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { makeSampleRepo } from "../test/sample.js";
import { Workspace } from "./workspace.js";
import { cachedStory, measuredStory, writeStory } from "./story.js";
import type { Comparison } from "../shared/types.js";

describe("the guided tour", () => {
  let ws: Workspace;
  let c: Comparison;
  beforeAll(async () => {
    ws = await Workspace.open(makeSampleRepo());
    const { base, head } = await ws.range("main..agent/receipts");
    c = await ws.compare(base, head);
  });

  it("builds stops from the measured deltas when Claude has not told it", () => {
    const story = measuredStory(c);
    expect(story.source).toBe("measured");
    const fanIn = story.stops.find((s) => s.id === "fanin-down-ReceiptEmailJob")!;
    expect(fanIn.title).toBe("Fewer classes reach ReceiptEmailJob directly");
    expect(fanIn.classes[0]).toBe("ReceiptEmailJob");
    expect(fanIn.classes).toEqual(expect.arrayContaining(["OrdersController", "Checkout", "Receipts"]));
    expect(story.stops.find((s) => s.id === "new-classes")!.classes).toEqual(expect.arrayContaining(["Receipts", "Payments::Gateway"]));
  });

  it("keeps only class names that exist, fixing a dropped namespace", async () => {
    const fake = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fake-claude-")), "claude");
    const out = {
      summary: "Receipts now go out through one service.",
      stops: [{ title: "One place sends receipts", explain: "x", look: "y", tone: "good", classes: ["Receipts", "Gateway", "NoSuchClass"] }],
    };
    fs.writeFileSync(fake, `#!/usr/bin/env node\nprocess.stdin.resume().on("end", () => process.stdout.write(${JSON.stringify(JSON.stringify({ type: "result", is_error: false, result: "", structured_output: out }))}));\n`);
    fs.chmodSync(fake, 0o755);
    process.env.REFRACT_CLAUDE = fake;
    const story = await writeStory(ws, c);
    expect(story.source).toBe("claude");
    expect(story.stops[0].classes).toEqual(["Receipts", "Payments::Gateway"]);
    expect((await cachedStory(ws, c))?.summary).toBe(out.summary);
  });
});
