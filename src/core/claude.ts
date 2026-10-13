import { spawn } from "node:child_process";

/**
 * Runs Claude Code headless (`claude -p`) with no tools and asks for JSON
 * matching a schema. Uses the person's own Claude Code login and settings,
 * so Refract needs no API key.
 */
export async function askClaude<T>(prompt: string, schema: object, opts: { cwd: string; timeoutMs?: number }): Promise<T> {
  const bin = process.env.REFRACT_CLAUDE ?? "claude";
  const args = [
    "-p",
    "--output-format",
    "json",
    "--tools",
    "",
    "--no-session-persistence",
    "--json-schema",
    JSON.stringify(schema),
  ];
  if (process.env.REFRACT_CLAUDE_MODEL) args.push("--model", process.env.REFRACT_CLAUDE_MODEL);
  const raw = await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => child.kill("SIGTERM"), opts.timeoutMs ?? 10 * 60_000);
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not run Claude Code (${bin}): ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Claude Code exited ${code}: ${Buffer.concat(err).toString().slice(0, 1000) || Buffer.concat(out).toString().slice(0, 1000)}`));
      else resolve(Buffer.concat(out).toString("utf8"));
    });
    child.stdin.end(prompt);
  });
  const envelope = JSON.parse(raw) as { is_error?: boolean; result?: string; structured_output?: T };
  if (envelope.is_error) throw new Error(`Claude Code: ${envelope.result ?? "error"}`);
  if (envelope.structured_output) return envelope.structured_output;
  return extractJson<T>(envelope.result ?? "");
}

/** Pulls the first JSON object out of a reply, fenced or not. */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Claude Code did not return JSON");
  return JSON.parse(body.slice(start, end + 1)) as T;
}
