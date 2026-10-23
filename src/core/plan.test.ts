import { beforeAll, describe, expect, it } from "vitest";
import { makeSampleRepo } from "../test/sample.js";
import { Workspace } from "./workspace.js";
import { PLAN_FORMAT, parsePlan, signature } from "./plan.js";
import { planStory } from "./plan-preview.js";
import { unbuiltRefs, wordsOf } from "./plan-check.js";
import { checkThemes } from "./story.js";
import { surpriseLead, themeCounts } from "../shared/plan-words.js";
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
    expect(fees).toMatchObject({ isNew: true, belongsTo: [{ to: "orgs", column: "org_id" }] });
    // A map names the column when it is not <table>_id, as Rails' class_name does.
    expect(p.tables.find((t) => t.name === "invoices")!.belongsTo).toEqual([{ to: "orgs", column: "billed_to_id" }]);
    expect(parsePlan("tables:\n  x: { new: true, belongs_to: [orgs, { owner_id: users }] }\n").tables[0].belongsTo).toEqual([
      { to: "orgs", column: "org_id" },
      { to: "users", column: "owner_id" },
    ]);
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

  it("reads a plan's short name, for when it sits beside others", () => {
    expect(parsePlan("title: CARE homes, as a small Home model\nshort: Home model\n", "b.yml").short).toBe("Home model");
    expect(parsePlan("title: Receipts\n", "a.yml").short).toBeUndefined();
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

  it("draws a column added to an existing table as a dependency on the table it points at", async () => {
    const plan = parsePlan("tables:\n  orders: { add: [billed_to_id], belongs_to: { billed_to: checkouts } }\n", "billing.yml");
    const { comparison: c } = await ws.previewPlan(plan, "main");
    expect(c.product!.tables[0].references).toEqual([{ to: "checkouts", column: "billed_to_id", one: false, status: "added" }]);
    expect(c.edges.find((e) => e.from === "Order" && e.to === "Checkout")).toMatchObject({ planned: true });
  });

  it("draws part_of as composition: the owner has many and takes them with it", async () => {
    const plan = parsePlan("tables:\n  order_notes: { new: true, part_of: orders, columns: [body] }\n", "notes.yml");
    expect(plan.tables[0]).toMatchObject({ partOf: ["orders"], belongsTo: [{ to: "orders", column: "order_id" }] });
    const { comparison: c } = await ws.previewPlan(plan, "main");
    expect(c.edges.find((e) => e.from === "Order" && e.to === "OrderNote")).toMatchObject({ planned: true, has: { many: "*", owns: true } });
    expect(c.edges.find((e) => e.from === "OrderNote" && e.to === "Order")).toMatchObject({ has: { many: "1", owns: false } });
  });

  it("checks a reference by its column as well as its table", () => {
    const t = parsePlan("tables:\n  matters: { add: [home_site_id], belongs_to: { home_site: sites } }\n").tables[0];
    // Built on the court's site_id instead of a new column: still a reference to sites, but not the planned one.
    expect(unbuiltRefs(t, { references: [{ to: "sites", column: "site_id" }] })).toEqual(["sites through home_site_id"]);
    expect(unbuiltRefs(t, { references: [{ to: "sites", column: "home_site_id" }] })).toEqual([]);
  });

  it("lists what was built, what is missing, what is a surprise and what differs", async () => {
    const plan = parsePlan(PLAN, "receipts.yml");
    const { base, head } = await ws.range("main..agent/receipts");
    const c = await ws.compare(base, head);
    const { items } = await ws.checkPlan(c, plan);
    const of = (status: PlanItem["status"]) => items.filter((i) => i.status === status).map((i) => i.text);
    expect(of("built")).toEqual(expect.arrayContaining(["Receipts", '"customer pays"']));
    expect(of("missing")).toEqual(expect.arrayContaining(["Receipts#resend", "refund on OrdersController"]));
    expect(of("different")).toEqual(expect.arrayContaining(["Receipts#send_for takes 2 parameters; the plan said 1", "Receipts never names Order"]));
    expect(of("surprise")).toEqual(expect.arrayContaining(["A new service: Payments::Gateway", "Order gained coupon, subtotal and discount", "Checkout.new now takes 2 parameters (was 1)"]));

    // Every surprise sits in exactly one topic.
    const surprises = items.map((i, n) => (i.status === "surprise" ? n : -1)).filter((n) => n >= 0);
    const { themes } = await ws.checkPlan(c, plan);
    expect(themes.flatMap((t) => t.items).sort()).toEqual(surprises.sort());

    // Claude's topics are kept to the surprises, each once, and what it leaves out lands in "Everything else".
    const named = checkThemes({ ...c, planCheck: { items, themes } }, {
      lead: "It also takes payments.",
      themes: [{ title: "Payments", summary: "Cards are charged.", kind: "new", items: [surprises[0], surprises[0], 999] }],
    })!;
    expect(named.themes[0].items).toEqual([surprises[0]]);
    expect(named.themes.at(-1)).toMatchObject({ title: "Everything else", items: surprises.slice(1) });
  });

  it("groups surprises by the names they share", () => {
    expect(wordsOf("Org::InvoiceLayoutsController")).toEqual(["invoice", "layout"]);
    expect(wordsOf("fee_availabilities")).toEqual(["fee", "availability"]);
    const items: PlanItem[] = [
      { section: "tables", status: "surprise", text: "A new invoice_layouts table" },
      { section: "screens", status: "surprise", text: "A new InvoiceLayoutsController" },
      { section: "classes", status: "surprise", text: "A new service: InvoiceLayouts" },
    ];
    const theme = { title: "Invoice layouts", kind: "new" as const, items: [0, 1, 2] };
    expect(themeCounts(theme, items)).toBe("a new table, a new screen and a new class");
    expect(surpriseLead([theme, { title: "Timesheets", kind: "more", items: [] }])).toBe(
      "The branch built one thing the plan never mentions: invoice layouts. It also did more than the plan said around timesheets.",
    );
  });
});
