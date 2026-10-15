import { beforeAll, describe, expect, it } from "vitest";
import { makeSampleRepo } from "../test/sample.js";
import { Workspace } from "./workspace.js";
import { parsePlan } from "./plan.js";
import { printPlanComparison, productFacts } from "./plan-compare.js";
import { singularize } from "./inflect.js";

// Two designs for one goal: a Receipts service the controller calls once, or the controller doing it all.
const A = `
title: Receipts in one place
tables:
  receipts: { new: true, belongs_to: orders, columns: [sent_at] }
screens:
  OrdersController: [+refund]
classes:
  Receipts:
    public: [send_for(order), resend(order)]
    depends_on: [ReceiptEmailJob, Order]
flows:
  "customer pays":
    - OrdersController#create
    - Receipts#send_for
    - ReceiptEmailJob.perform_later
`;
const B = `
title: The controller sends receipts
tables:
  receipts: { new: true, belongs_to: orders, columns: [sent_at, email] }
screens:
  OrdersController: [+refund, +resend]
classes:
  Order:
    public: [receipt_email]
flows:
  "Customer pays":
    - OrdersController#create:
        - Order#receipt_email
        - ReceiptEmailJob.perform_later
`;

describe("two plans side by side", () => {
  let ws: Workspace;
  beforeAll(async () => {
    ws = await Workspace.open(makeSampleRepo());
  });

  it("lays out product facts, interfaces, arrows and the same request under each", async () => {
    const c = await ws.comparePlans(parsePlan(A, "a.yml"), parsePlan(B, "b.yml"), "main", "main");
    expect(c.base.ref).toBe("main");
    const [a, b] = c.sides;

    // Product first: both add receipts, with different columns, and only B adds a resend action.
    const receipts = c.product.find((r) => r.subject === "receipts")!;
    expect(receipts.where).toBe("different");
    expect(receipts.a).toBe("New table receipts: sent_at, order_id");
    expect(c.product.find((r) => r.part === "screens")).toMatchObject({ where: "different", b: "Orders: adds refund, resend" });

    // Controllers are screens, not interface: A's surface is the Receipts service, B's one method on Order.
    expect(a.surface).toMatchObject({ methods: 2, params: 2 });
    expect(a.surface.classes[0]).toMatchObject({ name: "Receipts", isNew: true, methods: ["send_for(order)", "resend(order)"] });
    expect(b.surface).toMatchObject({ methods: 1, params: 0 });
    expect(b.surface.classes[0]).toMatchObject({ name: "Order", isNew: false });

    // The same request pairs up by name, whatever the case.
    expect(c.flows).toEqual([{ title: "customer pays", a: 0, b: 0 }]);
    expect(a.flows[0].entryCalls).toBe(1);
    expect(b.flows[0].entryCalls).toBe(2);
    expect(b.flows[0].calls).toEqual(["OrdersController → Order#receipt_email", "OrdersController → ReceiptEmailJob.perform_later"]);
    expect(a.flows[0].sequence.messages.map((m) => `${m.from}>${m.to}.${m.label}`)).toEqual(["OrdersController>Receipts.send_for", "Receipts>ReceiptEmailJob.perform_later"]);

    // The drawing keeps only what the plan touches and what it points at.
    expect(a.drawing.classes.map((k) => k.name).sort()).toEqual(["Order", "OrdersController", "ReceiptEmailJob", "Receipts", "Receipt"].sort());

    // The note quotes Ch 11 and says plans weigh interfaces only.
    const note = c.note.lines.join(" ");
    expect(c.note.source).toBe('Ch 11 "Design it Twice"');
    expect(note).toContain('"Does one alternative have a simpler interface than another?" Plan B');
    expect(note).toContain("ease of use for higher level software");
    expect(note).toMatch(/differ in the product/);
    expect(printPlanComparison(c)).toContain("Both plans touch these, in different ways");
  });

  it("calls two plans with the same product a tie on product, and offers combining when each wins once", async () => {
    const same = A.replace("depends_on: [ReceiptEmailJob, Order]", "depends_on: [ReceiptEmailJob, Order, User]");
    const fewer = A.replace("public: [send_for(order), resend(order)]", "public: [send_for(order)]").replace("depends_on: [ReceiptEmailJob, Order]", "depends_on: [ReceiptEmailJob, Order, User, Checkout]");
    const c = await ws.comparePlans(parsePlan(same, "a.yml"), parsePlan(fewer, "b.yml"), "main", "main");
    expect(c.product.every((r) => r.where === "both")).toBe(true);
    expect(c.note.lines.join(" ")).toContain("combine features of multiple alternatives");
  });

  it("reads product facts in plain words", () => {
    const facts = productFacts({
      tables: [{ name: "timesheets", status: "changed", columns: [{ name: "sent_at", type: "", status: "added" }, { name: "legacy", type: "", status: "removed" }], otherColumns: 3, references: [], checks: { added: 0, removed: 0 } }],
      migrations: [],
      screens: [],
      routes: { added: [], removed: [] },
      permissions: [{ policy: "TimesheetPolicy", rule: "mark_sent?", status: "added" }],
      lifecycles: [{ model: "Timesheet", field: "state", status: "changed", before: ["open"], after: ["open", "sent"], moves: [{ from: "open", to: "sent", status: "added" }] }],
      jobs: [],
    });
    expect(facts.map((f) => f.text)).toEqual(["timesheets: adds sent_at; drops legacy", "Timesheet.state: adds sent; new moves open → sent", "TimesheetPolicy: mark_sent?"]);
  });

  it("singularizes table names as Rails does", () => {
    expect(["expenses", "statuses", "addresses", "fees", "boxes", "categories"].map(singularize)).toEqual(["expense", "status", "address", "fee", "box", "category"]);
  });
});
