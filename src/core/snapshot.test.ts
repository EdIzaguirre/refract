import { describe, expect, it } from "vitest";
import type { ClassFacts, FileFacts } from "../shared/types.js";
import { assemble, holding } from "./snapshot.js";

const facts = (name: string, over: Partial<ClassFacts> = {}): ClassFacts => ({
  name,
  kind: "module",
  line: 1,
  endLine: 2,
  superclass: null,
  nestedIn: null,
  codeLines: 0,
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
  ...over,
});
const file = (path: string, classes: ClassFacts[]): FileFacts => ({ path, blob: path, language: "ruby", lines: 1, codeLines: 1, classes, errors: [] });
const method = { name: "listed?", scope: "class" as const, visibility: "public" as const, params: 1, line: 3, codeLines: 2, calls: [], kind: "def" as const };

describe("assemble", () => {
  it("takes a module's role from the file named after it, not from whichever file wraps a class in it first", () => {
    // `module Kvc` opens around a job before kvc.rb is read; the job file says nothing about Kvc itself.
    const snap = assemble(
      "c1",
      [
        file("app/jobs/kvc/deliver_job.rb", [facts("Kvc"), facts("Kvc::DeliverJob", { kind: "class", nestedIn: "Kvc", superclass: "ApplicationJob" })]),
        file("app/services/kvc.rb", [facts("Kvc", { codeLines: 40, methods: [method] })]),
      ],
      [],
    );
    expect(snap.classes.Kvc.role).toBe("service");
    expect(snap.classes["Kvc::DeliverJob"].role).toBe("job");
  });

  it("falls back to the opening with the most code of its own when no file is named after the module", () => {
    const snap = assemble(
      "c1",
      [
        file("app/jobs/billing/charge_job.rb", [facts("Billing", { codeLines: 1, methods: [method] })]),
        file("app/services/billing/rules.rb", [facts("Billing", { codeLines: 30, methods: [{ ...method, name: "rate" }] })]),
      ],
      [],
    );
    expect(snap.classes.Billing.role).toBe("service");
  });

  it("reads Rails associations and kept objects as UML holdings: how many, and whether the holder owns them", () => {
    expect(holding({ kind: "has_many", name: "spokes", dependent: "destroy" })).toEqual({ many: "*", owns: true });
    expect(holding({ kind: "has_many", name: "spokes" })).toEqual({ many: "*", owns: false });
    expect(holding({ kind: "has_one", name: "bell", dependent: "nullify" })).toEqual({ many: "0..1", owns: false });
    expect(holding({ kind: "belongs_to", name: "shop" })).toEqual({ many: "1", owns: false });
    expect(holding({ kind: "belongs_to", name: "shop", optional: true })).toEqual({ many: "0..1", owns: false });
    expect(holding({ kind: "has_many", name: "riders", through: "rentals", dependent: "destroy" })).toBeUndefined();

    const snap = assemble(
      "c1",
      [
        file("app/models/bicycle.rb", [
          facts("Bicycle", { kind: "class", associations: [{ kind: "has_many", name: "spokes", dependent: "destroy" }], composes: [{ ivar: "parts", className: "Parts" }] }),
        ]),
        file("app/models/spoke.rb", [facts("Spoke", { kind: "class" })]),
        file("app/models/parts.rb", [facts("Parts", { kind: "class" })]),
      ],
      [],
    );
    const to = Object.fromEntries(snap.classes.Bicycle.dependsOn.map((d) => [d.to, d.has]));
    expect(to).toEqual({ Parts: { many: "1", owns: true }, Spoke: { many: "*", owns: true } });
  });
});

