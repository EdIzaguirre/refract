import { beforeAll, describe, expect, it } from "vitest";
import { makeSampleRepo } from "../test/sample.js";
import { Workspace } from "./workspace.js";
import { sequenceFor, staticFlow, traceFlows } from "./flows.js";
import type { Comparison } from "../shared/types.js";

describe("request flows", () => {
  let ws: Workspace;
  let c: Comparison;
  beforeAll(async () => {
    ws = await Workspace.open(makeSampleRepo());
    const { base, head } = await ws.range("main..agent/receipts");
    c = await ws.compare(base, head);
  });

  it("follows static calls into the app's own classes", async () => {
    const snap = await ws.store.snapshot(c.head.sha);
    const calls = staticFlow(snap, "OrdersController", "resend_receipt").calls;
    expect(calls.map((x) => `${x.to}.${x.method}`)).toEqual(expect.arrayContaining(["Receipts.send_for", "ReceiptEmailJob.perform_later"]));
    expect(calls.every((x) => x.source === "static")).toBe(true);
  });

  it("traces the tests with TracePoint and marks observed calls solid", async () => {
    const after = await traceFlows(ws, c, "after");
    expect(after.status).toBe("traced");
    expect([...after.tests].sort()).toEqual(["test/checkout_test.rb", "test/orders_controller_test.rb"]);
    const snap = await ws.store.snapshot(c.head.sha);
    const seq = sequenceFor(snap, after, "Checkout", "complete");
    expect(seq.traced).toBe(true);
    expect(seq.messages.find((m) => m.to === "Payments::Gateway" && m.label === "charge")?.observed).toBe(true);

    const before = await traceFlows(ws, c, "before");
    expect(before.flows.some((f) => f.calls.some((x) => x.from === "OrdersController" && x.to === "ReceiptEmailJob"))).toBe(true);
  });
});
