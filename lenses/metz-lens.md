# Metz lens: Ruby/Rails code-change checklist

Rules from Sandi Metz, *Practical Object-Oriented Design: An Agile Primer Using Ruby* (2nd ed., 2018). Each rule is in our words, has a check you can run on a diff or with static analysis, and has a source with a verbatim quote. Section numbers are the book's. The book calls its metrics proxies to "Take them with a grain of salt" (§1.3.3) and says its rules "are meant to be broken" (Afterword). So report a hit as a question about cost of change, not as a failure. The book gives **no** numeric size limits; any thresholds below are ours to choose.

## Single responsibility

1. Each class does one cohesive thing. If its one-sentence description needs "and", it probably has two jobs; if it needs "or", the jobs are not even related.
   - Check: a class gains public methods that fall into unrelated groups (they share no instance variables or callers), or the class comment/PR description needs "and"/"or" to say what it does.
   - Source: §2.2.3 "Determining If a Class Has a Single Responsibility": "If the simplest description you can devise uses the word “and,” the class likely has more than one responsibility."

2. Methods also have a single responsibility. A common case is a method that both iterates and does the work on each element.
   - Check: a method with a multi-line block body inside `each`/`map`/`select`, or a method whose name needs "and".
   - Source: §2.3.2 "Enforce Single Responsibility Everywhere": "Methods, like classes, should have a single responsibility."

3. When a chunk of a method needs a comment, extract it into a method named for what the comment says.
   - Check: a new comment inside a method body that explains the following lines (not a TODO or a "why" note).
   - Source: §2.3.2 "Enforce Single Responsibility Everywhere": "If a bit of code inside a method needs a comment, extract that bit into a separate method."

4. Read instance variables through methods, even inside their own class.
   - Check: `@ivar` reads outside `initialize`, memoizers and accessor definitions; count added reads of the same `@ivar` across methods.
   - Source: §2.3.1 "Depend on Behavior, Not Data": "Always wrap instance variables in accessor methods instead of directly referring to variables."

5. Do not index into a raw data structure (array positions, hash keys) all over a class. Convert it to an object (Struct, value object) in one place.
   - Check: the same `[0]`/`[1]`/`[:key]`/`dig` access on one structure in two or more methods or files.
   - Source: §2.3.1 "Depend on Behavior, Not Data": "The knowledge that rims are at [0] should not be duplicated; it should be known in just one place."

6. Keep each piece of behavior in exactly one place (DRY).
   - Check: duplicate-code detection (e.g. flay) reports a new copy of existing logic, or the same conditional/formula appears in two files of the diff.
   - Source: §2.3.1 "Depend on Behavior, Not Data": "DRY code tolerates change because any change in behavior can be made by changing code in just one place."

7. Do not make design decisions before you must. If waiting costs nothing extra, wait for more information.
   - Check: a new abstraction (base class, module, config option, strategy, extension point) that has only one user or caller in the codebase.
   - Source: §2.2.4 "Determining When to Make Design Decisions": "When the future cost of doing nothing is the same as the current cost, postpone the decision."

8. Many private methods suggest the class holds more than one responsibility; consider extracting them into a new object.
   - Check: private method count of a class grows (pick a team threshold), especially a cluster of private methods that use the same arguments but not the class's own state.
   - Source: §9.3.2 "Removing Private Methods from the Class under Test": "An object with many private methods exudes the design smell of having too many responsibilities."

## Managing dependencies

1. Inject collaborators instead of naming their classes inside methods. A class should depend on a message, not on another class.
   - Check: `SomeAppClass.new` or other app constants referenced inside method bodies (not in `initialize` defaults or a factory); number of distinct app constants a class references.
   - Source: §3.2.1 "Inject Dependencies": "Referring to another class by its name creates a major sticky spot."

