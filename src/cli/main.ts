import { Workspace } from "../core/workspace.js";
import { printComparison } from "./print.js";

const HELP = `refract: see how a change reshaped your codebase

Usage
  refract [range]            open the map in your browser and watch the branch
  refract watch <branch>     follow an agent's branch as it commits
  refract diff [range]       print the measured changes in the terminal (--json for JSON)
  refract areas [--draft]    show the business areas; --draft asks Claude Code to write them
  refract lenses [range]     ask the Metz, Ousterhout and Copeland lenses about the change
  refract trace [range]      trace request flows by running the tests that touch the change
  refract install-command    add the /refract command to Claude Code
  refract stop               stop the running Refract
  refract --plan <name>      draw a plan against today's code, before the branch exists
  refract --plan a --vs b    two to four plans for one goal side by side (--vs b,c,d), to design it twice
  refract plan check [name]  the plan against what the branch built (plan path, format, context too)
  refract plan compare a b   the plans side by side, in the terminal (up to four names)

Ranges
  (none)        the current branch against where it left the default branch
  feature       that branch against the default branch
  main..feature an explicit base and head

Options
  --port <n>    server port (default 4100)
  --no-open     do not open a browser
  --repo <dir>  repository to look at (default: current directory)
  --plan <name> with a range, check the branch against this plan instead of its own
  --vs <names>  with --plan, up to three more plans to lay beside it, comma-separated or repeated
  --base <ref>  with --plan, draw against this branch (a shared core branch, say) instead of the default branch

Refract is one browser tab. The first refract starts it; later ones (a plan, plans
side by side, another branch or repository) open in that same tab and return at once.
The header lists what is open, so you can move between them or close one.

Plans live at ~/.refract/<repo>/plans/<branch>.yml. A branch with a plan opens on
its Plan check; /refract plan in Claude Code drafts one from the conversation.
`;

interface Args {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
  /** Every --vs, split on commas. */
  vs: string[];
}

function parse(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  const vs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (k === "vs") vs.push(...String(v ?? argv[++i] ?? "").split(",").filter(Boolean));
      else if (v !== undefined) flags[k] = v;
      else if (["port", "repo", "base", "quiet", "plan", "vs"].includes(k)) flags[k] = argv[++i];
      else flags[k] = true;
    } else if (a === "-h") flags.help = true;
    else positional.push(a);
  }
  const commands = ["watch", "diff", "areas", "lenses", "trace", "plan", "install-command", "serve", "stop", "help"];
  const command = positional[0] && commands.includes(positional[0]) ? positional.shift()! : "serve";
  return { command, positional, flags, vs };
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (args.flags.help || args.command === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (args.command === "install-command") {
    const { installCommand } = await import("./install.js");
    await installCommand();
    return;
  }
  const port = Number(args.flags.port ?? process.env.REFRACT_PORT ?? 4100);
  if (args.command === "stop") {
    const { stopRunning } = await import("../server/server.js");
    process.stdout.write((await stopRunning(port)) ? "Stopped Refract.\n" : "Refract is not running.\n");
    return;
  }
  const ws = await Workspace.open(String(args.flags.repo ?? process.cwd()));
  const spec = args.positional[0];

  switch (args.command) {
    case "diff": {
      const { base, head } = await ws.range(spec);
      const c = await ws.compare(base, head);
      c.base.ref = spec?.includes("..") ? spec.split("..")[0] : c.base.short;
      c.head.ref = spec?.includes("..") ? spec.split(/\.\.\.?/)[1] || "HEAD" : (spec ?? c.head.short);
      process.stdout.write((args.flags.json ? JSON.stringify(c, null, 2) : printComparison(c)) + "\n");
      return;
    }
    case "areas": {
      const { runAreasCommand } = await import("./areas-command.js");
      await runAreasCommand(ws, spec, Boolean(args.flags.draft));
      return;
    }
    case "plan": {
      const { runPlanCommand } = await import("./plan-command.js");
      await runPlanCommand(ws, args.positional, args.flags);
      return;
    }
    case "lenses": {
      const { base, head } = await ws.range(spec);
      const { runLenses } = await import("../core/lenses.js");
      const c = await ws.compare(base, head);
      const report = await runLenses(ws, c, (msg) => process.stderr.write(msg + "\n"));
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      return;
    }
    case "trace": {
      const { base, head } = await ws.range(spec);
      const { traceFlows } = await import("../core/flows.js");
      const c = await ws.compare(base, head);
      for (const side of ["before", "after"] as const) {
        const r = await traceFlows(ws, c, side, (msg) => process.stderr.write(msg + "\n"));
        process.stdout.write(JSON.stringify(r, null, 2) + "\n");
      }
      return;
    }
    case "watch":
    case "serve": {
      const { launch } = await import("../server/server.js");
      await launch(ws, {
        spec,
        watch: args.command === "watch" ? (spec ?? null) : undefined,
        port,
        open: !args.flags["no-open"],
        quietSeconds: Number(args.flags.quiet ?? 180),
        plan: typeof args.flags.plan === "string" ? args.flags.plan : undefined,
        vs: args.vs.length ? args.vs : undefined,
        base: typeof args.flags.base === "string" ? args.flags.base : undefined,
      });
      return;
    }
  }
}

main().catch((e: Error) => {
  process.stderr.write(`refract: ${e.message}\n`);
  process.exit(1);
});
