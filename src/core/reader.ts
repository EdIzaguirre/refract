import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FileFacts } from "../shared/types.js";

/**
 * Everything language-specific sits behind this interface. A reader says
 * which files it understands and turns their source into FileFacts. Adding a
 * language means adding a reader, nothing else.
 */
export interface Reader {
  readonly language: string;
  /** Bumped when the facts a reader produces change, so cached facts are re-read. */
  readonly version: string;
  claims(file: string): boolean;
  isTest(file: string): boolean;
  read(files: { path: string; blob: string; source: string }[]): Promise<FileFacts[]>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const RUBY_READER_SCRIPT = path.resolve(here, "../../readers/ruby/reader.rb");

const SKIP_DIRS = /(^|\/)(test|spec|vendor|node_modules|db|tmp|log|coverage|public|bin|config|script|scripts)\//;

export class RubyReader implements Reader {
  readonly language = "ruby";
  readonly version = "ruby-3";

  constructor(private readonly ruby = process.env.REFRACT_RUBY ?? "ruby") {}

  claims(file: string): boolean {
    if (!file.endsWith(".rb")) return false;
    if (!/(^|\/)(app|lib)\//.test(file)) return false;
    // Directories that sit inside app/ or lib/ but hold no application classes.
    const inside = file.replace(/^.*?(^|\/)(app|lib)\//, "");
    return !SKIP_DIRS.test(inside) && !/(^|\/)(test|spec|vendor|node_modules)\//.test(file);
  }

  isTest(file: string): boolean {
    return /(^|\/)(test|spec)\//.test(file) || /_(test|spec)\.rb$/.test(file);
  }

  async read(files: { path: string; blob: string; source: string }[]): Promise<FileFacts[]> {
    const batches: (typeof files)[] = [];
    for (let i = 0; i < files.length; i += 150) batches.push(files.slice(i, i + 150));
    const results: FileFacts[] = [];
    // A few Ruby processes at once; each batch is independent.
    const workers = Math.max(1, Math.min(4, batches.length));
    let next = 0;
    await Promise.all(
      Array.from({ length: workers }, async () => {
        while (next < batches.length) {
          const batch = batches[next++];
          results.push(...(await this.readBatch(batch)));
        }
      }),
    );
    return results;
  }

  private readBatch(files: { path: string; blob: string; source: string }[]): Promise<FileFacts[]> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.ruby, [RUBY_READER_SCRIPT], { stdio: ["pipe", "pipe", "pipe"] });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on("data", (c: Buffer) => out.push(c));
      child.stderr.on("data", (c: Buffer) => err.push(c));
      child.on("error", (e) => reject(new Error(`Could not run ${this.ruby}: ${e.message}. Refract needs Ruby 3.3+ for Prism.`)));
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Ruby reader failed (${code}): ${Buffer.concat(err).toString().slice(0, 2000)}`));
          return;
        }
        try {
          resolve((JSON.parse(Buffer.concat(out).toString("utf8")) as { files: FileFacts[] }).files);
        } catch (e) {
          reject(new Error(`Ruby reader printed bad JSON: ${(e as Error).message}`));
        }
      });
      child.stdin.end(JSON.stringify({ files }));
    });
  }
}