2. If you cannot inject a dependency, isolate it: create the object in one place (`initialize` or one memoized method) so it is visible and easy to remove later.
   - Check: the same `Constant.new(...)` or the same external call in two or more methods of one class.
   - Source: §3.2.2 "Isolate Dependencies": "if you cannot remove unnecessary dependencies, you should isolate them within your class."

3. Wrap a message to another object that is likely to change in a method of its own, rather than burying it inside complex logic.
   - Check: `collaborator.some_method` appears inside a long or high-complexity method, or in several methods of the same class.
   - Source: §3.2.2 "Isolate Dependencies": "it’s worth examining your code, looking for and wrapping the most vulnerable dependencies."

4. Prefer keyword arguments over positional ones, so callers do not depend on argument order.
   - Check: a new or changed method (especially `initialize`) with two or more positional parameters; a diff that reorders positional parameters.
   - Source: §3.2.3 "Remove Argument-Order Dependencies": "your bias should be toward declaring arguments using keywords."

5. Changing how many arguments a method needs breaks every caller.
   - Check: a public method's required parameter count changes; verify all call sites changed in the same diff.
   - Source: §2.2.1 "An Example Application: Bicycles and Gears": "Altering the number of arguments that a method requires breaks all existing callers of the method."

6. Wrap third-party interfaces you do not own (especially ones with positional arguments) in one method or module you do own.
   - Check: the same gem/framework constructor or API call appears directly in several app files.
   - Source: §3.2.3 "Remove Argument-Order Dependencies": "The classes in your application should depend on code that you own; use a wrapping method to isolate external dependencies."

7. Depend on things that change less often than you do. A concrete, often-changed class with many dependents is the danger zone.
   - Check: the diff adds a dependency on a class with high churn (git log) and many inbound references (afferent coupling), or adds churn to such a class.
   - Source: §3.3.2 "Choosing Dependency Direction": "When a concrete class has many dependents, your alarm bells should be ringing."

## Flexible interfaces and messages

1. Decide which methods are public and make the private ones obviously private.
   - Check: a new class with no `private` section, or helper methods left public that no other object calls.
   - Source: §4.4.1 "Create Explicit Interfaces": "Every time you create a class, declare its interfaces."

2. Ask a collaborator for what you want; do not tell it how to do it step by step.
   - Check: a method sends three or more messages in a row to the same collaborator to drive a procedure (`m.clean; m.pump; m.lube`), or a caller must change when the receiver adds a step.
   - Source: §4.4.4 "Minimize Context": "create public methods that allow senders to get what they want without knowing how your class implements its behavior."

3. Keep public interfaces small. Every public method is a promise others will depend on.
   - Check: number of public methods added to a class; public methods with a single caller that could be private.
   - Source: §4.3.4 "Asking for “What” Instead of Telling “How”": "having a small public interface means that there are few methods for others to depend on."

4. Do not depend on another class's private methods; if you must, isolate that use in one place.
   - Check: `send(:private_method)`, `__send__`, `instance_variable_get`/`instance_variable_set` on another object in app code, or calls into a gem's undocumented internals.
   - Source: §4.4.2 "Honor the Public Interfaces of Others": "A dependency on a private method of an external framework is a form of technical debt."

5. Do not reach through one object to get to another of a different type (Law of Demeter). Chains through objects of the same type (e.g. Enumerable chains) are fine; chains that change a distant object are the worst.
   - Check: message chains such as `a.b.c.d` where the intermediate objects are different app classes, especially when the chain ends in a write or command.
   - Source: §4.5.1 "Defining Demeter": "it prohibits routing a message to a third object via a second object of a different type"

6. Adding delegation to hide a chain does not remove the coupling; find the message the sender actually wants.
   - Check: new `delegate ... to:` or `def_delegators` lines whose only purpose is to shorten an existing chain.
   - Source: §4.5.3 "Avoiding Violations": "delegation to hide tight coupling is not the same as decoupling the code."

