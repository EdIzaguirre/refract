import { describe, expect, it } from "vitest";
import { compareSchemas, migrationTitle, parseSchema, readLifecycles } from "./product.js";

const BEFORE = `ActiveRecord::Schema[8.1].define(version: 1) do
  create_table "orgs", force: :cascade do |t|
    t.string "name", null: false
    t.datetime "created_at", null: false
  end

  create_table "timesheets", force: :cascade do |t|
    t.bigint "org_id", null: false
    t.string "state", default: "open", null: false
    t.index ["org_id"], name: "index_timesheets_on_org_id"
  end

  add_foreign_key "timesheets", "orgs"
end
`;

const AFTER = `ActiveRecord::Schema[8.1].define(version: 2) do
  create_table "fees", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "name", null: false
    t.bigint "org_id", null: false
    t.integer "price_cents", null: false
    t.index ["org_id"], name: "index_fees_on_org_id", unique: true
    t.check_constraint "price_cents >= 0", name: "fees_price_non_negative"
  end

  create_table "orgs", force: :cascade do |t|
    t.string "name", null: false
    t.datetime "created_at", null: false
  end

  create_table "timesheets", force: :cascade do |t|
    t.bigint "org_id", null: false
    t.datetime "sent_at"
    t.bigint "sent_by_id"
    t.string "state", default: "open", null: false
  end

  add_foreign_key "fees", "orgs", on_delete: :cascade
  add_foreign_key "timesheets", "orgs"
  add_foreign_key "timesheets", "users", column: "sent_by_id"
end
`;

describe("schema", () => {
  it("reads tables, columns and foreign keys", () => {
    const s = parseSchema(AFTER);
    expect([...s.tables.keys()]).toEqual(["fees", "orgs", "timesheets"]);
    expect(s.tables.get("timesheets")!.columns.get("state")).toEqual({ type: "string", note: "required, default open" });
    expect(s.foreignKeys).toContainEqual({ from: "timesheets", to: "users", column: "sent_by_id" });
    expect(s.foreignKeys).toContainEqual({ from: "fees", to: "orgs", column: "org_id" });
  });

  it("lists new tables in full and only the moved columns of changed ones", () => {
    const t = compareSchemas(parseSchema(BEFORE), parseSchema(AFTER));
    expect(t.map((x) => `${x.status} ${x.name}`)).toEqual(["added fees", "changed timesheets"]);
    expect(t[0].columns.map((c) => c.name)).toEqual(["name", "org_id", "price_cents"]);
    expect(t[0].checks.added).toBe(1);
    expect(t[1].columns.map((c) => `${c.status} ${c.name}`)).toEqual(["added sent_at", "added sent_by_id"]);
    expect(t[1].otherColumns).toBe(2);
    expect(t[1].references.find((r) => r.column === "sent_by_id")?.status).toBe("added");
    expect(t[0].references.find((r) => r.column === "org_id")?.one).toBe(true);
    expect(t[1].references.find((r) => r.column === "org_id")?.one).toBe(false);
  });
});

describe("lifecycles", () => {
  it("reads a STATES constant and its transitions", () => {
    const src = `class Timesheet < ApplicationRecord
  STATES = %w[open submitted approved sent paid].freeze
  VALID_TRANSITIONS = {
    "open"      => %w[submitted],
    "approved"  => %w[sent paid open],
  }.freeze
end`;
    const [l] = readLifecycles(src);
    expect(l.field).toBe("state");
    expect(l.values).toEqual(["open", "submitted", "approved", "sent", "paid"]);
    expect(l.moves).toContainEqual({ from: "approved", to: "sent" });
  });

  it("reads a state-like enum and skips other enums", () => {
    const src = `class Merge < ApplicationRecord
  enum :access_level, { view: 0, edit: 1 }
  enum :status, { pending: 0, completed: 1, failed: 2 }
end`;
    expect(readLifecycles(src)).toEqual([{ field: "status", values: ["pending", "completed", "failed"], moves: [] }]);
  });
});

it("titles a migration from its file name", () => {
  expect(migrationTitle("rails_app/db/migrate/20260926001908_create_fees.rb")).toBe("create fees");
});
