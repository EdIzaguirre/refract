---
description: Open Refract's map of a change, or with "plan", draft a plan Refract can draw before the code exists
argument-hint: "[range or branch to watch] | plan [name]"
allowed-tools: Bash(refract:*), Bash(nohup refract:*), Read, Grep, Glob, Write(~/.refract/**), Edit(~/.refract/**)
---

Refract shows how a code change reshaped this codebase: what changed in the product, a zoomable before/after map, and questions from the Metz, Ousterhout and Copeland lenses. It can also draw a plan before any code exists, and check a branch against its plan before merge.

The arguments are: `$ARGUMENTS`

If they start with `plan`, follow **Draft a plan** below. Otherwise follow **Open the map**.

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
