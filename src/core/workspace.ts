import fs from "node:fs/promises";
import type { AreaMap, Comparison, Snapshot } from "../shared/types.js";
import { AreaAssigner, areasFile, inferAreas, loadAreaFile } from "./areas.js";
import { compare } from "./compare.js";
import { productChanges } from "./product.js";
import { Git } from "./git.js";
import { RubyReader, type Reader } from "./reader.js";
import { SnapshotStore } from "./snapshot.js";

/** One repository Refract is looking at: its git, its cached snapshots, its areas. */
export class Workspace {
  readonly store: SnapshotStore;
  private inferred: AreaMap | null = null;
  private areaCache: { mtime: number; map: AreaMap } | null = null;

  private constructor(
    readonly git: Git,
    readonly reader: Reader,
    readonly key: string,
  ) {
    this.store = new SnapshotStore(git, reader);
  }

  static async open(dir: string, reader: Reader = new RubyReader()): Promise<Workspace> {
    const git = await Git.open(dir);
    return new Workspace(git, reader, await repoKey(git));
  }

  get areasPath(): string {
    return areasFile(this.key);
  }

  /** The areas.yml if there is one (re-read when it changes), else a map inferred from the code. */
  async areaMap(fallback: Snapshot): Promise<AreaMap> {
    try {
      const stat = await fs.stat(this.areasPath);
      if (this.areaCache?.mtime === stat.mtimeMs) return this.areaCache.map;
      const map = await loadAreaFile(this.areasPath);
      if (map && map.areas.length) {
        this.areaCache = { mtime: stat.mtimeMs, map };
        return map;
      }
    } catch {
      // No areas.yml yet.
    }
    this.inferred ??= inferAreas(fallback);
    return this.inferred;
  }

  async compare(baseRef: string, headRef: string): Promise<Comparison> {
    const [base, head] = await Promise.all([this.git.resolve(baseRef), this.git.resolve(headRef)]);
    const [before, after, baseInfo, headInfo, changed] = await Promise.all([
      this.store.snapshot(base),
      this.store.snapshot(head),
      this.git.commit(base),
      this.git.commit(head),
      this.git.changedFiles(base, head),
    ]);
    const map = await this.areaMap(before);
    const areas = new AreaAssigner(map, [before, after]);
    const c = compare({
      repo: { name: this.key, root: this.git.root },
      base: { ...baseInfo, ref: baseRef },
      head: { ...headInfo, ref: headRef },
      before,
      after,
      changed,
      areas,
      isTest: (f) => this.reader.isTest(f),
      claims: (f) => this.reader.claims(f),
    });
    c.product = await productChanges(this.git, c);
    return c;
  }

  /**
   * Resolves "a..b", "b" (against the default branch), or nothing (current branch).
   * `from` names the branch the base commit was taken from, for the header.
   */
  async range(spec?: string): Promise<{ base: string; head: string; branch: string | null; from: string | null }> {
    if (spec && spec.includes("..")) {
      const [b, h] = spec.split(/\.\.\.?/);
      const head = h || "HEAD";
      const base = (await this.git.mergeBase(b, head)) ?? b;
      return { base, head, branch: (await this.git.tryResolve(`refs/heads/${head}`)) ? head : null, from: b };
    }
    const head = spec || (await this.git.currentBranch()) || "HEAD";
    const main = await this.git.defaultBranch();
    let base: string | null = null;
    let from: string | null = null;
    if (main) {
      base = await this.git.mergeBase(main, head);
      from = main;
      const headSha = await this.git.resolve(head);
      if (base === headSha) base = from = null; // Head is on the default branch: show its last commit.
    }
    base ??= (await this.git.tryResolve(`${head}~1`)) ?? head;
    return { base, head, branch: (await this.git.tryResolve(`refs/heads/${head}`)) ? head : null, from };
  }
}

async function repoKey(git: Git): Promise<string> {
  const url = (await git.tryGit(["config", "--get", "remote.origin.url"]))?.trim();
  const m = url?.match(/[/:]([^/:]+)\/([^/]+?)(\.git)?$/);
  return m ? `${m[1]}-${m[2]}` : git.name;
}
