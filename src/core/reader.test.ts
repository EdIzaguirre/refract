import { describe, expect, it } from "vitest";
import { RubyReader } from "./reader.js";

const source = `
# A service with a nested result.
module Billing
  class Invoicer < Base
    include Auditable
    helper_method :total
    before_action :load_org, only: :show
    has_many :line_items
    belongs_to :customer, class_name: "Account"
    attr_reader :org

    def initialize(org, gateway: Payments::Gateway.new)
      @org = org
    end

    def self.for(org) = new(org)

    def issue(order, by:)
      return Result.new(ok: false) unless order.ready?

      Mailer.receipt(order).deliver_later
      ReceiptJob.perform_later(order.id) if by
      Result.new(ok: true)
    end

    private

    def total
      42
    end

    class Result
      def initialize(ok:) = @ok = ok
      def ok? = @ok
    end
  end
end
`;

describe("RubyReader", () => {
  it("reads classes, visibility, Rails declarations and dependencies", async () => {
    const [file] = await new RubyReader().read([{ path: "app/services/billing/invoicer.rb", blob: "b1", source }]);
    expect(file.errors).toEqual([]);
    const invoicer = file.classes.find((c) => c.name === "Billing::Invoicer")!;
    expect(invoicer.superclass).toBe("Base");
    expect(invoicer.includes).toEqual(["Auditable"]);
    expect(invoicer.helperMethods).toEqual(["total"]);
    expect(invoicer.callbacks).toEqual([{ kind: "before_action", targets: ["load_org"] }]);
    expect(invoicer.associations).toEqual([
      { kind: "has_many", name: "line_items" },
      { kind: "belongs_to", name: "customer", className: "Account" },
    ]);

    const byName = Object.fromEntries(invoicer.methods.map((m) => [`${m.scope}:${m.name}`, m]));
    expect(byName["instance:org"].kind).toBe("attr");
    expect(byName["class:for"].visibility).toBe("public");
    expect(byName["instance:issue"].visibility).toBe("public");
    expect(byName["instance:issue"].params).toBe(2);
    expect(byName["instance:issue"].branches).toBe(2);
    expect(byName["instance:issue"].calls).toEqual(expect.arrayContaining(["Result.new", "Mailer.receipt", "ReceiptJob.perform_later"]));
    expect(byName["instance:total"].visibility).toBe("private");
    // Default argument values count as references.
    expect(invoicer.references).toContain("Payments::Gateway");

    const result = file.classes.find((c) => c.name === "Billing::Invoicer::Result")!;
    expect(result.nestedIn).toBe("Billing::Invoicer");
    // The outer class's own code lines leave out the nested class.
    expect(invoicer.codeLines + result.codeLines).toBeLessThan(file.codeLines);
  });

  it("reports parse errors per file without failing the batch", async () => {
    const files = await new RubyReader().read([
      { path: "app/models/broken.rb", blob: "x", source: "class Broken\n  def oops(\nend" },
      { path: "app/models/fine.rb", blob: "y", source: "class Fine; def ok; end; end" },
    ]);
    expect(files.find((f) => f.path.endsWith("broken.rb"))!.errors.length).toBeGreaterThan(0);
    expect(files.find((f) => f.path.endsWith("fine.rb"))!.classes[0].name).toBe("Fine");
  });

  it("claims application Ruby files and skips tests and config", () => {
    const r = new RubyReader();
    expect(r.claims("rails_app/app/services/client_invitations.rb")).toBe(true);
    expect(r.claims("lib/tasks/thing.rb")).toBe(true);
    expect(r.claims("rails_app/test/models/user_test.rb")).toBe(false);
    expect(r.claims("config/application.rb")).toBe(false);
    expect(r.claims("app/views/orders/show.html.erb")).toBe(false);
    expect(r.isTest("spec/models/user_spec.rb")).toBe(true);
  });

  it("reads what a class holds: dependent:, optional:, and objects it makes and keeps (Metz's composition)", async () => {
    const src = `
class Bicycle
  has_many :spokes, dependent: :destroy
  has_one :bell
  belongs_to :shop, optional: true
  has_many :riders, through: :rentals

  def initialize(size:)
    @parts = Parts.new(size: size)
    @size = size
  end

  def lights = @lights ||= Lights::Set.new
end
`;
    const [file] = await new RubyReader().read([{ path: "app/models/bicycle.rb", blob: "b2", source: src }]);
    const bike = file.classes[0];
    expect(bike.associations).toEqual([
      { kind: "has_many", name: "spokes", dependent: "destroy" },
      { kind: "has_one", name: "bell" },
      { kind: "belongs_to", name: "shop", optional: true },
      { kind: "has_many", name: "riders", through: "rentals" },
    ]);
    // Made and kept: composition. A value passed in (@size) is not.
    expect(bike.composes).toEqual([
      { ivar: "parts", className: "Parts" },
      { ivar: "lights", className: "Lights::Set" },
    ]);
  });
});

