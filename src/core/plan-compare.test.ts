import { beforeAll, describe, expect, it } from "vitest";
import { makeSampleRepo } from "../test/sample.js";
import { Workspace } from "./workspace.js";
import { parsePlan } from "./plan.js";
import { printPlanComparison, productFacts } from "./plan-compare.js";
import { newDependencies, sharedDependencies } from "../shared/plan-dependencies.js";
import { sharedMethods, surfaceClasses } from "../shared/plan-surface.js";
import { singularize } from "./inflect.js";

// Two designs for one goal: a Receipts service the controller calls once, or the controller doing it all.
const A = `
title: Receipts in one place
approach: One Receipts service owns sending; the controller calls it once.
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
    const c = await ws.comparePlans([parsePlan(A, "a.yml"), parsePlan(B, "b.yml")], "main", "main");
    expect(c.base.ref).toBe("main");
    const [a, b] = c.sides;

    // Product first: both add receipts, with different columns, and only B adds a resend action.
    const receipts = c.product.find((r) => r.subject === "receipts")!;
    expect(receipts.where).toBe("some");
    expect(receipts.cells[0]).toBe("New table receipts: sent_at, order_id");
    expect(c.product.find((r) => r.part === "screens")).toMatchObject({ where: "some", cells: ["Orders: adds refund", "Orders: adds refund, resend"] });

    // Controllers are screens, not interface: A's surface is the Receipts service, B's one method on Order.
    expect(a.surface).toMatchObject({ methods: 2, params: 2 });
    expect(a.surface.classes[0]).toMatchObject({ name: "Receipts", isNew: true, methods: ["send_for(order)", "resend(order)"] });
    expect(b.surface).toMatchObject({ methods: 1, params: 0 });
    expect(b.surface.classes[0]).toMatchObject({ name: "Order", isNew: false });

    // The same request pairs up by name, whatever the case.
    expect(c.flows).toEqual([{ title: "customer pays", at: [0, 0] }]);
    expect(a.flows[0].entryCalls).toBe(1);
    expect(b.flows[0].entryCalls).toBe(2);
    expect(b.flows[0].calls).toEqual(["OrdersController → Order#receipt_email", "OrdersController → ReceiptEmailJob.perform_later"]);
    expect(a.flows[0].sequence.messages.map((m) => `${m.from}>${m.to}.${m.label}`)).toEqual(["OrdersController>Receipts.send_for", "Receipts>ReceiptEmailJob.perform_later"]);

    // The drawing keeps only what the plan touches and what it points at.
    expect(a.drawing.classes.map((k) => k.name).sort()).toEqual(["Order", "OrdersController", "ReceiptEmailJob", "Receipts", "Receipt"].sort());

    // Both plans add a receipts table that belongs to orders, so that dependency is drawn once; the rest are each plan's own.
    const shared = sharedDependencies(c.sides);
    expect([...shared]).toEqual(["Receipt → Order"]);
    expect(newDependencies(a, shared).map((e) => `${e.from} → ${e.to}`).sort()).toEqual(["OrdersController → Receipts", "Receipts → Order", "Receipts → ReceiptEmailJob"]);
    // B's only new dependency is the shared one, so B has nothing of its own to draw.
    expect(newDependencies(b, shared)).toEqual([]);

    // The note quotes Ch 11 and says plans weigh interfaces only.
    const note = c.note.lines.join(" ");
    expect(c.note.source).toBe('Ch 11 "Design it Twice"');
    expect(note).toContain('"Does one alternative have a simpler interface than another?" Plan B');
    expect(note).toContain("ease of use for higher level software");
    expect(note).toMatch(/differ in the product/);
    expect(printPlanComparison(c)).toContain("Where they part ways");
    // Each plan says how it differs; B has no approach, so it prints only its title.
    expect(a.plan.approach).toBe("One Receipts service owns sending; the controller calls it once.");
    expect(printPlanComparison(c)).toContain("A: Receipts in one place (a)\n     One Receipts service owns sending; the controller calls it once.\n  B: The controller sends receipts (b)\n");
  });

  it("lists the public methods every plan adds once, and each plan's own beneath", async () => {
    const both = B.replace("public: [receipt_email]", "public: [receipt_email]\n  Receipts:\n    public: [send_for(order)]");
    const c = await ws.comparePlans([parsePlan(A, "a.yml"), parsePlan(both, "b.yml")], "main", "main");
    const [a, b] = c.sides;
    const shared = sharedMethods(c.sides);
    expect([...shared]).toEqual(["Receipts#send_for(order)"]);
    expect(surfaceClasses(a, (k) => !shared.has(k))).toEqual([{ name: "Receipts", role: "service", isNew: true, methods: ["resend(order)"] }]);
    expect(surfaceClasses(b, (k) => !shared.has(k)).map((k) => `${k.name}: ${k.methods}`)).toEqual(["Order: receipt_email"]);
    // Totals still count every method a plan adds, shared or not.
    expect(a.surface.methods).toBe(2);
    expect(printPlanComparison(c)).toContain("The same in both: 1 method\n    Receipts (new): send_for(order)\n  A: 2 methods, 2 parameters, of its own:\n    Receipts (new): resend(order)\n  B: 2 methods, 1 parameter");
  });

  it("calls two plans with the same product a tie on product, and offers combining when each wins once", async () => {
    const same = A.replace("depends_on: [ReceiptEmailJob, Order]", "depends_on: [ReceiptEmailJob, Order, User]");
    const fewer = A.replace("public: [send_for(order), resend(order)]", "public: [send_for(order)]").replace("depends_on: [ReceiptEmailJob, Order]", "depends_on: [ReceiptEmailJob, Order, User, Checkout]");
    const c = await ws.comparePlans([parsePlan(same, "a.yml"), parsePlan(fewer, "b.yml")], "main", "main");
    expect(c.product.every((r) => r.where === "all")).toBe(true);
    expect(c.note.lines.join(" ")).toContain("combine features of multiple alternatives");
  });

  it("lines up three plans, leaves gaps where a plan skips something, and stops at four", async () => {
    const C = `
