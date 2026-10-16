# Ousterhout lens: code-change checklist (Ruby/Rails first)

Rules from John Ousterhout, *A Philosophy of Software Design* (2nd ed., 2021), each with a diff check and a verbatim source quote; the book asks for "moderation and discretion" (Ch 1), so report hits as questions, not failures.

## Design principles

The book's "Summary of Design Principles", in its order.

1. Complexity is incremental: each small dependency or obscure bit matters, because they add up.
   - Check: count what the diff adds to the interface and to the branching: new public methods, new parameters, new `if`/`unless`/`case` arms, new cross-file references. Comment on the total, not just the largest item.
   - Source: Ch 2 "The Nature of Complexity" §2.4: "Complexity comes about because hundreds or thousands of small dependencies and obscurities build up over time."

2. Working code is not enough. The goal is a good design that also works.
   - Check: the diff makes a feature work by adding a special case, flag or patch to code that already has red flags, without changing its structure. Look for `TODO`, `HACK`, "quick fix" wording.
   - Source: Ch 3 "Working Code Isn’t Enough" §3.2: "Your primary goal must be to produce a great design, which also happens to work."

3. Make small design improvements continually, not in a later cleanup.
   - Check: the diff touches a file that has red flags and fixes none of them. Ratio of refactoring lines to feature lines in the diff.
   - Source: Ch 3 §3.5: "The most effective approach is one where every engineer makes continuous small investments in good design."

4. Modules should be deep: a lot of functionality behind a simple interface.
   - Check: for each new or changed class and method, compare interface size (public methods, their parameters, required call order) with implementation size (lines, branches). Flag where the two are close.
   - Source: Ch 4 "Modules Should Be Deep" §4.4: "The best modules are deep: they have a lot of functionality hidden behind a simple interface."

5. Make the most common use of an interface as simple as possible.
   - Check: count required arguments and setup calls at the common call sites. Flag a keyword that every caller passes with the same value, or a call that only works after another call.
   - Source: Ch 4 §4.7: "interfaces should be designed to make the common case as simple as possible"

6. A simple interface matters more than a simple implementation.
   - Check: the diff makes callers do work the callee could do: each call site does the same pre- or post-processing, rescues the same error, or passes the same derived value.
   - Source: Ch 8 "Pull Complexity Downwards" intro: "it is more important for a module to have a simple interface than a simple implementation."

7. General-purpose modules are deeper. Build "somewhat general-purpose": today's functionality, an interface not tied to today's caller.
   - Check: new public methods named after one screen, button or caller (`approve_from_dashboard`), or called from exactly one site. Several near-identical special-purpose methods that one general method could replace.
   - Source: Ch 6 "General-Purpose Modules are Deeper" §6.1: "the module’s functionality should reflect your current needs, but its interface should not."

8. Keep general-purpose code and special-purpose code in separate modules.
   - Check: a shared mechanism (`lib/`, a concern, a base class, a shared service) gains a branch or method that names one model, feature or caller.
   - Source: Ch 9 "Better Together Or Better Apart?" §9.4: "Special-purpose code associated with a general-purpose mechanism should normally go in a different module"

9. Each layer should give a different abstraction from the layers next to it.
   - Check: controller → service → model chains where the method names and arguments stay the same at every step. Wrapper classes whose public methods mirror the wrapped object.
   - Source: Ch 7 "Different Layer, Different Abstraction" intro: "If a system contains adjacent layers with similar abstractions, this is a red flag that suggests a problem with the class decomposition."

10. Pull complexity down: the module's author should take on pain so its users do not.
    - Check: new configuration knobs, options hashes or ENV keys without defaults. New exceptions that every caller must rescue. Work duplicated across call sites.
    - Source: Ch 8 §8.4: "look for opportunities to take a little bit of extra suffering upon yourself in order to reduce the suffering of your users."

