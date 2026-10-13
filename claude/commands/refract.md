---
description: Open Refract's map of a change and keep its measurements here for follow-up questions
argument-hint: "[range, e.g. main..agent-branch, or a branch to watch]"
allowed-tools: Bash(refract:*), Bash(nohup refract:*), Read, Grep, Glob
---

Refract shows how a code change reshaped this codebase: a zoomable before/after map, the measured deltas, and questions from the Metz, Ousterhout and Copeland lenses.

1. Start the map in the background so it keeps watching the branch:
   `nohup refract $ARGUMENTS > "${TMPDIR:-/tmp}/refract.log" 2>&1 &`
   Then read the first lines of that log for the URL and tell me it.
2. Print the measurements and keep them in this conversation:
   `refract diff $ARGUMENTS`
3. Summarize in three sentences: the verdict, the one or two deltas that matter most, and where on the map to look first.

After that, answer my follow-up questions from these measurements and the code itself. When I ask about a lens question, read the cited rule in Refract's lens checklists (`lenses/*.md` in Refract's install folder) before answering, and never quote the books from memory.
