import { beforeAll, describe, expect, it } from "vitest";
import { makeSampleRepo } from "../test/sample.js";
import { Workspace } from "./workspace.js";
import { parsePlan } from "./plan.js";
import { printPlanComparison, productFacts } from "./plan-compare.js";
import { sharedSurface, surfaceClasses } from "../shared/plan-surface.js";
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

    // Existing code each plan touches: B adds to Order, A leaves it alone; both add a refund screen to OrdersController.
    const order = c.existing.find((r) => r.name === "Order")!;
    expect(order.cells).toEqual([null, "+ receipt_email"]);
    expect(order.where).toBe("some");
    expect(order.dependents).toBeGreaterThan(0);

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

  it("lists what every plan adds once, each plan's own beneath, by Rails layer", async () => {
    const both = B.replace("public: [receipt_email]", "public: [receipt_email]\n  Receipts:\n    public: [send_for(order)]");
    const c = await ws.comparePlans([parsePlan(A, "a.yml"), parsePlan(both, "b.yml")], "main", "main");
    const [a, b] = c.sides;
    const shared = sharedSurface(c.sides);
    // Both plans add a Receipt model that belongs to orders, and Receipts#send_for.
    expect([...shared].sort()).toEqual(["Receipt#", "Receipt#belongs_to :order", "Receipts#", "Receipts#send_for(order)"]);
    expect(surfaceClasses(a, (k) => !shared.has(k))).toEqual([{ name: "Receipts", role: "service", isNew: true, methods: ["resend(order)"], associations: [] }]);
    expect(surfaceClasses(b, (k) => !shared.has(k)).map((k) => `${k.name}: ${k.methods}`)).toEqual(["Order: receipt_email"]);
    // Totals still count every method a plan adds, shared or not.
    expect(a.surface.methods).toBe(2);
    expect(printPlanComparison(c)).toContain(
      "The same in both: 1 method\n    Models\n      Receipt (new): belongs_to :order\n    Services\n      Receipts (new): send_for(order)\n  A: 2 methods, 2 parameters, of its own:\n    Services\n      Receipts (new): resend(order)\n  B: 2 methods, 1 parameter, of its own:\n    Models\n      Order: +receipt_email",
    );
  });

  it("lists a new model with no methods or associations as persistence only", async () => {
    const plain = A.replace("receipts: { new: true, belongs_to: orders, columns: [sent_at] }", "receipts: { new: true, columns: [sent_at] }");
    const c = await ws.comparePlans([parsePlan(plain, "a.yml"), parsePlan(B, "b.yml")], "main", "main");
    expect(c.sides[0].surface.classes.find((k) => k.name === "Receipt")).toMatchObject({ isNew: true, methods: [], associations: [] });
    expect(printPlanComparison(c)).toContain("Receipt (new): persistence only");
  });

  it("says what each plan does to an existing class in the plan's own words, beside how many depend on it", async () => {
    const adds = "title: Refunds\nclasses:\n  Order:\n    public: [refund(amount)]\n";
    const changes = "title: Totals move\nclasses:\n  Order:\n    note: Totals move elsewhere.\n    public: [-total]\n";
    const noted = "title: Just a note\nclasses:\n  Order:\n    note: Totals move elsewhere.\n";
    const c = await ws.comparePlans([parsePlan(adds, "a.yml"), parsePlan(changes, "b.yml"), parsePlan(noted, "c.yml")], "main", "main");
    const order = c.existing.find((r) => r.name === "Order")!;
    // Adds and removals are listed; with neither, the plan's note is quoted. Nothing is inferred.
    expect(order.cells).toEqual(["+ refund(amount)", "− total", '"Totals move elsewhere."']);
    // Measured from today's code, so the same for every plan.
    expect(order.dependents).toBeGreaterThan(0);
    expect(printPlanComparison(c)).toContain(`Order (${order.dependents})\n    A: + refund(amount)\n    B: − total\n    C: "Totals move elsewhere."`);
  });

  it("reads -name in a class's public list as a method the plan takes away", () => {
    const plan = parsePlan("classes:\n  Order:\n    public: [refund(amount), -total, -self.legacy]\n", "x.yml");
    expect(plan.classes[0].public.map((m) => m.signature)).toEqual(["refund(amount)"]);
    expect(plan.classes[0].remove.map((m) => `${m.scope}:${m.name}`)).toEqual(["instance:total", "class:legacy"]);
  });

  it("calls two plans with the same product a tie on product", async () => {
    const same = A.replace("depends_on: [ReceiptEmailJob, Order]", "depends_on: [ReceiptEmailJob, Order, User]");
    const c = await ws.comparePlans([parsePlan(A, "a.yml"), parsePlan(same, "b.yml")], "main", "main");
    expect(c.product.every((r) => r.where === "all")).toBe(true);
  });

  it("offers combining when one plan has the simpler interface and another the leaner request", async () => {
    // Same product. The second asks callers to learn less (one method), but its controller makes two calls itself.
    const busy = A.replace("public: [send_for(order), resend(order)]", "public: [send_for(order)]").replace(
      "    - OrdersController#create\n    - Receipts#send_for\n    - ReceiptEmailJob.perform_later",
      "    - OrdersController#create:\n        - Receipts#send_for\n        - ReceiptEmailJob.perform_later",
    );
    const c = await ws.comparePlans([parsePlan(A, "a.yml"), parsePlan(busy, "b.yml")], "main", "main");
    expect(c.sides[1].flows[0].entryCalls).toBe(2);
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