11. Define errors out of existence: shape the API so that the error case cannot arise.
    - Check: new `raise` or custom error classes for conditions that a slightly different meaning would make normal (deleting a record that is already gone, an out-of-range slice). New `rescue` blocks at call sites.
    - Source: Ch 10 "Define Errors Out Of Existence" §10.3: "define your APIs so that there are no exceptions to handle: define errors out of existence."

12. Design it twice: consider radically different options before choosing.
    - Check: not visible in code. Look for alternatives considered in the PR description of a new class, table or public API.
    - Source: Ch 11 "Design it Twice": "You’ll end up with a much better result if you consider multiple options for each major design decision"

13. Comments should say what the code cannot: meaning, units, boundaries, reasons.
    - Check: new public classes and methods without a header comment. Comments whose words are all in the next line's identifiers.
    - Source: Ch 13 "Comments Should Describe Things that Aren’t Obvious from the Code" intro: "The guiding principle for comments is that comments should describe things that aren’t obvious from the code."

14. Write for the reader, not for the writer.
    - Check: methods returning generic containers (`[record, true]`, a bare `Hash` or `Struct` with generic keys) where a named result class would carry meaning. Terse cleverness that saves the writer keystrokes.
    - Source: Ch 18 "Code Should be Obvious" §18.2: "software should be designed for ease of reading, not ease of writing."

15. Develop in increments of abstractions, not features.
    - Check: a feature delivered as flags and branches spread across several existing classes, rather than as one new or extended abstraction.
    - Source: Ch 19 "Software Trends" §19.2: "the increments of development should be abstractions, not features."

16. Separate what matters from what does not. Make what matters prominent and hide the rest.
    - Check: method parameters that most callers ignore or pass `nil`. The key decision of a change is buried in a private helper or a callback.
    - Source: Ch 21 "Decide What Matters" intro: "Things that matter should be emphasized and made more obvious; things that don’t matter should be hidden as much as possible."

## Red flags

The book's "Summary of Red Flags", in its order.

1. Shallow module: the interface is not much simpler than the implementation.
   - Check: public methods whose body is one line (a delegation, an attribute read, a single hash write). Classes whose public method count is close to their method count and whose LOC per public method is low.
   - Source: Ch 4 §4.5: "A shallow module is one whose interface is complicated relative to the functionality it provides."

2. Information leakage: one design decision shows up in several modules.
   - Check: the same literal, format, key set, status list or rule appears in two or more classes or files (grep each new literal and constant across `app/` and `lib/`). Two classes that both read and write one format.
   - Source: Ch 5 "Information Hiding (and Leakage)" §5.2: "Information leakage occurs when a design decision is reflected in multiple modules."

3. Temporal decomposition: code split by when things happen rather than by what each piece knows.
   - Check: classes or methods named for steps (`Reader`/`Parser`/`Writer`, `Step1`, `before_x`/`after_x`) that share knowledge of the same format or rule.
   - Source: Ch 5 §5.4 (red-flag box): "In temporal decomposition, execution order is reflected in the code structure"

4. Overexposure: to use the common feature, callers must learn about rare ones.
   - Check: required arguments or options that only rare callers need. Common call sites that pass the same option values.
   - Source: Ch 5 §5.7: "If the API for a commonly used feature forces users to learn about other features that are rarely used"

5. Pass-through method: a method that only forwards its arguments to a method with a similar signature.
   - Check: a method whose body is one call on another object with the same or nearly the same arguments; long `delegate ... to:` lists. Report the pass-through share of public methods. Dispatchers and several implementations of one interface are exempt (§7.2).
   - Source: Ch 7 §7.1: "A pass-through method is one that does nothing except pass its arguments to another method, usually with the same API as the pass-through method."

6. Repetition: the same nontrivial code appears again and again.
   - Check: duplicate or near-duplicate blocks (a structural duplication tool such as `flay` for Ruby). The book says one- or two-line snippets may not be worth extracting (§9.3).
   - Source: Ch 9 §9.4: "appears over and over again, that’s a red flag that you haven’t found the right abstractions."

