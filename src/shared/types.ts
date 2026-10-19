// The shapes every part of Refract agrees on. A language reader prints
// FileFacts; the server folds them into a Snapshot per commit, compares two
// snapshots into a Comparison, and the browser draws only Comparisons.

export interface MethodFacts {
  name: string;
  scope: "instance" | "class";
  visibility: "public" | "private" | "protected";
  params: number;
  line: number;
  endLine: number;
  codeLines: number;
  branches: number;
  /** Static calls seen in the body: ".name" on self, "Const.name" on a class, "Const#name" on a new instance. */
  calls: string[];
  /** "def", or a declaration that defines a method: "attr", "scope", "delegate". */
  kind: string;
}

export interface CallbackFacts {
  kind: string;
  targets: string[];
}

export interface AssociationFacts {
  kind: string;
  name: string;
  className?: string;
}

export interface ClassFacts {
  name: string;
  kind: "class" | "module";
  line: number;
  endLine: number;
  superclass: string | null;
  nestedIn: string | null;
  /** Lines of code in this class's own body: no blanks, no comments, no nested classes. */
  codeLines: number;
  methods: MethodFacts[];
  includes: string[];
  extends: string[];
  /** Constant names as written in the source, unresolved. */
  references: string[];
  callbacks: CallbackFacts[];
  associations: AssociationFacts[];
  validations: number;
  scopes: string[];
  helperMethods: string[];
  delegates: string[];
  ivars: string[];
}

export interface FileFacts {
  path: string;
  blob: string;
  language: string;
  lines: number;
  codeLines: number;
  classes: ClassFacts[];
  errors: string[];
}

/** Where a class's code lives. A class may be reopened across files. */
export interface ClassLocation {
  path: string;
  line: number;
  endLine: number;
}

/**
 * One class as Refract draws it: nested helper classes (a Result inside a
 * service) are folded into their outer class, and reopened classes are merged.
 */
export interface ClassUnit {
  name: string;
  kind: "class" | "module";
  role: Role;
  superclass: string | null;
  locations: ClassLocation[];
  /** Code lines including folded nested classes. */
  codeLines: number;
  /** Public instance and class methods, without the constructor. */
  publicMethods: string[];
  /** Private methods exposed to views with helper_method; part of a controller's interface. */
  helperMethods: string[];
  methods: MethodFacts[];
  nested: string[];
  includes: string[];
  callbacks: CallbackFacts[];
  associations: AssociationFacts[];
  validations: number;
  /** Fully qualified names of classes in this snapshot that this class depends on. */
  dependsOn: Dependency[];
}

export type Role =
  | "model"
  | "controller"
  | "service"
  | "job"
  | "mailer"
  | "helper"
  | "concern"
  | "policy"
  | "component"
  | "lib"
  | "other";

export interface Dependency {
  to: string;
  kind: "inherits" | "includes" | "association" | "reference" | "call";
  count: number;
}

export interface Snapshot {
  commit: string;
  /** Every measured file, keyed by path. */
  files: Record<string, { blob: string; codeLines: number; classes: string[]; errors: string[] }>;
  classes: Record<string, ClassUnit>;
  /** Number of files of any language at this commit, by path prefix of its area later. */
  allFiles: string[];
}

// ---------- areas ----------

export interface AreaDef {
  id: string;
  name: string;
  description?: string;
  /** Glob patterns matched against repository paths. */
  paths: string[];
  /** Class-name globs, which win over paths. */
  classes: string[];
}

export interface AreaMap {
  source: "file" | "inferred";
  file?: string;
  areas: AreaDef[];
}

// ---------- comparison ----------

export type ChangeStatus = "added" | "removed" | "changed" | "unchanged";

export interface Side<T> {
  before: T | null;
  after: T | null;
}

export interface Shape {
  /** Ousterhout width: public methods (plus helper methods for controllers). */
  interface: number;
  /** Ousterhout height: lines of code behind it. */
  codeLines: number;
  methods: number;
}

export interface MethodChange {
  name: string;
  scope: "instance" | "class";
  status: ChangeStatus;
  before: { visibility: string; codeLines: number; params: number; branches: number } | null;
  after: { visibility: string; codeLines: number; params: number; branches: number } | null;
}

