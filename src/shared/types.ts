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
}

export interface EdgeChange {
  from: string;
  to: string;
  kind: Dependency["kind"];
  status: "added" | "removed" | "unchanged";
  before: number;
  after: number;
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
}

export interface Comparison {
  repo: { name: string; root: string };
  base: CommitInfo & { ref: string };
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
  error?: string;
}

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

export interface Timeline {
  base: string;
  commits: CommitInfo[];
  watching: string | null;
  quietSeconds: number;
}

export interface ServerEvent {
  type: "comparison" | "timeline" | "lenses" | "status" | "flows" | "story";
  payload: unknown;
}
