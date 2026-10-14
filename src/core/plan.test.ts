import { beforeAll, describe, expect, it } from "vitest";
import { makeSampleRepo } from "../test/sample.js";
import { Workspace } from "./workspace.js";
import { PLAN_FORMAT, parsePlan, signature } from "./plan.js";
import { planStory } from "./plan-preview.js";
import { sequenceFor } from "./flows.js";
import type { PlanItem } from "../shared/types.js";

const PLAN = `
title: Receipts in one place
why: Callers stop queuing the receipt job themselves.
classes:
  Receipts:
    note: Owns sending receipts.
    public: [send_for(order), resend(order)]
    depends_on: [ReceiptEmailJob, Order]
screens:
  OrdersController: [+refund]
flows:
  "customer pays":
    - OrdersController#create
    - Checkout#complete
    - Receipts#send_for
    - ReceiptEmailJob.perform_later
`;

describe("plan files", () => {
  it("reads every section of the documented format", () => {
    const p = parsePlan(PLAN_FORMAT, "/x/plans/ofr-updates.yml");
    expect(p.problems).toEqual([]);
    expect(p.name).toBe("ofr-updates");
    expect(p.title).toBe("Invoices for approved timesheets");
    const fees = p.tables.find((t) => t.name === "fees")!;
    expect(fees).toMatchObject({ isNew: true, belongsTo: ["orgs"] });
    expect(fees.columns).toContainEqual({ name: "price_cents", type: "integer" });
    expect(p.tables.find((t) => t.name === "timesheets")).toMatchObject({ isNew: false, remove: ["legacy_total"] });
    expect(p.lifecycles[0]).toMatchObject({ model: "Timesheet", field: "state", addStates: ["sent"] });
    expect(p.lifecycles[0].moves).toContainEqual({ from: "approved", to: "sent" });
    expect(p.screens.find((s) => s.controller === "Org::TimesheetsController")!.actions).toEqual([
      { name: "mark_sent", op: "+" },
      { name: "legacy", op: "-" },
    ]);
    expect(p.jobs).toEqual([{ name: "InvoiceMailer", methods: ["invoice_sent"] }]);
    const charges = p.classes[0];
    expect(charges.public.map((m) => [m.name, m.scope, m.params])).toEqual([
      ["add_fee", "instance", 3],
      ["reprice", "instance", 2],
      ["for", "class", 1],
    ]);
    const chain = p.flows[0];
    expect(chain.calls).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 2 },
    ]);
    // A step with steps under it calls each of them.
    const tree = p.flows[1];
    expect(tree.calls).toEqual([
      { from: 0, to: 1 },
      { from: 0, to: 2 },
    ]);
  });

  it("counts parameters only when the plan writes them", () => {
    expect(signature("assign_numbers!").params).toBeNull();
    expect(signature("call()").params).toBe(0);
    expect(signature("build(a, b: {x: 1}, &blk)").params).toBe(2);
  });

  it("says what it could not read and keeps the rest", () => {
    const p = parsePlan("title: x\nflows:\n  f: [nonsense]\nextras: 1\n");
    expect(p.problems).toHaveLength(2);
    expect(parsePlan(":\n  - [").problems[0]).toMatch(/not valid YAML/);
  });
});

describe("plans against the sample shop", () => {
  let ws: Workspace;
  beforeAll(async () => {
    ws = await Workspace.open(makeSampleRepo());
  });

  it("draws a plan as the after side of today's code", async () => {
    const plan = parsePlan(PLAN, "receipts.yml");
    const { comparison: c, after } = await ws.previewPlan(plan, "main");
    expect(c.plan?.mode).toBe("preview");
    const receipts = c.classes.find((k) => k.name === "Receipts")!;
    expect(receipts).toMatchObject({ status: "added", planned: true, sizeUnknown: true, role: "service" });
    expect(receipts.shape.after!.interface).toBe(2);
    expect(receipts.paths[0]).toBe("app/services/receipts.rb");
    const controller = c.classes.find((k) => k.name === "OrdersController")!;
    expect(controller).toMatchObject({ status: "changed", planned: true });
    expect(controller.methods.find((m) => m.name === "refund")?.status).toBe("added");
    expect(c.edges.find((e) => e.from === "Receipts" && e.to === "ReceiptEmailJob")).toMatchObject({ status: "added", planned: true });
    expect(c.product?.screens).toEqual([{ controller: "OrdersController", status: "changed", actions: [{ name: "refund", status: "added" }] }]);
    expect(c.verdict.label).toBe("Planned");
    // The planned calls draw as a request flow.
    const seq = sequenceFor(after, null, "Checkout", "complete");
    expect(seq.messages.map((m) => `${m.from}>${m.to}.${m.label}`)).toContain("Checkout>Receipts.send_for");
    const story = planStory(c, plan);
    expect(story.stops[0].title).toBe("A new service: Receipts");
    expect(story.stops.some((s) => s.title === "How it runs: customer pays")).toBe(true);
  });

  it("lists what was built, what is missing, what is a surprise and what differs", async () => {
    const plan = parsePlan(PLAN, "receipts.yml");
    const { base, head } = await ws.range("main..agent/receipts");
    const c = await ws.compare(base, head);
    const { items } = await ws.checkPlan(c, plan);
    const of = (status: PlanItem["status"]) => items.filter((i) => i.status === status).map((i) => i.text);
    expect(of("built")).toEqual(expect.arrayContaining(["Receipts", '"customer pays"']));
    expect(of("missing")).toEqual(expect.arrayContaining(["Receipts#resend", "refund on OrdersController"]));
    expect(of("different")).toEqual(expect.arrayContaining(["Receipts#send_for takes 2 parameters; the plan said 1", "Receipts does not use Order"]));
    expect(of("surprise")).toEqual(expect.arrayContaining(["A new service: Payments::Gateway", "Order gained coupon, subtotal and discount", "Checkout.new now takes 2 parameters (was 1)"]));
  });
});
