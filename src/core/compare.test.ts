import { beforeAll, describe, expect, it } from "vitest";
import { makeSampleRepo } from "../test/sample.js";
import { Workspace } from "./workspace.js";
import type { Comparison } from "../shared/types.js";

describe("compare on the sample shop", () => {
  let c: Comparison;
  let ws: Workspace;
  beforeAll(async () => {
    ws = await Workspace.open(makeSampleRepo());
    const { base, head } = await ws.range("main..agent/receipts");
    c = await ws.compare(base, head);
  });

  it("finds added and changed classes with their shapes", () => {
    const receipts = c.classes.find((k) => k.name === "Receipts")!;
    expect(receipts.status).toBe("added");
    expect(receipts.nested).toEqual(["Receipts::Result"]);
    // Result's lines fold into Receipts; its methods do not widen the interface.
    expect(receipts.shape.after).toMatchObject({ interface: 1 });

    const order = c.classes.find((k) => k.name === "Order")!;
    expect(order.status).toBe("changed");
    expect(
      order.methods
        .filter((m) => m.status === "added")
        .map((m) => m.name)
        .sort(),
    ).toEqual(["coupon", "discount", "subtotal"]);
    expect(c.classes.find((k) => k.name === "User")!.status).toBe("unchanged");
  });

  it("tracks dependencies that moved", () => {
    const status = (from: string, to: string) => c.edges.find((e) => e.from === from && e.to === to)?.status;
    expect(status("OrdersController", "ReceiptEmailJob")).toBe("removed");
    expect(status("Checkout", "ReceiptEmailJob")).toBe("removed");
    expect(status("Receipts", "ReceiptEmailJob")).toBe("added");
    expect(status("Checkout", "Payments::Gateway")).toBe("added");
  });

  it("reports the consolidation as a good delta", () => {
    const fanIn = c.deltas.find((d) => d.id === "fanin-down-ReceiptEmailJob")!;
    expect(fanIn).toMatchObject({ before: "2", after: "1", tone: "good" });
    expect(c.deltas.find((d) => d.id === "new-classes")!.after).toBe("2");
  });

  it("weighs better against worse, and never counts a question as worse", () => {
    const { good, bad, ask, label } = c.verdict;
    expect(good).toBeGreaterThan(bad);
    expect(label).toBe(bad === 0 ? `Better${ask ? ", with questions" : ""}` : `Mostly better${ask ? ", with questions" : ""}`);
  });

  it("puts new classes in the area of the classes they work with", () => {
    const area = (n: string) => c.classes.find((k) => k.name === n)!.area;
    expect(area("Payments::Gateway")).toBe(area("Checkout"));
    expect(area("Receipts")).toBe(area("Checkout"));
  });

  it("lists commits for the timeline", async () => {
    const commits = await ws.git.commitsBetween(c.base.sha, c.head.sha);
    expect(commits.map((x) => x.subject)).toEqual([
      "Move receipt sending into a Receipts service",
      "Support coupons on orders",
      "Charge through a payment gateway before marking paid",
    ]);
  });
});