export interface ClassChange {
  name: string;
  area: string;
  role: Role;
  status: ChangeStatus;
  /** True when one of this class's files was in the diff, even if no measure moved. */
  touched: boolean;
  shape: Side<Shape>;
  methods: MethodChange[];
  paths: string[];
  /** Classes that inherit from this one, directly or not, on the after side. */
  descendants: number;
  superclass: string | null;
  nested: string[];
  before: ClassUnit | null;
  after: ClassUnit | null;
  /** In a plan preview: the plan adds or reshapes this class. */
  planned?: boolean;
  /** A planned class has no code yet, so its height (lines of code) is a placeholder. */
  sizeUnknown?: boolean;
}

export interface EdgeChange {
  from: string;
  to: string;
  kind: Dependency["kind"];
  status: "added" | "removed" | "unchanged";
  before: number;
  after: number;
  /** In a plan preview: a dependency the plan adds. */
  planned?: boolean;
}

export interface AreaChange {
  id: string;
  name: string;
  description?: string;
  status: ChangeStatus;
  before: { files: number; codeLines: number; classes: number };
  after: { files: number; codeLines: number; classes: number };
  changedFiles: number;
  changedClasses: number;
}

export interface AreaEdge {
  from: string;
  to: string;
  before: number;
  after: number;
}

export type Tone = "good" | "bad" | "ask" | "flat";

export interface Delta {
  id: string;
  what: string;
  before: string | null;
  after: string;
  change: string;
  tone: Tone;
  why: string;
  /** Class or area the delta is about, so the map can fly there. */
  target?: { kind: "class" | "area"; name: string };
}

export interface ChangedFile {
  path: string;
  status: "A" | "M" | "D" | "R";
  additions: number;
  deletions: number;
  area: string | null;
  kind: "app" | "test" | "other";
}

export interface CommitInfo {
  sha: string;
  short: string;
  subject: string;
  author: string;
  date: string;
  /** Parent commits, when known: two or more for a merge. */
  parents?: string[];
}

export interface Comparison {
  repo: { name: string; root: string };
  /** atTip: the base commit is still the tip of `ref`, not an older commit where head last met it. */
  base: CommitInfo & { ref: string; atTip?: boolean };
  head: CommitInfo & { ref: string };
  verdict: { label: string; tone: Tone; summary: string; good: number; bad: number; ask: number };
  deltas: Delta[];
  areas: AreaChange[];
  areaEdges: AreaEdge[];
  classes: ClassChange[];
  edges: EdgeChange[];
  files: ChangedFile[];
  stats: { files: number; additions: number; deletions: number; appFiles: number; testFiles: number };
  areaSource: AreaMap["source"];
  areaFile?: string;
  generatedAt: string;
  /** Filled in by the workspace after the class comparison: what the change does to the product. */
  product?: ProductChanges;
  /** Set when a plan is involved: drawn as the "after" (preview) or checked against the build (check). */
  plan?: PlanInfo;
  /** In check mode: the plan laid beside what the branch built. */
  planCheck?: PlanCheck;
}

// ---------- lenses ----------

export type LensId = "metz" | "ousterhout" | "copeland";

export interface LensQuestion {
  tone: "likes" | "asks" | "worries";
  text: string;
  evidence: string;
  /** Checklist rule or book section, like "§7.2.2". */
  source: string;
  quote?: string;
  target?: { kind: "class" | "area" | "method"; name: string };
}

export interface LensResult {
  lens: LensId;
  /** Two or three sentences: how this book judges the change as a whole. */
  overall?: string;
  questions: LensQuestion[];
  error?: string;
}

export interface Disagreement {
  topic: string;
  target?: { kind: "class" | "area" | "method"; name: string };
  positions: Partial<Record<LensId, string>>;
  tradeoff: string;
}

export interface LensReport {
  base: string;
  head: string;
  status: "idle" | "running" | "done" | "error";
  startedAt?: string;
  finishedAt?: string;
  lenses: LensResult[];
  disagreements: Disagreement[];
  error?: string;
}

// ---------- the guided tour ----------