7. Special-general mixture: a general mechanism contains code for one particular use.
   - Check: a branch on a specific model, type or caller inside a shared concern, base class, `lib/` module or generic service.
   - Source: Ch 9 §9.5: "This red flag occurs when a general-purpose mechanism also contains code specialized for a particular use of that mechanism."

8. Conjoined methods: two methods that can only be understood together.
   - Check: an extracted helper called from one place that reads or sets the caller's instance variables, or takes and returns several of the caller's locals. Pairs of files that each reference the other's internals.
   - Source: Ch 9 §9.7: "If you can’t understand the implementation of one method without also understanding the implementation of another, that’s a red flag."

9. Comment repeats code.
   - Check: comment words are a subset of the tokens in the identifiers on the next line (`# Find the user` above `find_user`).
   - Source: Ch 13 §13.2: "One example of this is when the comment uses the same words that make up the name of the thing it is describing."

10. Implementation documentation contaminates interface: a header comment explains internals that callers do not need.
    - Check: method or class header comments that mention private methods, instance variables, SQL, internal tables or algorithms.
    - Source: Ch 13 §13.5: "describes implementation details that aren’t needed in order to use the thing being documented."

11. Vague name: a name broad enough to mean many things.
    - Check: new identifiers built from generic words (`data`, `info`, `result` in a method with no return value, `status`, `count`, `flag`, `obj`, `manager`, `handler`, `x`). Booleans that are not predicates.
    - Source: Ch 14 "Choosing Names" §14.3: "If a variable or method name is broad enough to refer to many different things, then it doesn’t convey much information"

12. Hard to pick name: no short, precise name fits, so the thing itself may be badly defined.
    - Check: names over three words, names joined by `and`/`or`, or one name used for two different things. §14.2 says names "become unwieldy if they contain more than two or three words".
    - Source: Ch 14 §14.3: "that’s a hint that the underlying object may not have a clean design."

13. Hard to describe: a complete comment for the method or variable has to be long.
    - Check: header comment length against method body length. A header comment that must walk through the implementation means the method is shallow (§15.3).
    - Source: Ch 15 "Write The Comments First" §15.3: "that’s an indicator that there may be a problem with the design of the thing you are describing."

14. Nonobvious code: a quick read does not reveal what it does.
    - Check: metaprogramming (`send`, `define_method`, `method_missing`), callbacks and event subscribers with no comment saying when they run, generic containers, code that breaks reader expectations.
    - Source: Ch 18 §18.2: "If the meaning and behavior of code cannot be understood with a quick reading, it is a red flag."

## Other rules by chapter

### Ch 1 Introduction

1. Every rule has limits. Apply the lens with judgment and do not push any rule to the extreme.
   - Check: before posting, ask whether the suggested fix would trip another rule (for example, merging classes until one is huge).
   - Source: Ch 1 "Introduction" §1.1: "Every rule has its exceptions, and every principle has its limits."

### Ch 2 The Nature of Complexity

1. Change amplification: one simple change needs edits in many places.
   - Check: number of files and modules touched for one logical change (for example, adding one status value).
   - Source: Ch 2 §2.2: "a seemingly simple change requires code modifications in many different places."

2. Hidden dependencies cause unknown unknowns, the worst symptom.
   - Check: a change in one place silently requires a change elsewhere with no reference, comment or shared constant linking them (a new enum value that must also be added to a hash in another file).
   - Source: Ch 2 §2.3: "Obscurity is often associated with dependencies, where it is not obvious that a dependency exists."

### Ch 5 Information Hiding (and Leakage)

1. `private` is not information hiding. Getters and setters can still expose the decision.
   - Check: new `attr_accessor`/`attr_reader` for internal state; public methods that return internal hashes or arrays for callers to dig into.
   - Source: Ch 5 §5.1: "hiding variables and methods in a class by declaring them private isn’t the same thing as information hiding."

