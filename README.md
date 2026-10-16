# Refract

See how a code change reshaped a codebase, so you can judge an AI agent's branch before you merge it.

Run `refract` in a git repository and a browser tab opens on a summary of the change: one plain sentence on what it does, then its 3 to 5 key changes, each with a small before-and-after drawing of only the classes it is about. When you want to wander, the Explore view is one zoomable map of the whole change: business areas, then the classes inside an area, then one class before and after, then its code. Point it at a branch an agent is working on and the map updates on every commit. Three lenses, written from the books of Sandi Metz, John Ousterhout and David Bryant Copeland, read the measurements and ask pointed questions about the change.

Ruby and Rails come first. Everything language-specific sits behind one reader interface, so another language is a new reader, not a rewrite.

## What you see

- **Summary** (the default). It opens on **what changed in the product**, read straight from the code: tables and columns from the before and after `db/schema.rb` (drawn with the references between them), new migrations and which ones only move data, record lifecycles (a model's `STATES`/`STATUSES` or a state-like `enum`, and its transitions hash), screens (controller actions that came or went, plus the route lines), permission rules (public `?` methods on policies), and jobs and mailers. When Claude Code writes the summary it adds one plain sentence to each part. After that come 3 to 5 key changes to the code's structure, such as "Invitation sending moved into one service". Key changes don't overlap: a class is the main subject of only one of them. Each has two or three plain sentences, a before and after drawing of just its classes with a line on what to look for, and a single line from one of the authors that opens into the full note (a note about a method shows that method's code with the change marked). The drawings lay classes out by Rails layer, controllers on the left, services and jobs in the middle, models on the right, and label each box with its role. "What the authors think" gives each author's overall take on the change in their own voice, where they disagree, and the rest of their notes. <kbd>←</kbd>/<kbd>→</kbd> step through the pages; click a box to open its shape, request flow and code in a pop-up without leaving the summary, or "Explore … in the map" to jump into the map at that class. Until Claude has written it, or without Claude Code, each key change is one of the measured shifts. The verdict counts the key changes shown: how many make the code better, how many worse, how many are open questions. The summary always covers the whole branch; the commit timeline lives in Explore. The header shows only the repo and the two branches; hover them for the SHAs, commit subject and line counts.
- **Explore** (<kbd>e</kbd>, and <kbd>t</kbd> back to the summary) is everything below.
- **Verdict strip.** Base and head, a measured verdict and the handful of deltas that drove it. The verdict weighs what got better against what got worse ("Better", "Mostly worse", "Mixed"…) and adds "with questions" when some changes are worth asking about; questions never count as worse. Click a delta to fly the map to what it is about.
Explore opens one level at a time, so a first look is just the map:

- **The map.**
  1. *Business areas.* Each part of the product is a tile, sized by how much code it holds. Teal tiles are the parts the change touched, deeper teal for more, and "Start here" marks the one it touched most. Arrows between tiles show only dependencies the change made or broke.
  2. *Inside an area.* Click a tile, or zoom in, and it opens like a city on a map, with a breadcrumb back out. Every class is an Ousterhout box: **width is its public interface, height is the code behind it**, so deep modules are narrow and tall. At first only the links the change made or broke inside the area show; hover a class to light up all of its links.
  3. *One class.* Zoom further and each box lists its methods with bars for their length. Click a class for its panel, which opens on Shape (before and after, every method's lines, params and branches, what it depends on and what uses it); Request flow and Code are the other tabs.
- **Before and after.** Hold <kbd>space</kbd> (or the "Hold to see before" button) to see the map before the change: boxes shrink or grow back, new things fade out, removed things return. <kbd>s</kbd> shows both side by side, panning and zooming together.
- **What am I looking at?** The first time you reach each level, a small card explains it in plain words. The <kbd>?</kbd> button brings it back.
- **More.** The numbers (the verdict and the measures that moved), what the authors think, and the commit timeline wait behind the More button (<kbd>m</kbd>):
  - *What the authors think.* Metz, Ousterhout and Copeland each give 2 to 5 items ("likes", "asks", "worries"), each tied to a class and to a rule in their checklist. Clicking one flies the map there. A "Where they disagree" card shows trade-offs they weigh differently.
  - *Commit timeline.* A dot per commit since the branch left its base. Drag along it, or use <kbd>←</kbd>/<kbd>→</kbd>, to replay the map commit by commit. While watching, new commits pulse in.

Keys in Explore: hold <kbd>space</kbd> for before, <kbd>s</kbd> side by side, <kbd>m</kbd> more, <kbd>f</kbd> fit the map, <kbd>←</kbd>/<kbd>→</kbd> step through commits (with More open), <kbd>Esc</kbd> close the panel.

## Install

Needs Node 20+, git, Ruby 3.3+ (for its built-in Prism parser), and [Claude Code](https://claude.com/claude-code) for the lenses and the area draft. Refract calls `claude -p` with your own login and settings; there is no API key to configure.

```sh
git clone https://github.com/EdIzaguirre/refract && cd refract
npm install
npm run build
npm link            # puts `refract` on your PATH
refract install-command   # optional: adds /refract to Claude Code
```

## Use

```sh
cd ~/code/your-app
refract                       # current branch against where it left the default branch
refract agent/feature-x       # that branch against the default branch
refract main..agent/feature-x # an explicit range
refract watch agent/feature-x # follow a branch an agent is committing to
refract diff main..feature    # the measurements in the terminal (--json for JSON)
refract lenses main..feature  # the lenses, as JSON
refract trace main..feature   # trace request flows by running the relevant tests
refract areas --draft         # ask Claude Code to draft your business areas
```

`refract` and `refract watch` start a local server on <http://127.0.0.1:4100> (or the next free port) and open your browser. `--port`, `--no-open` and `--quiet <seconds>` (how long a watched branch must be quiet before the lenses run on their own; default 180) are available.

Inside Claude Code, `/refract main..agent/feature-x` starts the map in the background and keeps the measurements in the conversation, so you can ask follow-up questions there.

### Try it on a sample

```sh
scripts/make-sample-repo.sh /tmp/shop
cd /tmp/shop && refract watch agent/receipts
# in another terminal, play an agent committing every few seconds:
scripts/simulate-agent.sh /tmp/shop
```

## Business areas

The first time Refract opens a repository it asks Claude Code to group the classes into business areas and writes `~/.refract/<owner>-<repo>/areas.yml`. Nothing is written into the project. Edit the file freely; Refract re-reads it whenever it changes and never redrafts over it unless you run `refract areas --draft`.

```yaml
areas:
  - name: Invitations & Sign-in
    description: Inviting clients, magic links and sign-in.
    classes:            # globs on class names, with :: written as /
      - ClientInvitation*
      - "**/ClientInvitation*"
      - SignInLink
    paths:              # globs on repository paths
      - "rails_app/app/**/invitation*/**"
```

A class goes to the first area whose `classes` globs match its name, else the first whose `paths` match one of its files. A class no glob matches (often one the change just added) follows its name, then the area most of its collaborators live in. Views and tests follow the class they belong to. Until an `areas.yml` exists, Refract infers areas from the dependency graph and class names.

## Request flows

Sequence diagrams come from two sources. Calls found in the code are drawn **dashed**. Press "Trace with the tests" in a class's Request flow tab (or run `refract trace`) and Refract runs the tests that touch the changed classes on both sides of the change with Ruby's `TracePoint` on; calls it saw are drawn **solid**. A flow no test exercises stays dashed.

Tracing runs your tests on your machine, so it needs the app's test setup (database and so on). The head side runs in your checkout when it is checked out and clean; otherwise, and for the base side, Refract makes a git worktree under `.git/refract/worktrees/`. Configure it in `~/.refract/<owner>-<repo>/config.yml` when detection gets it wrong:

```yaml
app_root: rails_app                    # the folder with the Rails app, in a monorepo
test_command: bin/rails test {files}   # {files} is replaced with the test files to run
```

## How it works

```
git commit ──► language reader ──► snapshot ──► compare(base, head) ──► browser (SSE)
              (Ruby + Prism)       (classes,      (deltas, verdict,        map, timeline
                                    methods,       areas, edges)           lens rail
                                    dependencies)        │
                                                         └──► claude -p ──► lenses
```

- `readers/ruby/reader.rb` parses Ruby with Prism and prints facts per file: classes, methods with visibility, parameters, branches and calls, constants referenced, and the Rails declarations that widen a class (associations, callbacks, `helper_method`, scopes, delegates).
- `src/core/snapshot.ts` folds those facts into one snapshot per commit. Facts are cached per git blob in `.git/refract/`, so a new commit only re-reads the files it changed. Nested helper classes (a service's `Result`) fold into their outer class.
- `src/core/compare.ts` compares two snapshots: class shapes, method changes, dependency edges, area roll-ups, and the measured deltas behind the verdict.
- `src/core/product.ts` reads what the change does to the product: tables, columns and foreign keys from `db/schema.rb` at both commits, new migrations, lifecycles in touched models, controller actions, route lines, policy rules, and jobs and mailers. Rails conventions only, nothing guessed.
- `src/core/story.ts` writes the summary: Claude Code turns the measurements, the diff and the lens questions into key changes, cached in `.git/refract/stories/`; `measuredStory` builds them from the deltas when Claude is not available.
- `src/core/lenses.ts` sends each lens its checklist from `lenses/*.md`, the measurements and the diff, and asks for structured questions. The checklists were built from the books with quotes checked word for word; lenses must argue only from them.
- `src/server/server.ts` serves the app, polls the watched branch every 2 seconds and pushes new comparisons, lens progress and status over Server-Sent Events.
- `web/` is React and SVG with d3-zoom; ELK lays out each area's class graph; Mermaid draws the sequence diagrams.

### Adding a language

Implement `Reader` in `src/core/reader.ts`: say which files you claim and which are tests, and turn source into `FileFacts`. The rest of Refract only reads snapshots.

## Develop

```sh
npm run build:server && node bin/refract.js --no-open   # API on :4100
npm run dev:web                                          # Vite on :5173, proxying /api
npm test                                                 # vitest: reader, compare, areas, flows, lenses
npm run typecheck
```

## Known gaps in v1

- Only the Ruby reader exists. ERB views are counted per area but not measured.
- Duplication and test coverage are not measured yet.
- The verdict is a heuristic over the deltas; the lenses are where judgement lives.
- While watching, the layout is recomputed per commit, so boxes can move when the graph changes.
- Next up, from the plan: click-to-ask into Claude Code, agent self-review, morning replay of overnight merges, trends, and a desktop wrap.