7. Do not force behavior into the obvious domain objects (models). Rules that span several objects may need a new object that owns them.
   - Check: a model gains a method whose logic is mostly about two or more other models (e.g. a `Customer` method that queries trips and bikes).
   - Source: §4.3.2 "Constructing an Intention": "If you fixate on domain objects, you will tend to coerce behavior into them."

## Duck typing

1. Branching on another object's class means a duck type is missing. Send one message and let each class implement it.
   - Check: `case obj when SomeAppClass`, `is_a?`, `kind_of?`, `instance_of?` or `respond_to?` on objects of app classes, followed by different messages per branch.
   - Source: §5.2.2 "Placing Trust in Your Ducks": "Use of kind_of?, is_a?, responds_to?, and case statements that switch on your classes indicate the presence of an unidentified duck."

2. Checking the class of stable core classes (`Array`, `NilClass`, `String`) is much lower risk than checking your own classes.
   - Check: lower severity for rule 1 hits where every checked class is a Ruby or framework core class.
   - Source: §5.2.5 "Choosing Your Ducks Wisely": "it is depending on core Ruby classes that are far more stable than it is."

3. A duck type must be documented and tested, because no single place in the code defines it.
   - Check: a message implemented by two or more unrelated classes for polymorphic use, with no shared test (shared example/module) asserting each implements it.
   - Source: §5.2.3 "Documenting Duck Types": "When you create duck types, you must both document and test their public interfaces."

4. Monkey patching Ruby base classes to create a duck type needs a strong, explicit justification.
   - Check: reopened core classes (`class String`, `class Hash`), `core_ext` files or refinements added in the diff.
   - Source: §5.2.5 "Choosing Your Ducks Wisely": "you must be able to eloquently defend this design decision. The standard of proof is high."

