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
refract --plan feature-x      # draw a plan against today's code, before the branch exists
refract plan check feature-x  # the plan against what the branch built
refract --plan x-a --vs x-b,x-c   # two to four plans for one goal, side by side (design it twice)
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

## Plans: design before code, check before merge

A plan is one small YAML file saying what a change intends to do, in the same terms Refract reads from code: tables, lifecycles, screens, permission rules, jobs, classes with their public methods, and call trees. Refract uses it twice.

- **Before code: the preview.** `refract --plan <name>` draws the plan as the "after" side against today's code, in the views you already know. The product page shows the planned tables, states, screens and rules, tagged "planned". The key changes are one per planned class and one per flow, each with its before-and-after drawing and, for a flow, a sequence diagram of the planned calls. In Explore, planned classes are dashed boxes in their business area: width is their planned public methods, height is a fixed placeholder until code exists. Edit the file and the page follows. "What the authors think" reads the plan itself, so the lenses argue with the design rather than with code sizes.
- **Before merge: the Plan check.** When the branch you open has a plan, the Summary opens on **Plan check**: what was built but never planned (first, since it is the part worth a conversation), what was planned but is missing, what was built differently (a method with other parameters, a class that doesn't use what the plan said), and what was built as planned. Each line opens the class pop-up or the product page at that part. `refract plan check <name>` prints the same list in the terminal. It follows a watched branch commit by commit, so it also shows how much of the plan has landed.

Plans live outside the project, at `~/.refract/<owner>-<repo>/plans/<branch>.yml` (a branch's slashes become folders). In Claude Code, `/refract plan` drafts one from the conversation, checks that Refract can read it, and opens the preview; you argue, and Claude edits the file. Every section is optional:

```yaml
title: Invoices for approved timesheets
why: Contractors bill orgs for fees and expenses.
approach: Charges are rows on a new table, priced by one service.
short: Fee table                                # a word or two naming the plan beside others (compare); defaults to the end of the title

tables:
  fees:              { new: true, belongs_to: orgs, columns: [name, unit, price_cents:integer] }
  timesheets:        { add: [sent_at, sent_by_id] }
  invoices:          { add: [billed_to_id], belongs_to: { billed_to: orgs } }   # a map when the column is not <table>_id
lifecycles:
  Timesheet.state:   { add_states: [sent], moves: [approved -> sent, sent -> paid] }
screens:
  Org::Settings::FeesController: [index, new, create]
  Org::TimesheetsController: [+mark_sent]       # + adds to an existing controller, - removes
permissions:
  TimesheetPolicy: [mark_sent?]
jobs:
  InvoiceMailer: [invoice_sent]
classes:
  TimesheetCharges:
    note: One home for charge rules.
    public: [add_fee(fee, qty, by), reprice(charge, cents)]
    depends_on: [Timesheet, TimesheetCharge, Fee]
  Timesheet:                                    # an existing class: what it gains, and -name for what it loses
    public: [charges, -legacy_total]
flows:
  "contractor adds a fee":                      # a flat list: each step calls the next
    - Org::Timesheets::ChargesController#create
    - TimesheetCharges#add_fee
    - TimesheetCharge.create!
```

### Design it twice

Ousterhout's Ch 11 asks for "multiple options for each major design decision". `refract --plan <a> --vs <b>,<c>` draws two to four plans for the same goal against the same code and lays them side by side, product first. Each plan's heading shows its title and its `approach` (one or two sentences on what sets it apart); `why` is left out, since the plans share the goal. Add `--base <branch>` to draw them against a shared core branch instead of the default branch:

- **What each plan adds to the product**: the tables, states, screens, rules and jobs where they part ways (with each plan's tables drawn), then what they share.
- **What the rest of the code must learn**: the public methods each plan adds outside controllers, policies, jobs and mailers, with their parameters.
- **Existing code each plan touches**: one row per existing class a plan reshapes, most depended on first. How many classes depend on it is measured from today's code; each plan's cell is what that plan says it does to the class, in its own words (`+` added, `−` taken away, or its note). Nothing is inferred about whether callers break.
- **The same request under each plan**: flows paired by name (or by the action they start from), as sequence diagrams, with how many calls the entry point makes itself.
- **One short Ousterhout note**, argued from Ch 11's own questions ("Does one alternative have a simpler interface than another?", "ease of use for higher level software"). Plans have no code, so it weighs interfaces and request flows only.

Edit any of the files and the page follows. `refract plan compare <a> <b> [c] [d]` prints the same in the terminal. In Claude Code, `/refract plan --two <name>` (or `--three`, `--four`) drafts genuinely different plans (`<name>-a`, `<name>-b`, ...), opens them side by side, and once you pick one, saves it as `<name>` so the branch's Plan check uses it. Four is the limit: past that the columns stop fitting and the comparison stops being one you can hold in your head.

`refract plan format` prints the full format, `refract plan context` lists today's tables, states, controllers, policies and classes to plan against, and `refract plan path <name>` says where a plan goes. Parameters count only when the plan writes the parentheses, so `assign_numbers!` leaves them open and `assign_numbers!()` says there are none.

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
- `src/core/plan.ts` reads a plan file; `plan-preview.ts` lays it over today's snapshot so the usual comparison draws it, `plan-compare.ts` lays two previews side by side, and `plan-check.ts` lays it beside a real comparison and lists what matches, what's missing and what's a surprise. The surprises read as a few topics: Claude names them with the story, and until it has, Refract groups them by the names they share (a new table, its screen and its service).
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