2. Do not hand out internal data structures.
   - Check: a public method returns a mutable internal collection (`def params = @params`) instead of answering a specific question.
   - Source: Ch 5 §5.6: "it’s important to avoid exposing internal data structures as much as possible."

3. Provide defaults so classes do the right thing without being asked.
   - Check: new required arguments that nearly every caller sets to the same value.
   - Source: Ch 5 §5.7: "Whenever possible, classes should “do the right thing” without being explicitly asked."

4. Inside a class, limit how many places each instance variable is used.
   - Check: count methods that reference each instance variable. Flag new references to an ivar that is already used widely.
   - Source: Ch 5 §5.8: "try to minimize the number of places where each instance variable is used."

5. Do not hide information that callers really need.
   - Check: a change that removes a parameter, return value or error that some caller actually needs.
   - Source: Ch 5 §5.9: "If the information is needed outside the module, then you must not hide it."

### Ch 6 General-Purpose Modules are Deeper

1. A method designed for one particular use is a warning sign.
   - Check: new public methods with a single call site whose name describes that call site.
   - Source: Ch 6 §6.5: "that is a red flag that it may be too special-purpose."

2. Remove special cases by designing the normal case to cover edge conditions.
   - Check: new `return if x.nil?`, `&.` chains, `blank?` guards or "none" state flags, where an empty object or empty collection would let the normal path work.
   - Source: Ch 6 §6.8: "special cases should be eliminated wherever possible."

### Ch 7 Different Layer, Different Abstraction

1. Avoid shallow decorators and wrappers.
   - Check: a new `SimpleDelegator`, presenter or wrapper class that forwards most methods and adds a little.
   - Source: Ch 7 §7.3: "decorator classes tend to be shallow: they introduce a large amount of boilerplate for a small amount of new functionality."

2. A class's interface should differ from its internal representation.
   - Check: public methods that map one-to-one onto columns or internal fields, pushing the work of combining them onto callers.
   - Source: Ch 7 §7.4: "the representations used internally should be different from the abstractions that appear in the interface."

3. Avoid pass-through variables.
   - Check: a parameter threaded through two or more methods that do nothing with it but pass it on.
   - Source: Ch 7 §7.5: "Pass-through variables add complexity because they force all of the intermediate methods to be aware of their existence"

4. Every new class, method or argument must remove more complexity than it adds.
   - Check: for each new element in the diff, name the complexity it removes. If none, suggest inlining it.
   - Source: Ch 7 §7.6: "it must eliminate some complexity that would be present in the absence of the design element."

### Ch 8 Pull Complexity Downwards

1. Avoid configuration parameters. If one is needed, give it a sensible default.
   - Check: new ENV keys, `config.x` settings, or option arguments, with no default or with a value that the code could compute itself.
   - Source: Ch 8 §8.2: "you should avoid configuration parameters as much as possible."

### Ch 9 Better Together Or Better Apart?

1. Keep code together when the pieces share information.
   - Check: two new or changed classes that both depend on the same format, column set or protocol.
   - Source: Ch 9: "They share information; for example, both pieces of code might depend on the syntax of a particular type of document."