title: A receipts job
tables:
  receipts: { new: true, belongs_to: orders, columns: [sent_at] }
classes:
  ReceiptEmailJob:
    public: [self.deliver(order)]
`;
    const plans = [parsePlan(A, "a.yml"), parsePlan(B, "b.yml"), parsePlan(C, "c.yml")];
    const c = await ws.comparePlans(plans, "main", "main");
    expect(c.sides.map((s) => s.label)).toEqual(["A", "B", "C"]);
    // C draws no request, so its cell is empty.
    expect(c.flows).toEqual([{ title: "customer pays", at: [0, 0, null] }]);
    // C adds no screen, so the screen row has a gap for it.
    expect(c.product.find((r) => r.part === "screens")!.cells[2]).toBeNull();
    // A and C build the same receipts table, B a different one: still a row where they part ways.
    expect(c.product.find((r) => r.subject === "receipts")).toMatchObject({ where: "some", cells: ["New table receipts: sent_at, order_id", "New table receipts: sent_at, email, order_id", "New table receipts: sent_at, order_id"] });
    expect(c.note.lines[0]).toContain("the widest, Plan A,");
    expect(printPlanComparison(c)).toMatch(/^Three plans/);
    await expect(ws.comparePlans([...plans, ...plans], "main", "main")).rejects.toThrow(/2 to 4 plans/);
  });

  it("draws plans against a chosen base, not where a branch of the same name left main", async () => {
    const { base, from } = await ws.planBase("agent/receipts", "agent/receipts");
    expect(base).toBe(await ws.git.resolve("agent/receipts"));
    expect(from).toBe("agent/receipts");
    expect((await ws.planBase("agent/receipts")).base).toBe(await ws.git.mergeBase("main", "agent/receipts"));
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
    expect(["people", "care_people", "children"].map(singularize)).toEqual(["person", "care_person", "child"]);
  });
});
