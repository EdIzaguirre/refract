import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AreaAssigner, UNASSIGNED, fileStem, loadAreaFile, writeAreaFile } from "./areas.js";
import { assemble } from "./snapshot.js";
import { stem } from "./inflect.js";
import type { ClassFacts, FileFacts, MethodFacts } from "../shared/types.js";

const cls = (name: string, extra: Partial<ClassFacts> = {}): ClassFacts => ({
  name,
  kind: "class",
  line: 1,
  endLine: 5,
  superclass: null,
  nestedIn: null,
  codeLines: 4,
  methods: [],
  includes: [],
  extends: [],
  references: [],
  callbacks: [],
  associations: [],
  validations: 0,
  scopes: [],
  helperMethods: [],
  delegates: [],
  ivars: [],
  ...extra,
});
const method = (name: string): MethodFacts => ({ name, scope: "instance", visibility: "public", params: 1, line: 2, endLine: 4, codeLines: 3, branches: 0, calls: [], kind: "def" });
const file = (p: string, classes: ClassFacts[]): FileFacts => ({ path: p, blob: p, language: "ruby", lines: 5, codeLines: 4, classes, errors: [] });

describe("areas", () => {
  it("reduces paths and class names to their domain words", () => {
    expect(fileStem("rails_app/app/controllers/org/client_invitations_controller.rb")).toBe("org/client_invitation");
    expect(fileStem("rails_app/app/views/org/client_invitations/_row.html.erb")).toBe("org/client_invitation/row");
    expect(fileStem("test/models/client_invitation_test.rb")).toBe("client_invitation");
    expect(stem("Org::ClientInvitationsController")).toBe("ClientInvitation");
  });

  it("assigns classes by globs, and views and tests by the class they belong to", async () => {
    const snap = assemble(
      "c1",
      [
        file("app/models/invoice.rb", [cls("Invoice")]),
        file("app/controllers/invoices_controller.rb", [cls("InvoicesController", { references: ["Invoice"] })]),
        file("app/services/kvc/sync.rb", [cls("Kvc::Sync")]),
        file("app/services/new_thing.rb", [cls("NewThing", { references: ["Invoice"] })]),
      ],
      [],
    );
    const yml = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "refract-areas-")), "areas.yml");
    await writeAreaFile(
      yml,
      {
        source: "file",
        areas: [
          { id: "billing", name: "Billing", paths: ["app/**/invoice*"], classes: [] },
          { id: "integrations", name: "Integrations", paths: [], classes: ["Kvc/**"] },
        ],
      },
      "Test.",
    );
    const map = (await loadAreaFile(yml))!;
    expect(map.areas.map((a) => a.name)).toEqual(["Billing", "Integrations"]);
    const a = new AreaAssigner(map, [snap]);
    expect(a.areaOfClass("Invoice")).toBe("billing");
    expect(a.areaOfClass("Kvc::Sync")).toBe("integrations");
    // Matched no glob: follows the classes it depends on.
    expect(a.areaOfClass("NewThing")).toBe("billing");
    expect(a.areaOfFile("app/views/invoices/show.html.erb")).toBe("billing");
    expect(a.areaOfFile("test/models/invoice_test.rb")).toBe("billing");
    expect(a.areaOfFile("README.md")).toBe(UNASSIGNED);
  });

  it("folds nested classes into their outer class, but not into namespace modules", () => {
    const snap = assemble(
      "c1",
      [
        file("app/services/receipts.rb", [
          cls("Receipts", { codeLines: 10, methods: [method("send_for")] }),
          cls("Receipts::Result", { nestedIn: "Receipts", codeLines: 6, methods: [method("sent?")] }),
        ]),
        file("app/services/payments.rb", [cls("Payments", { kind: "module", codeLines: 2 }), cls("Payments::Gateway", { nestedIn: "Payments" })]),
      ],
      [],
    );
    expect(Object.keys(snap.classes).sort()).toEqual(["Payments::Gateway", "Receipts"]);
    expect(snap.classes.Receipts.codeLines).toBe(16);
    expect(snap.classes.Receipts.nested).toEqual(["Receipts::Result"]);
    expect(snap.classes.Receipts.publicMethods).toEqual(["send_for"]);
  });
});
