import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { CommitInfo } from "../shared/types.js";

const run = promisify(execFile);
const MAX_BUFFER = 512 * 1024 * 1024;

/** A git repository, addressed by its top-level directory. */
export class Git {
  constructor(readonly root: string) {}

  static async open(dir: string): Promise<Git> {
    const { stdout } = await run("git", ["rev-parse", "--show-toplevel"], { cwd: dir });
    return new Git(stdout.trim());
  }

  async git(args: string[]): Promise<string> {
    const { stdout } = await run("git", args, { cwd: this.root, maxBuffer: MAX_BUFFER });
    return stdout;
  }

  async tryGit(args: string[]): Promise<string | null> {
    try {
      return await this.git(args);
    } catch {
      return null;
    }
  }

  get name(): string {
    return path.basename(this.root);
  }

  async gitDir(): Promise<string> {
    const dir = (await this.git(["rev-parse", "--git-common-dir"])).trim();
    return path.resolve(this.root, dir);
  }

  async resolve(ref: string): Promise<string> {
    return (await this.git(["rev-parse", "--verify", `${ref}^{commit}`])).trim();
  }

  async tryResolve(ref: string): Promise<string | null> {
    const out = await this.tryGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return out ? out.trim() : null;
  }

  async currentBranch(): Promise<string | null> {
    const out = await this.tryGit(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    return out ? out.trim() : null;
  }

  /** The branch other work merges into: origin's HEAD, else main, master, dev or develop. */
  async defaultBranch(): Promise<string | null> {
    const remoteHead = await this.tryGit(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
    if (remoteHead && (await this.tryResolve(remoteHead.trim()))) return remoteHead.trim();
    for (const name of ["main", "master", "dev", "develop", "origin/main", "origin/master", "origin/dev"]) {
      if (await this.tryResolve(name)) return name;
    }
    return null;
  }

  async mergeBase(a: string, b: string): Promise<string | null> {
    const out = await this.tryGit(["merge-base", a, b]);
    return out ? out.trim() : null;
  }

  async commit(ref: string): Promise<CommitInfo> {
    const out = await this.git(["show", "-s", "--format=%H%x00%h%x00%s%x00%an%x00%aI", ref]);
    const [sha, short, subject, author, date] = out.trim().split("\0");
    return { sha, short, subject, author, date };
  }

  /** Commits reachable from head and not from base, oldest first, first-parent only. */
  async commitsBetween(base: string, head: string, limit = 400): Promise<CommitInfo[]> {
    const out = await this.git([
      "log",
      "--first-parent",
      "--reverse",
      `--max-count=${limit}`,
      "--format=%H%x00%h%x00%s%x00%an%x00%aI%x00%P",
      `${base}..${head}`,
    ]);
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, short, subject, author, date, parents] = line.split("\0");
        return { sha, short, subject, author, date, parents: parents ? parents.split(" ") : [] };
      });
  }

  async isAncestor(a: string, b: string): Promise<boolean> {
    return (await this.tryGit(["merge-base", "--is-ancestor", a, b])) !== null;
  }

  async count(range: string): Promise<number> {
    return Number((await this.tryGit(["rev-list", "--count", range]))?.trim() ?? 0);
  }

  /** Every file at a commit, with its blob id. */
  async tree(commit: string): Promise<Map<string, string>> {
    const out = await this.git(["ls-tree", "-r", "-z", "--full-tree", commit]);
    const files = new Map<string, string>();
    for (const entry of out.split("\0")) {
      if (!entry) continue;
      const tab = entry.indexOf("\t");
      const [, type, blob] = entry.slice(0, tab).split(" ");
      if (type === "blob") files.set(entry.slice(tab + 1), blob);
    }
    return files;
  }

  /** Reads many blobs in one `git cat-file --batch` process. */
  async readBlobs(blobs: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (blobs.length === 0) return result;
    const child = spawn("git", ["cat-file", "--batch"], { cwd: this.root });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", () => resolve());
    });
    child.stdin.end(blobs.join("\n") + "\n");
    await done;
    const buf = Buffer.concat(chunks);
    let pos = 0;
    for (const blob of blobs) {
      const nl = buf.indexOf(10, pos);
      if (nl < 0) break;
      const header = buf.subarray(pos, nl).toString();
      const parts = header.split(" ");
      if (parts[1] === "missing") {
        pos = nl + 1;
        continue;
      }
      const size = Number(parts[2]);
      result.set(blob, buf.subarray(nl + 1, nl + 1 + size).toString("utf8"));
      pos = nl + 1 + size + 1;
    }
    return result;
  }

  async show(commit: string, file: string): Promise<string | null> {
    return this.tryGit(["show", `${commit}:${file}`]);
  }

  /** Changed files with line counts, following renames. */
  async changedFiles(
    base: string,
    head: string,
  ): Promise<{ path: string; status: "A" | "M" | "D" | "R"; additions: number; deletions: number }[]> {
    const [numstat, status] = await Promise.all([
      this.git(["diff", "--numstat", "-z", "-M", base, head]),
      this.git(["diff", "--name-status", "-z", "-M", base, head]),
    ]);
    const statusOf = new Map<string, "A" | "M" | "D" | "R">();
    const st = status.split("\0");
    for (let i = 0; i < st.length - 1; ) {
      const code = st[i][0];
      if (code === "R" || code === "C") {
        statusOf.set(st[i + 2], "R");
        i += 3;
      } else {
        statusOf.set(st[i + 1], code === "A" || code === "D" ? code : "M");
        i += 2;
      }
    }
    const files: { path: string; status: "A" | "M" | "D" | "R"; additions: number; deletions: number }[] = [];
    const parts = numstat.split("\0");
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i];
      if (!entry) continue;
      const [add, del, name] = entry.split("\t");
      let file = name;
      if (name === "") {
        // A rename: the next two fields are the old and new paths.
        file = parts[i + 2];
        i += 2;
      }
      if (!file) continue;
      files.push({
        path: file,
        status: statusOf.get(file) ?? "M",
        additions: add === "-" ? 0 : Number(add),
        deletions: del === "-" ? 0 : Number(del),
      });
    }
    return files;
  }

  async diff(base: string, head: string, paths: string[], context = 3): Promise<string> {
    return this.git(["diff", `-U${context}`, "-M", base, head, "--", ...paths]);
  }
}