/** One stop on the tour: a part of the change told in plain words, with the few classes it is about. */
export interface StoryStop {
  id: string;
  title: string;
  /** Two or three plain sentences: what happened and why it matters. */
  explain: string;
  /** What to look for in the before/after drawing. */
  look: string;
  tone: Tone;
  /** Classes to draw, exact names from the comparison. The first is the one the stop is about. */
  classes: string[];
  /** A request to draw as a sequence diagram under the boxes: a planned flow's entry. */
  flow?: { cls: string; method: string };
}

export interface Story {
  base: string;
  head: string;
  /** "claude" when Claude Code wrote it, "measured" when built from the deltas alone. */
  source: "claude" | "measured";
  status: "running" | "done";
  /** One plain sentence on what the change does. */
  summary: string;
  stops: StoryStop[];
  /** One plain sentence per part of "What changed in the product", when Claude wrote the story. */
  product?: Partial<Record<ProductPart, string>>;
  /** With a plan check: the surprises in a few topics Claude named, and the sentence that leads them. */
  surprises?: { lead: string; themes: PlanTheme[] };
  error?: string;
}

export type ProductPart = "data" | "screens" | "permissions" | "lifecycles" | "jobs";

// ---------- request flows ----------

export interface FlowCall {
  from: string;
  to: string;
  method: string;
  /** "observed": seen while the tests ran. "static": only seen in the code. */
  source: "observed" | "static";
  /** Call depth below the flow's entry, for observed calls. */
  depth?: number;
}

/** A sequence diagram for one method, ready to draw. */
export interface Sequence {
  title: string;
  participants: string[];
  messages: { from: string; to: string; label: string; observed: boolean }[];
  traced: boolean;
}

export interface Flow {
  entry: string;
  calls: FlowCall[];
}

export interface FlowReport {
  side: "before" | "after";
  commit: string;
  status: "static" | "traced" | "error";
  tests: string[];
  flows: Flow[];
  error?: string;
}

// ---------- live state pushed to the browser ----------

/** Where the comparison's two sides sit in the branch's history, for the header's drawing. */
export interface BranchHistory {
  /** The branch the "before" side comes from, such as dev. */
  baseRef: string;
  base: CommitInfo;
  /** The before side is still that branch's newest commit. */
  baseAtTip: boolean;
  /** Commits that branch gained after `base`, which the comparison leaves out. */
  baseAhead: number;
  /** Branch commits that merged baseRef in. */
  merges: string[];
}

export interface Timeline {
  base: string;
  history?: BranchHistory;
  commits: CommitInfo[];
  watching: string | null;
  quietSeconds: number;
}

export interface ServerEvent {
  type: "comparison" | "timeline" | "lenses" | "status" | "flows" | "story" | "plans";
  payload: unknown;
}

// ---------- product ----------

/** What the change does to the product, read straight from the code: data, screens, permissions, lifecycles, jobs. */
export interface ProductChanges {
  tables: TableChange[];
  /** Migrations the change adds, by file name, including ones that only move data. */
  migrations: { file: string; title: string; schema: boolean }[];
  screens: ScreenChange[];
  /** Route lines added to and removed from config/routes.rb, comments dropped. */
  routes: { added: string[]; removed: string[] };
  permissions: RuleChange[];
  lifecycles: LifecycleChange[];
  jobs: { name: string; role: Role; status: ChangeStatus; methods: string[] }[];
}

export interface ColumnChange {
  name: string;
  type: string;
  status: ChangeStatus;
  /** "not null", "default: open" and the like, as written in the schema. */
  note?: string;
  /** For a column whose type or options changed, what it was. */
  was?: string;
}

export interface TableChange {
  name: string;
  status: ChangeStatus;
  /** Every column of a new table; only the columns that moved for a changed one. */
  columns: ColumnChange[];
  /** Columns the change left alone, counted so the drawing can say "and 12 more". */
  otherColumns: number;
  /** Foreign keys on the after side (or before, for a removed table). */
  /** `one` when the column has its own unique index, so the referenced row has at most one of these. */
  references: { to: string; column: string; one: boolean; status: ChangeStatus }[];
  checks: { added: number; removed: number };
}

