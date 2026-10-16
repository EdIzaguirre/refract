---
description: Open Refract's map of a change, or with "plan", draft a plan (or two to compare) Refract can draw before the code exists
argument-hint: "[range or branch to watch] | plan [name] | plan --two [name]"
allowed-tools: Bash(refract:*), Bash(nohup refract:*), Read, Grep, Glob, Write(~/.refract/**), Edit(~/.refract/**)
---

Refract shows how a code change reshaped this codebase: what changed in the product, a zoomable before/after map, and questions from the Metz, Ousterhout and Copeland lenses. It can also draw a plan before any code exists, and check a branch against its plan before merge.

The arguments are: `$ARGUMENTS`

If they start with `plan --two` (or `plan` and ask for two designs), follow **Draft two plans** below. If they start with `plan`, follow **Draft a plan**. Otherwise follow **Open the map**.

## Open the map

1. Start the map in the background so it keeps watching the branch:
   `nohup refract $ARGUMENTS > "${TMPDIR:-/tmp}/refract.log" 2>&1 &`
   Then read the first lines of that log for the URL and tell me it.
2. Print the measurements and keep them in this conversation:
   `refract diff $ARGUMENTS`
3. If the branch has a plan (`refract plan path <branch>` exists), also run `refract plan check <branch>` and keep its list here.
4. Summarize in three sentences: what changed in the product, the one or two code changes that matter most, and (if there is a plan) what was built that the plan never mentioned.

After that, answer my follow-up questions from these measurements and the code itself. When I ask about a lens question, read the cited rule in Refract's lens checklists (`lenses/*.md` in Refract's install folder) before answering, and never quote the books from memory.

## Draft a plan

A plan is one small YAML file saying what a change intends to do, in the terms Refract reads from code: tables, lifecycles, screens, permission rules, jobs, classes with their public methods, and call trees for the requests that matter. Refract draws it against today's code so we can argue with the design while changing it costs nothing, and checks the branch against it before merge.

1. The plan's name is the word after `plan` in the arguments. Without one, use the branch we are about to build on: the current branch if it is not the default branch, else a short kebab-case name for the feature (say which you picked).
2. Learn the format and today's names:
   `refract plan format` and `refract plan context`
   Read the code for anything the plan reshapes, so the plan uses real names and real signatures.
3. Write the plan from what this conversation decided, and nothing it didn't:
   - Product facts first: `tables`, `lifecycles`, `screens`, `permissions`, `jobs`. These are what I will check hardest.
   - `classes` only for new or reshaped classes, each with its public methods as signatures (`add_fee(fee, qty, by)`) and what it depends on. Leave private helpers out.
   - `flows` only for the one to three requests that matter, as call trees from the controller action down.
   - Existing tables, classes and states must be spelled exactly as `refract plan context` shows them. New names follow Rails conventions.
   - Every section is optional. A copy tweak needs no plan; a medium change might be only tables and lifecycles. Small beats complete.
   - Where we have not decided something, leave it out and list it as an open question in your reply, rather than guessing in the file.
4. Write it to the path `refract plan path <name>` prints (create the folder if needed). It lives outside the repository, like Refract's areas.yml.
5. Run `refract plan check <name>`. Fix anything it says it could not read.
6. Open the preview in the background and tell me the URL:
   `nohup refract --plan <name> > "${TMPDIR:-/tmp}/refract-plan.log" 2>&1 &`
7. In three or four sentences, say what the plan commits to and the open questions.

Then I will argue with the plan. Edit the file as we go; the page re-reads it on every save. When the branch is built, `refract <branch>` opens on the Plan check, and `refract plan check <name>` prints the same list here.

## Draft two plans

Ousterhout's "design it twice" (A Philosophy of Software Design, Ch 11): before settling on a design, sketch a second one that is radically different, and compare them. Here that means two plan files for the same goal, laid side by side.

1. Pick the name as in **Draft a plan**, step 1. The two plans are `<name>-a` and `<name>-b`.
2. Run `refract plan format` and `refract plan context`, and read the code the goal touches, as in **Draft a plan**, step 2.
3. Write two plans that reach the same goal in genuinely different ways, following the rules in **Draft a plan**, step 3. Different means a different shape, not different names: where the work lives (a new service against an existing model or a concern), what new tables there are (a new table against columns or rows on an existing one), or who drives the request (the controller calling each step against one call into a deeper class). Change the product only where the second design truly needs it, since the comparison is clearest when both deliver the same product. Give each a `title` that names its approach, like "Invoices, as line items".
4. Write them to the paths `refract plan path <name>-a` and `refract plan path <name>-b` print, and run `refract plan check` on each until Refract reads every line.
5. Compare them and keep the comparison in this conversation: `refract plan compare <name>-a <name>-b`
6. Open the side-by-side page in the background and tell me the URL:
   `nohup refract --plan <name>-a --vs <name>-b > "${TMPDIR:-/tmp}/refract-plans.log" 2>&1 &`
7. In four or five sentences: what each plan commits to, where they differ in the product, and the trade-off the comparison shows. Do not pick for me.

Then I will argue with both. Edit either file as we go; the page re-reads them. When I pick one (or ask for a mix of the two), write the result to `refract plan path <name>` so the branch's Plan check uses it, and say so.