2. Length alone is not a reason to split a method. Split only if the result is simpler overall.
   - Check: extractions whose only visible motive is a size limit (this repo's `Sunlight/SizeAllowance`), producing helpers with one call site that share state with the caller. Prefer the split where the child can be read without the parent.
   - Source: Ch 9 §9.7: "length by itself is rarely a good reason for splitting up a method."

3. Fold back shallow helpers that are only used in one place and must be read with their caller.
   - Check: new one-line methods or tiny classes with exactly one call site, especially in a separate file.
   - Source: Ch 9 §9.6: "This separation added complexity with no benefit."

### Ch 10 Define Errors Out Of Existence

1. Aggregate exception handling in one place instead of many handlers.
   - Check: several `rescue` blocks that do the same thing (render an error, log and return) where one `rescue_from` or top-level handler would do.
   - Source: Ch 10 §10.7: "rather than writing distinct handlers for many individual exceptions, handle them all in one place with a single handler."

2. Do not swallow errors that callers need to know about.
   - Check: `rescue => e` followed by `nil`, `false` or a log line only, on operations whose failure the caller must act on.
   - Source: Ch 10 §10.9: "But when something is important, it must be exposed"

### Ch 13 Comments Should Describe Things that Aren’t Obvious from the Code

1. Every class and every method gets an interface comment, including side effects and preconditions.
   - Check: new classes or public methods with no header comment; header comments that omit side effects (writes, jobs, mail) or required call order.
   - Source: Ch 13 §13.1: "Every class should have an interface comment, every class variable should have a comment, and every method should have an interface comment."

2. Document design decisions that cross module boundaries where developers will find them.
   - Check: when the diff keeps the same decision in two places on purpose, a comment at the obvious place (for example the constant or enum) names the other places.
   - Source: Ch 13 §13.7: "Cross-module decisions are often complex and subtle, and they account for many bugs, so good documentation for them is crucial."

### Ch 14 Choosing Names

1. Use names consistently: one name per purpose, and never for anything else.
   - Check: the diff introduces a second name for an existing concept, or reuses an existing name for a different concept.
   - Source: Ch 14 §14.4: "never use the common name for anything other than the given purpose"

2. Avoid names so similar that readers mix them up.
   - Check: a new identifier within one or two edits of an existing one in the same area (`sock`/`socket`).
   - Source: Ch 14 §14.3: "These names are so similar that it’s difficult to remember which is which."

3. Every word in a name should add information.
   - Check: filler words such as `Object`, `Data`, `Info`, or a repeat of the class name in an attribute name.
   - Source: Ch 14 §14.5: "Every word in a name should provide useful information"

### Ch 16 Modifying Existing Code

1. Stay strategic when changing existing code: leave the design a little better.
   - Check: a change to a file with existing red flags adds code but improves nothing.
   - Source: Ch 16 §16.1: "If you’re not making the design better, you are probably making it worse."

2. Put the reasons in the code, not only in the commit message.
   - Check: the PR or commit message explains a subtle "why" that has no comment in the changed code.
   - Source: Ch 16 §16.3: "the most important thing is to get it in the code."

3. Document each design decision once.
   - Check: the same explanatory comment copied into several files.
   - Source: Ch 16 §16.4: "try to document each design decision exactly once."

### Ch 17 Consistency

1. Follow existing conventions. A better idea alone does not justify a new one.
   - Check: the diff does something the codebase already does in an established way (naming, error handling, service shape) but does it differently.
   - Source: Ch 17 §17.2: "Having a “better idea” is not a sufficient excuse to introduce inconsistencies."

### Ch 19 Software Trends

1. Use implementation inheritance with caution. Consider composition first.
   - Check: a new subclass that overrides parent methods or reads parent instance variables.
   - Source: Ch 19 §19.1: "implementation inheritance should be used with caution."

2. Avoid getters and setters that expose implementation data.
   - Check: new `attr_accessor`/`attr_writer` and trivial `get_`/`set_` methods.
   - Source: Ch 19 §19.6: "It’s better to avoid getters and setters (or any exposure of implementation data) as much as possible."

3. Fix bugs test-first.
   - Check: a bug-fix change with no new test that would have failed before the fix.
   - Source: Ch 19 §19.4: "Before fixing a bug, write a unit test that fails because of the bug."

### Ch 20 Designing for Performance

1. Measure before and after any change made for speed. Back out complexity that does not pay.
   - Check: a change justified by performance, with no benchmark or profile numbers in the PR.
   - Source: Ch 20 §20.2: "Before making any changes, measure the system’s existing behavior."

### Ch 21 Decide What Matters

1. Make as little matter as possible: fewer required parameters, good defaults.
   - Check: count the required arguments of new constructors and `initialize` methods.
   - Source: Ch 21 §21.2: "try to minimize the number of parameters that must be specified to construct an object"

## Claims to correct

1. "Complexity is caused by dependencies and obscurity." **Supported.** The book names exactly these two causes.
   - Source: Ch 2 §2.3: "Complexity is caused by two things: dependencies and obscurity."

2. "Deep modules (small interface, lots of functionality) are better than shallow ones." **Supported.** Depth compares the interface's complexity with the functionality. The book means a simple interface, not just a small one.
   - Source: Ch 4 §4.4: "The best modules are those that provide powerful functionality yet have simple interfaces."

3. "Ousterhout draws modules as rectangles where width is the interface and area is the functionality." **Supported, one nuance.** The top edge is the interface, and its length shows how complex the interface is. Area is the functionality. (Figure 4.1 survives only as a caption in this text.)
   - Source: Ch 4 §4.4: "The top edge of a rectangle represents the module’s interface; the length of that edge indicates the complexity of the interface."

4. "Classitis: too many small classes is a problem." **Supported, with the reason.** Classitis is the belief that more classes are better. The harm is that many small interfaces add up, not the class count itself.
   - Source: Ch 4 §4.6: "Classitis may result in classes that are individually simple, but it increases the complexity of the overall system."

5. "A one-method module split out of a big file is likely shallow and should be folded back." **Partly supported, overstated.** The book says small modules tend to be shallow (§4.5), and it folds back one-call-site, one-line logging methods (§9.6). But the test is depth and independence, not the method count: a split is fine if the child can be read without the parent (§9.7), and a module with a tiny interface can be very deep (Unix I/O, §4.4). Fold back only if it is shallow or conjoined.
   - Source: Ch 9 §9.7: "You shouldn’t break up a method unless it makes the overall system simpler"

6. "Names that differ by one letter (`ClientInvitation` vs `ClientInvitations`) are an obscurity problem." **Not addressed directly, supported by analogy.** The book has no one-letter or singular/plural example. Its closest case is `struct socket` vs `struct sock`, filed under precise names (Ch 14). It advises names "that are easy to distinguish and clarify the relationship". Ch 2 counts unclear names as obscurity.
   - Source: Ch 14 §14.3: "These names are so similar that it’s difficult to remember which is which."

7. "The same design decision checked in 43 places is information leakage." **Supported if the places span several modules.** Leakage is one decision reflected in multiple modules. Within one class it is better described as repetition and change amplification (Ch 2, §9.4). The book gives no count threshold.
   - Source: Ch 5 §5.2: "Information leakage occurs when a design decision is reflected in multiple modules."

8. "A constant deliberately copied into a migration, with a test pinning them, is a managed leak." **Not addressed; "managed leak" is our term.** By the book's definition this is still leakage (back-door leakage, §5.2): two places depend on one decision. The book accepts that some decisions cross modules and asks for documentation where developers will see it (§13.7, the Status enum comment that lists the other places). It never offers a test as a leakage remedy; tests appear only as a refactoring aid (§19.3). Call it documented leakage and require the cross-reference comment.
   - Source: Ch 13 §13.7: "real systems inevitably end up with design decisions that affect multiple classes."

9. "Moving knowledge next to the constant it depends on is information hiding." **Partly supported.** Reorganizing so one piece of knowledge affects only one class is the book's remedy for leakage. But information hiding means the knowledge lives in a module's implementation and does not appear in its interface. Putting two things in the same place does not hide anything if other modules still depend on the knowledge, and `private` alone is not hiding (§5.1).
   - Source: Ch 5 §5.2: "How can I reorganize these classes so that this particular piece of knowledge only affects a single class?"

10. "A pass-through method is a red flag." **Supported.** It is a named red flag. The book exempts dispatchers and several implementations of one interface (§7.2).
    - Source: Ch 7 §7.1: "This typically indicates that there is not a clean division of responsibility between the classes."