5. Do not bolt static type checking onto Ruby code; class checks undermine duck typing.
   - Check: new guard clauses that raise unless an argument `is_a?` some class. (The book predates Sorbet/RBS adoption; treat as the book's position, not a ban on type tooling.)
   - Source: §5.3.3 "Embracing Dynamic Typing": "If your problem needs static typing, pick a language that enforces it; don’t try to add static typing to Ruby."

## Inheritance

1. An `if`/`case` on an attribute like `type`, `style`, `kind` or `category` of `self` to choose behavior is a missing subclass.
   - Check: branches on `self`'s own type-like attribute or Rails enum (`if style == :road`, `case kind`) that pick different behavior; count of such branches across methods.
   - Source: §6.2.2 "Embedding Multiple Types": "here the pattern indicates a missing subtype, better known as a subclass."

2. Do not create an abstract superclass for one subclass. Wait for more concrete cases (three is best) unless the duplication is costly.
   - Check: a new base class, STI parent or abstract model with exactly one subclass.
   - Source: §6.4.1 "Creating an Abstract Superclass": "It almost never makes sense to create an abstract superclass with only one subclass."

3. Build a hierarchy by pushing code down and promoting the shared parts up, not by leaving concrete code in the superclass.
   - Check: a new subclass of a class that is also instantiated directly elsewhere (a concrete parent), or superclass code that only some subclasses use.
   - Source: §6.4.2 "Promoting Abstract Behavior": "arrange code so that you can promote abstractions rather than demote concretions."

4. Everything in a superclass must apply to every subclass.
   - Check: superclass methods that are overridden to do nothing, or used by only some subclasses.
   - Source: §7.2.2 "Insist on the Abstraction": "Superclasses should not contain code that applies to some, but not all, subclasses."

5. A subclass that overrides a method to say "I don't do that" is close to saying it is not that kind of thing.
   - Check: a subclass method whose body is only `raise NotImplementedError`/`raise "not supported"` or an empty override of a parent method.
   - Source: §7.2.2 "Insist on the Abstraction": "they come perilously close to declaring that they are not that thing."

6. A superclass (template method) must implement every message it sends to subclasses, at least by raising a clear error.
   - Check: a base class or concern calls a method it does not define itself.
   - Source: §6.4.5 "Implementing Every Template Method": "Any class that uses the template method pattern must supply an implementation for every message it sends"

7. Subclasses must be substitutable for their superclass (Liskov): same messages, same kinds of inputs and outputs.
   - Check: an override that changes arity or return type, or callers that check which subclass they hold.
   - Source: §7.2.3 "Honor the Contract": "They are not permitted to do anything that forces others to check their type in order to know how to treat them"

8. Do not make subclasses call `super` to take part in the algorithm; have the superclass send hook messages instead.
   - Check: subclass overrides of `initialize` or other parent methods that must call `super` to work (count `super` calls added in subclasses).
   - Source: §7.2.5 "Preemptively Decouple Classes": "Avoid writing code that requires its inheritors to send super; instead use hook messages"

9. Keep hierarchies shallow.
   - Check: inheritance depth below the app base class (e.g. below `ApplicationRecord`) greater than one, or a new level added to an existing hierarchy.
   - Source: §7.2.6 "Create Shallow Hierarchies": "Deep, wide hierarchies are difficult to understand, costly to maintain, and should be avoided."

## Roles and modules

1. When unrelated classes play the same role and share behavior, put that behavior in a module rather than copying it.
   - Check: the same method bodies duplicated across unrelated classes; or a concern added that is included in only one class.
   - Source: §8.5.3 "Choosing Relationships": "Define the common behavior in a Ruby module to allow objects to play the role without duplicating the code."

2. Code in a module must apply to everything that includes it.
   - Check: a concern that branches on the including class, or methods in it that only some includers use.
   - Source: §7.2.2 "Insist on the Abstraction": "The code in a module must apply to all who use it."

3. A module must implement every message it sends (a default or a raising stub), just like a superclass.
   - Check: a module/concern calls a method that neither it nor every includer defines.
   - Source: §7.1.5 "Extracting the Abstraction": "If a module sends a message, it must provide an implementation, even if that implementation merely raises an error"

4. Objects should answer questions about themselves. Do not make callers ask a third party (a util, helper or service) about an object.
   - Check: new `SomethingUtils.foo?(obj)`/`Helper.check(obj)` calls, or a service method that takes an object only to inspect its data.
   - Source: §7.1.3 "Removing Unnecessary Dependencies": "objects should manage themselves; they should contain their own behavior."

5. A value chosen by checking class names belongs in those classes, exposed as a message.
   - Check: a hash or `case` keyed on class names that returns constants (e.g. lead times, labels, limits).
   - Source: §7.1.2 "Organizing Responsibilities": "This knowledge doesn’t belong in Schedule, it belongs in the classes whose names Schedule is checking."

6. Stacking modules on modules and deep hierarchies makes behavior very hard to follow.
   - Check: number of modules/concerns included per class, modules that include other modules, or modules overriding other modules' methods.
   - Source: §7.1.7 "Inheriting Role Behavior": "You can write code that is impossible to understand, debug, or extend."

## Composition

1. Prefer composition. Use inheritance only when you can defend it as better.
   - Check: a new `class X < Y` (other than framework bases like `ApplicationRecord`) where `X` could hold a `Y` instead; ask for the is-a argument.
   - Source: §8.5 "Deciding between Inheritance and Composition": "If you cannot explicitly defend inheritance as a better solution, use composition."

2. Choose by relationship: is-a suggests inheritance, behaves-like-a suggests a duck type/module, has-a suggests composition.
   - Check: classify each new inheritance, include and has-a relationship in the diff and flag mismatches.
   - Source: §8.5.3 "Choosing Relationships": "This is-a versus has-a distinction is at the core of deciding between inheritance and composition."

3. Do not subclass `Array`/`Hash` to make a collection object. Hold the collection, delegate the few messages you need and include `Enumerable`.
   - Check: `class X < Array`, `< Hash` or `< String` in app code.
   - Source: §8.2.2 "Making the Parts Object More Like an Array": "This version of Parts does not have all of the behavior of Array, but at least everything that it claims to do actually works."

4. Keep the knowledge of how to build a family of objects in one factory, and always build them through it.
   - Check: the same set of objects or the same config-to-object conversion constructed in several places.
   - Source: §8.3.1 "Creating the PartsFactory": "once you commit to keeping config in an array, you should always create new Parts objects using the factory."

5. Do not require users of shared code (an engine, gem or internal library) to subclass your classes to get behavior.
   - Check: a new library-style API whose documented use is `class MyThing < YourBase`.
   - Source: §8.5.1 "Accepting the Consequences of Inheritance": "Avoid writing frameworks that require users of your code to subclass your objects in order to gain your behavior."

## Testing

1. Test incoming (public) messages by asserting on what they return.
   - Check: a new public method with no test that asserts its result.
   - Source: §9.1.2 "Knowing What to Test": "Incoming messages should be tested for the state they return."

2. Test outgoing command messages (side effects: writes, mail, jobs, API calls) by asserting they are sent, with a mock.
   - Check: a new side-effecting call (`deliver_later`, `perform_later`, an HTTP client call, a write to another object) with no expectation that it is sent.
   - Source: §9.1.2 "Knowing What to Test": "Outgoing command messages should be tested to ensure they get sent."

3. Do not test outgoing query messages; the receiver's own tests cover them.
   - Check: tests that set expectations on a collaborator's side-effect-free method, or assert on a collaborator's return value instead of the object under test's.
   - Source: §9.1.2 "Knowing What to Test": "Outgoing query messages should not be tested."

4. Be biased against testing private methods.
   - Check: specs that call `send(:private_method)` or otherwise reach private methods.
   - Source: §9.3.1 "Ignoring Private Methods during Tests": "Testing private methods is never necessary."

5. A public method nobody calls should be deleted, not tested.
   - Check: a new public method whose only callers are its own tests.
   - Source: §9.2.1 "Deleting Unused Interfaces": "Do not test an incoming message that has no dependents; delete it."

6. Painful test setup points to a design problem in the code under test.
   - Check: spec setup that builds many unrelated records/objects for one unit test, or a unit test that must stub many collaborators.
   - Source: §9.1.1 "Knowing Your Intentions": "If a test requires painful setup, the code expects too much context."

7. Test doubles must be checked against the role they play, or tests can pass while the application is broken.
   - Check: a hand-rolled double or non-verifying `double(...)` for a role, with no shared role test run against it.
   - Source: §9.5.2 "Using Role Tests to Validate Doubles": "When you treat test doubles as you would any other role player and test them to prove their correctness, you avoid test brittleness"

8. Every class in a hierarchy (and every includer of a role module) should run one shared test of the common interface.
   - Check: a new subclass or includer whose spec does not include the existing shared examples/test module for its parent or role.
   - Source: §9.6.1 "Specifying the Inherited Interface": "write a shared test for the common contract and include this test in every object."

9. Subclass tests cover only the subclass's own specializations and should not know about the superclass's algorithm.
   - Check: a subclass spec that asserts on inherited methods already covered by the shared test (e.g. tests `spares` instead of `local_spares`).
   - Source: §9.6 "Testing Inherited Code": "Be especially careful when testing subclass specializations to prevent knowledge of the superclass from leaking down into the subclass’s test."

## Other

1. Do not build for specific future requirements you are guessing at.
   - Check: parameters, options, hooks or branches added that no current caller uses.
   - Source: §1.1.3 "A Practical Definition of Design": "Designs that anticipate specific future requirements almost always end badly."

2. While designing, treat a message send as free; do not avoid an extraction for speed without a measurement.
   - Check: review comments or code that inline logic "for performance" with no benchmark.
   - Source: §2.3.2 "Enforce Single Responsibility Everywhere": "you should act as if sending a message is free."

3. When you cannot fix legacy code fully, leave it better than you found it.
   - Check: a diff that adds to a known problem in a file (another class-name branch, another positional argument) instead of isolating it.
   - Source: §3.2.2 "Isolate Dependencies": "your goals should switch to improving the overall situation by leaving the code better than you found it."

## Claims to correct

1. "Metz's limits: 100 lines per class, 5 lines per method, 4 parameters." **The book does not address this.** There are no numeric limits anywhere in POODR (2nd ed.); we found no "100 lines", "five lines" or parameter-count rule. The book asks for classes that do "the smallest possible useful thing" (§2.2), praises small methods (§2.3.2) and prefers keyword arguments (§3.2.3), but treats metrics as proxies: "Take them with a grain of salt" (§1.3.3). The numbers must come from elsewhere (likely her talks), so do not cite POODR for them.

2. "Duplication is far cheaper than the wrong abstraction." **The book does not contain this phrase; it supports a narrower form of the idea.** §6.4.1 says that before a hierarchy, "If a third bike is imminent, it may be best to duplicate the code and wait for better information", and that waiting for three cases improves the odds of the right abstraction (§6.6). But the book also calls duplication "a terrible idea" (§2.2.2) and says "if the duplicated code would need to change every day, it may be cheaper to go ahead and create the hierarchy" (§6.4.1). It is a cost trade-off, not a rule that duplication is cheaper. Cite a different source for the slogan.

3. "Inheritance is the tightest coupling; a base class gaining methods all subclasses inherit is a concern." **Partly supported.** The book never says "tightest", but it says "Composition contains far fewer built-in dependencies than inheritance" (§8.5) and that subclasses "are bound, irrevocably and by design, to the classes above them in the hierarchy" (§8.5.1), so changes near the top of a wrong hierarchy are very costly. The concern is narrower than any new base-class method: in a correct hierarchy that leverage is a benefit (§8.5.1). The concern is base-class code that does not apply to every subclass: "Superclasses should not contain code that applies to some, but not all, subclasses" (§7.2.2).

4. "A boolean/flag argument usually means one thing doing two jobs." **The book does not address flag arguments.** The nearest point is an attribute that holds the object's own category (`style`, `type`): branching on it means a missing subclass and "Bicycle now has more than one responsibility" (§6.2.2, §7.2.1). That is about an attribute of `self`, not a boolean parameter. Keep the flag-argument rule if you want it, but do not attribute it to POODR.

5. "Sequence diagrams help decide which object should own a message." **Supported.** §4.3.3 says drawing one prompts the question "“Should this receiver be responsible for responding to this message?”" and turns design into "deciding on a message and figuring out where to send it." The book treats them as throwaway whiteboard tools (§4.3.3, §4.3.8), not documents to keep.

6. "Ask for what instead of telling how." **Supported, nearly verbatim.** §4.3.4 is titled "Asking for “What” Instead of Telling “How”", and the summary says messages should "ask for what the sender wants instead of telling the receiver how to behave" (§4.6).

7. "One object owning a responsibility that was duplicated in several places, with drift, is good design." **Supported.** DRY is defined as behavior living "in one and only one place" so change happens "in just one place" (§2.3.1); the PartsFactory refactoring ends with "Line 13 above is now the only place in the application that defaults needs_spare to true" (§8.3.2); and lead time moves into the object that "could possibly know the correct answer" (§7.1.3). "Drift" is our word; the book uses it only for subclasses "drifting away from the standard" (§9.6.1).

8. "A class naming many collaborator classes directly is a dependency concern." **Supported.** Knowing "The name of another class" is the first kind of dependency listed (§3.1.1), and "An application whose classes are sprinkled with entangled and obscure class name references is unwieldy and inflexible" (§3.2.2). §5.1.2 flags a method that "refers to three different classes by name". Exception: references to stable Ruby base classes are safe (§3.3.2), and a factory's job is to know class names (§3.2.3, §8.3.1).