export interface ScreenChange {
  controller: string;
  status: ChangeStatus;
  actions: { name: string; status: ChangeStatus }[];
}

export interface RuleChange {
  policy: string;
  rule: string;
  status: ChangeStatus;
}

export interface LifecycleChange {
  model: string;
  field: string;
  status: ChangeStatus;
  before: string[];
  after: string[];
  /** "from → to" moves, when the model lists them. */
  moves: { from: string; to: string; status: ChangeStatus }[];
}

// ---------- plans ----------

/** Which plan a comparison involves, and how. */
export interface PlanInfo {
  /** "preview": the plan drawn as the after side. "check": the build compared with the plan. */
  mode: "preview" | "check";
  name: string;
  title: string;
  why?: string;
  approach?: string;
  file: string;
  /** Changes whenever the file does, so caches keyed on it go stale with it. */
  hash: string;
  /** Lines in the file Refract could not read, in plain words. */
  problems: string[];
}

export type PlanSection = "tables" | "lifecycles" | "screens" | "permissions" | "jobs" | "classes" | "flows";

/**
 * built: the plan asked for it and it is there. missing: planned, not built.
 * surprise: built, not in the plan. different: built, but not the way the plan said.
 */
export type PlanStatus = "built" | "missing" | "surprise" | "different";

export interface PlanItem {
  section: PlanSection;
  status: PlanStatus;
  /** One plain line, like "fees table" or "TimesheetCharges grew revise and set_included". */
  text: string;
  detail?: string;
  /** Where the line opens: a class pop-up, or a part of the product page. */
  target?: { kind: "class"; name: string; method?: string } | { kind: "product"; part: ProductPart; name: string };
}

/** Surprises that belong together, like a new table with its screen and service. */
export interface PlanTheme {
  /** A few plain words, like "Invoice layouts". */
  title: string;
  /** One plain sentence on what this is for, when Claude wrote the topics. */
  summary?: string;
  /** "new": something the plan never mentions at all. "more": more than the plan said about something it does. */
  kind: "new" | "more";
  /** Indexes into PlanCheck.items. */
  items: number[];
}

export interface PlanCheck {
  items: PlanItem[];
  /** The surprises in a few topics, measured from shared names. */
  themes: PlanTheme[];
}

// ---------- two plans, side by side ----------

/** One plan in a side-by-side comparison of two to four designs for the same goal. */
export interface PlanSide {
  /** A, B, C or D. */
  label: string;
  plan: PlanInfo;
  product: ProductChanges;
  /** The plan drawn over today's code, trimmed to the classes it adds or reshapes, what they point at, and the arrows among them. */
  drawing: Comparison;
  /**
   * What the rest of the code must learn: the public methods and associations the plan adds outside
   * controllers, policies, jobs and mailers. A new model is listed even with neither: it is new persistence.
   */
  surface: { classes: { name: string; role: Role; isNew: boolean; methods: string[]; associations: string[]; params: number }[]; methods: number; params: number };
  /** How tangled: classes the plan touches and the arrows it adds between classes and between business areas. */
  coupling: { touched: number; created: number; reshaped: number; arrows: number; crossArea: number };
  /** Planned requests: the calls as "Caller → Callee#method", and how many calls the entry point makes itself. */
  flows: { name: string; sequence: Sequence; calls: string[]; steps: number; entryCalls: number }[];
}

/** One product fact, and what each plan says about it. */
export interface ProductRow {
  part: ProductPart;
  /** Table, lifecycle, screen, policy or job name. */
  subject: string;
  /** Each plan's version, in the order of the sides; null where a plan leaves it alone. */
  cells: (string | null)[];
  /** "all": the same in every plan. "some": the plans part ways on it. */
  where: "all" | "some";
}

export interface PlanComparison {
  base: { ref: string; short: string };
  sides: PlanSide[];
  product: ProductRow[];
  /** The same request under each plan: per side, an index into its flows, or null where it does not draw it. */
  flows: { title: string; at: (number | null)[] }[];
  /** A short note from the Ousterhout lens, argued from Ch 11 "Design it Twice". */
  note: { lines: string[]; source: string };
}
