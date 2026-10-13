# Copeland lens: Rails code-change checklist

Rules from David Bryant Copeland, *Sustainable Web Development with Ruby on Rails* (2020). Each rule is stated in our words, has a check you can run on a diff, and has a source with a verbatim quote. Section numbers are the book's. The book says its rules are guidelines and that breaking one is fine "as long as you have a good reason" (Ch 7 intro). So report a hit as a question to answer, not as a failure.

## Business logic

1. Keep business logic out of Active Records. Put each piece of logic in its own class under `app/` (the book uses `app/services`).
   - Check: the diff adds methods to an `ApplicationRecord` subclass that branch on domain rules, send mail, queue jobs, call third parties or write other records.
   - Source: Ch 5 "Business Logic (Does Not Go in Active Records)": "do not put business logic in Active Records. Instead, put each bit of logic in its own class"

2. A service is a stateless class with a specific noun name (`WidgetsCreator`) and a specific verb method (`create_widget`). It is the seam between Rails-managed code and domain logic.
   - Check: a new service has a vague class name (`Manager`, `Handler`, `Helper`) or method name, or it stores per-call data in instance variables that persist between calls.
   - Source: Ch 15 intro: "have a stateless class named for the specific process or use case it implements, a single method that accepts the parameters needed"

3. Call services through an instance (`.new.do_thing`). Do not use class methods or a singleton.
   - Check: a new `def self.<verb>` in `app/services`, or a `self.instance` singleton.
   - Source: §15.3.1 "Creating Class Methods Closes Doors": "It saves a few keystrokes, but it prevents you from encapsulating state later if that should be required."

4. Do not name the entry method generically (`call`, `execute`, `run`) or pass all inputs to the constructor (the command pattern). Use the command pattern only when execution really is deferred.
   - Check: a public `call` or `execute` method in `app/services`, or a `Foo.new(args).call` call site.
   - Source: §15.3.2 "Using a Generic Method Name Like call Obscures Behavior": "If you use the command pattern in a situation where you don’t need to defer execution, you can obscure behavior."

5. Pass the data being operated on as method arguments. Refer to Rails classes and fixed collaborators directly. Inject a collaborator through the constructor only when the caller really must choose it.
   - Check: new constructor keywords for things that have only one implementation (a model class, a "repository", a fixed API client).
   - Source: §15.2.2 "Methods Receive Context and Data on Which to Operate, not Services to Delegate To": "Making all dependencies generic and injectable belies the way the logic will actually work."

6. When the caller needs to know what happened, return a rich result object (an inner `Result` class). Do not return a boolean or an Active Record.
   - Check: a service's public method returns `true`/`false`, or returns a saved record that callers inspect with `valid?` or `persisted?`.
   - Source: §15.2.3 "Return Rich Result Objects, not Booleans or Active Records": "Do not use an Active Record for this purpose. Active Records are for database access"

7. Each service gets its own result class with specific past-tense predicates (`created?`), not generic ones (`success?`). Do not build a shared Result library up front.
   - Check: a predicate named `success?`, `ok?` or `succeeded?`, or a new shared `Result` base class or gem.
   - Source: §15.2.3: "Result objects should not be generic." ... "we used a specific past-tense verb—created?—and not something generic like succeeded?"

8. Return nothing if no caller needs a result. You can add one later.
   - Check: a new `Result` that no call site reads.
   - Source: §15.2.3: "Note that you should not create any sort of return value if one isn’t needed."

9. Business logic code must make its behavior obvious. Do not trade clarity for being "OO", "clean", reusable or pattern-based.
   - Check: metaprogramming (`send`, `define_method`, `method_missing`) or generic abstraction layers added in `app/services`.
   - Source: §15.1 "Business Logic Code Must Reveal Behavior": "the code must be behavior-revealing (as opposed to intention-revealing)"

## Controllers

1. Treat controller code as configuration. It reads the input, calls the business logic, and routes the user based on the result. It holds no business logic.
   - Check: an action branches on domain rules (rather than on a result predicate), sends mail, queues jobs, calls a third party, or writes several records. The book gives no line limit, so pick a team threshold.
   - Source: §18.1 "Controller Code is Configuration": "This prevents me from putting business logic in the controllers themselves"

2. Do not use `before_action` callbacks to load records or remove small duplication. Use explicit private methods. Callbacks are fine for cross-cutting concerns such as authentication, authorization and `rescue_from`.
   - Check: a new `before_action :set_<thing>` (often with `only:`) in one controller.
   - Source: §18.2 "Don’t Over-use Callbacks": "As a mechanism for managing duplication, callbacks just aren’t the right tool: private methods will always be easier to manage and understand."

3. Controllers turn string parameters into properly typed objects before calling business logic: look up records with `find`, convert money to cents, parse dates for Active Models. The conversion can live in a small class, but the controller must make sure it happens.
   - Check: a service receives `params` or `ActionController::Parameters`, or parses strings from HTTP input itself.
   - Source: §18.3 "Controllers Should Convert Parameters to Richer Types": "controllers are responsible for converting parameters into properly typed objects"

4. Use strong parameters and Rails validations rather than rebuilding them inside the service.
   - Check: `params` passed to a model or service without `require` and `permit`.
   - Source: §5.4 "Example Design of a Feature": "There’s a huge benefit to using strong parameters and Rails’ validations. So we do!"

5. Each action exposes exactly one instance variable, named after the route's resource. The only exceptions are reference data (`@country_codes`) and authentication data, which may come from a helper.
   - Check: an action sets more than one instance variable that is not reference data, or the variable's name does not match the resource.
   - Source: §7.2 "Ideally, Expose One Instance Variable Per Action": "Expose exactly one instance variable from any given action, ideally named for the resource or resources being manipulated"

6. Do not force controllers into a more object-oriented shape. Write them the plain Rails way.
   - Check: a new controller base-class framework, a controller DSL, or controllers that build their own service objects for routing.
   - Source: §18.1: "do not try to bend controller code into more traditional object-oriented structures"

## Routes

1. Declare every route with `resources`, so it gets the conventional actions and URL helpers. Do not hand-write `get` or `post` routes for canonical URLs.
   - Check: a new `get`, `post`, `patch` or `delete` line outside the documented custom-routes block in `config/routes.rb`, or a URL built by string interpolation in a view.
   - Source: §6.1 "Always Use Canonical Routes that Conform to Rails’ Defaults": "There’s just no benefit to hand-crafting routes like this."

2. Never configure a route you do not use. Always list actions with `only:`, never with `except:`.
   - Check: `resources` without `only:`, any `except:`, or a listed action with no matching controller method.
   - Source: §6.2 "Never Configure Routes That Aren’t Being Used": "I would advise sticking with :only because it’s much simpler to provide the correct value."

3. Vanity URLs are extra routes on top of a canonical route. They go in a commented custom-routes section, preferably as a `redirect`, with a comment saying why each one exists.
   - Check: a human-friendly route with no canonical `resources` route, or with no comment explaining it.
   - Source: §6.3 "Vanity URLs Should Redirect to a Canonical Route": "every single route in the application has a canonical route, consistent with Rails’ conventions"

4. Do not add custom actions. Model the action as a new resource that uses the standard actions (for example `widget_ratings#create`, not `widgets#update_rating`).
   - Check: `member do`, `collection do` or a named verb route inside `resources`, or a public controller method outside the seven standard actions.
   - Source: §6.4 "Don’t Create Custom Actions, Create More Resources": "Rails works best when you are resource-focused, not action-focused."

5. Be wary of nested routes. Nest only when the child truly cannot exist without the parent, and never nest more than one level deep.
   - Check: nesting depth greater than 1, or a nested resource that is also reached elsewhere through a second route.
   - Source: §6.5.1 "Create Sub-Resources Judiciously": "making ratings its own resource (as we did initially) is the safer bet"

6. Use a namespace only to separate a genuinely different UI for the same resource, never for looks. Many namespaces suggest the app is doing too much.
   - Check: a new `namespace` block (count them).
   - Source: §6.5.2 "Namespacing Might be an Architecture Smell": "It should not be used for aesthetic reasons."

## Views and helpers

1. Mark content up with semantic HTML tags first. Use `<div>` and `<span>` only for layout and styling.
   - Check: new content-bearing `div`s or `span`s where a semantic tag fits (headings, lists, `aside`, `nav`), or `<code>` used for something that is not code.
   - Source: §7.1 "Use Semantic HTML": "Do not choose HTML tags based on their appearance or other layout characteristics."

2. Use partials only for reusable components, not to split up one long template.
   - Check: a new partial rendered from exactly one template.
   - Source: §7.3.2 "Use Partials for Reusable Components Only": "By using partials only for reusable components, it’s easy for everyone to decide when to use a partial"

3. Partials take their inputs as locals, never instance variables. Read optional locals with `local_assigns`, and document every local in a comment at the top of the partial.
   - Check: an `@ivar` inside a `_*.html.erb` file, or a new or changed partial with no header comment listing its locals.
   - Source: §7.3.3 "Use Locals to Pass Parameters to Partials": "partials should be given explicit parameters and not rely on implicitly-set instance variables"

4. Do not use layouts for reusable components. Keep layouts for global concerns.
   - Check: new conditional `content_for` or `yield` slots added to a layout.
   - Source: §7.3.1 "Don’t Use Layouts for Re-usable Components": "it shouldn’t be your go-to tool for re-use"

5. Just use ERB.
   - Check: new `.haml` or `.slim` templates, or new gems for them.
   - Source: §7.4 "Just Use ERB": "I don’t believe the benefits assigned to these technologies outweigh the downsides"

6. Derived values that users treat as domain concepts (such as a formatted ID) belong on the resource or model, not in a helper. Only purely presentational formatting is a view concern.
   - Check: a helper that formats a domain identifier or value used across many views.
   - Source: §8.1 "Don’t Conflate Helpers with Your Domain": "this convention is overly simplistic and ends up pushing too many actual domain concepts out of the domain"

7. Helpers are for markup and formatting: wrapping complex partials in a method, and small inline components.
   - Check: a helper that queries the database, applies business rules, or builds more than a small component.
   - Source: §8.2 "Helpers Are Best At Markup and Formatting": "Concentrate helpers on what they do best: producing inline markup and rendering complex partials."

8. Prefer helpers to presenters or decorators. If the team does use presenters, use one technique only, and name the variable after its real class (`@widget_presenter`, never `@widget`).
   - Check: a second presenter or decorator library, or `@widget = WidgetPresenter.new(...)`.
   - Source: §8.3.3 "Taming Problems with Presenters": "name objects based on their actual class and do not pretend presenters are actually domain objects"

9. Build markup with Rails APIs (`content_tag` and the form helpers), never by string interpolation. Any `html_safe` needs a comment saying why it is safe.
   - Check: string interpolation or concatenation of HTML in a helper, or `html_safe` or `raw` with no explaining comment.
   - Source: §8.4 "Use Rails’ APIs to Generate Markup": "never build strings using interpolation or concatenation"

## Models

1. Active Records contain only three things: configuration (associations, validations), class methods for database operations reused in several places, and instance methods for domain concepts that come straight from the stored data.
   - Check: any other kind of method added to an Active Record.
   - Source: §13.1 "Active Record is for Database Access": "when you place business logic elsewhere, you don’t end up needing much code in your Active Records"

2. Declare the inverse side of every relationship (`has_many` or `has_one`). If an inverse is deliberately left out, add a comment saying why.
   - Check: a new `belongs_to` with no matching `has_many` or `has_one` on the other model, and no comment.
   - Source: §13.1.2 "Model the Database With Active Record’s DSL": "If you do nothing, no one will know the intention."

3. Add only the validations and configuration that a real code path needs.
   - Check: a validation on an attribute that no form or service ever sets.
   - Source: §13.1.2: "what purpose could a presence validation on that field possibly serve?"

4. Add a query class method only when the same query is needed in more than one place and it is pure data access. Queries that encode business rules (time windows, thresholds, "recently approved") belong in the service layer.
   - Check: a new class method or scope used in only one place, or one that contains business literals such as `10.days.ago`.
   - Source: §13.1.3 "Class Methods Should Be Used to Re-use Common Database Operations": "The 10.days.ago is certainly business logic"

5. Do not use `scope`. Call `where`, `order` and `limit` directly where they are needed, and extract on the third repeat. A business-meaning query can become its own service (`FreshWidgetLocator`).
   - Check: a new `scope` declaration, or a query extracted before it is used three times.
   - Source: §16.4 "Scopes are Often Business Logic and Belong Elsewhere": "you should use where, order, limit and friends as needed to implement your business logic"

6. Barely use callbacks. Use them only to normalize data in `before_validation` or to track database activity for operations.
   - Check: a new `after_save`, `after_create` or `after_commit` that sends mail, queues jobs or changes other records.
   - Source: §16.3 "How to (Barely) Use Callbacks": "callbacks simply aren’t needed very often"

7. Validations improve the user experience but cannot guarantee data integrity. Enforce integrity in the database with NOT NULL, foreign keys, unique indexes and check constraints.
   - Check: `validates ... uniqueness` with no unique index, `presence` with no NOT NULL, or `belongs_to` with no foreign key in the migration.
   - Source: §16.1 "Validations Don’t Provide Data Integrity": "The only tool that can ensure data integrity is the database itself."

8. Model non-database resources with Active Model (`include ActiveModel::Model`) instead of third-party record-like gems.
   - Check: a new form-object, virtus-style or decorator gem used to make a record-like class.
   - Source: §13.2 "Active Model is for Resource Modeling": "you should not have much need for third party gems to create record-like classes"

## Jobs

1. Use background jobs only when needed: always for calls to third parties, and otherwise only once measured performance is poor.
   - Check: a new job wrapping fast in-process logic, or a third-party HTTP call made inside a request.
   - Source: §19.1.4 "Use Background Jobs Only When Needed": "always communicate with third parties in a background job, because even at tiny scale, those communications will fail"

2. Pass jobs simple, JSON-safe arguments, usually database IDs, not objects. (The book also says to skip Active Job and use the backend directly. In a Solid Queue and Active Job app, apply the arguments half of the rule.)
   - Check: `perform_later(record)` or `perform_async(record)`, or hashes with symbol keys passed as job arguments.
   - Source: §19.4.1 "Do Not Use Active Job - Use the Job Backend Directly": "your arguments should almost always be basic types, in particular database identifiers for Active Records"

3. A job looks up its records from the IDs it was given and then hands off to a service method. It holds no business logic.
   - Check: a `perform` with conditionals, mail sends or multi-step logic beyond `find` plus one service call.
   - Source: §19.4.2 "Job Code Should Defer to Your Service Layer": "our job should locate the widget. After that, it should defer to another class that implements the business logic"

4. Jobs will be retried, so the code they run must be idempotent. Walk through each line and ask what a retry or a late retry would do. Splitting a job, or passing values instead of re-reading data that may have changed, can help.
   - Check: a job whose side effects (mail, charges, inserts) would repeat on retry with no guard, or that re-reads mutable state it depends on.
   - Source: §19.6 "Jobs Will Get Retried and Must Be Idempotent": "code executed from a job must be idempotent: it must not have its effect felt more than once"

## Testing

1. Write a system test for every major user flow, and unit tests for everything else that matters. Tests have a carrying cost, so test as little as gives you confidence.
   - Check: a new major flow with no system test, or new tests that repeat coverage that already exists.
   - Source: §12.1 "Understand the Value and Cost of Tests": "have a system test for every major user flow, use unit tests to get coverage of anything else that is important"

2. Run system tests with `:rack_test` unless the feature needs JavaScript. Use a real browser only when it does.
   - Check: a system test for a flow without JavaScript that is driven by Selenium or Chrome.
   - Source: §12.2 "Use :rack_test for non-JavaScript User Flows": "we can test these features without using a real web browser"

3. Assert on the fewest indicators that show the feature works. Use case-insensitive regexes for copy, and add `data-testid` once markup becomes unstable.
   - Check: system tests asserting full exact copy strings or deep markup structure.
   - Source: §12.1: "You should not assert every piece of content and markup on the page."

4. The service's test is where the business process is specified. Do not repeat that coverage in model, controller or job tests.
   - Check: model tests for simple validations, or controller tests that repeat service branches.
   - Source: §5.4: "the test of this class will almost totally specify the business process in one place"

5. Write a controller test only for controller-specific logic such as parameter conversion. Post parameters as strings, and wrap setup assertions in a `confidence_check`.
   - Check: a controller test that only re-checks redirects or flows already covered by a system test, or that posts non-string values.
   - Source: §18.4.3 "Avoiding Duplicative Tests": "These exact flows are covered by our system test."

6. Do not test thin jobs or rake tasks that only call one method.
   - Check: a new test whose only assertion is that a job or task called a service.
   - Source: §19.5 "Job Testing Strategies": "I find a test that the job simply calls a method to have low value and high carrying cost"

7. Model tests cover database constraints (written with `update_column`) and complex validations and callbacks. Give every model a Factory Bot factory that builds valid instances.
   - Check: a new check constraint with no test, or a new model with no factory.
   - Source: §16.5 "Model Testing Strategy": "There should be an easy ability to produce reliable and realistic test instances of the model."

8. Test helpers: render every variant, assert the output is HTML-safe, and match key content with a regex rather than exact markup.
   - Check: a new helper with no test, or a helper test that asserts exact HTML strings.
   - Source: §8.5 "Helpers Should Be Tested and Thus Testable": "ensures that the string returned is HTML-safe"

9. Test access controls with system tests that act as different kinds of user.
   - Check: an authorization or policy change with no system test for an allowed and a denied role.
   - Source: §21.3 "Test Access Controls In System Tests": "The clearest way to do this is to write system tests that exercise the system as different types of users."

## Other (mailers, rake tasks, authorization, database, APIs)

1. Mailers only format email from the data they are given. The decision to send belongs in business logic. If an email needs complex rendering logic, it is probably two emails.
   - Check: conditionals or queries inside mailer methods.
   - Source: §20.1.1 "Mailers Should Just Format Emails": "The purpose of a mailer is to render an email based on data passed into it. That’s it."

2. Send mail with `deliver_later`, and keep mailer arguments to Active Records or simple values that serialize correctly.
   - Check: `deliver_now` in request code, or non-record objects (dates, structs) passed as mailer arguments.
   - Source: §20.1.2 "Mailers are Usually Jobs": "It’s a typically better practice to call deliver_later"

3. Rake tasks automate things. Put one task in each file, make the directories match the namespaces, always give a `desc`, and make the task body about one line that calls a service.
   - Check: several tasks in one `.rake` file, a namespace that does not match the path, no `desc`, or logic in the task body.
   - Source: §20.2.3 "Rake Tasks Should Not Contain Business Logic": "Your Rake tasks should ideally be one line of code to trigger some business logic."

4. Keep authorization checks separate from data lookup, and keep the authorization rules plain and readable without an internal DSL. (In this app that means Action Policy policies.)
   - Check: a helper that both loads and authorizes a record, or metaprogramming in policy classes.
   - Source: §21.2.3 "You Don’t Have to Use All of Cancancan’s Features": "Intermixing authorization with data access like this will be confusing and won’t provide strong benefits."

5. Enforce stable or critical requirements in the database with check constraints. Use lookup tables backed by a foreign key for value lists that change.
   - Check: a migration adding a rule-bearing column with no constraint, or a lookup table with no foreign key.
   - Source: §14.3.4 "Planning the Physical Model": "Any stable requirement should be implemented as a check constraint."

6. Use precise column types: `boolean` for booleans, cents or `DECIMAL` for money (never `FLOAT`), `DATE` for dates, and timestamps with time zone.
   - Check: a migration with `float` for money, string "y"/"n" flags, or a timestamp at midnight used as a date.
   - Source: §14.3.4: "Booleans Use the boolean type. Do not store, for example, \"y\" or \"n\" as a string."

7. Add a code comment to every deviation from Rails defaults.
   - Check: a config change away from Rails defaults with no comment.
   - Source: §14.3.2 "Use a SQL Schema": "It’s important that all deviations from Rails’ defaults are understood by current and future team members."

8. API controllers look like any other controller. Put them under an `/api` namespace with a base controller, put the version in the URL, and always render JSON under a top-level key.
   - Check: API actions mixed into HTML controllers, `render json: record` with no top-level key, or versioning through headers.
   - Source: §22.2 "Write APIs the Same Way You Write Other Code": "There’s rarely a reason to do anything different in your API controller methods than in your non-API methods."

9. Define a model's default JSON by overriding `as_json` in the model, not in each controller.
   - Check: the same `as_json(...)` options repeated across several controllers.
   - Source: §22.6.3 "Customize JSON in the Models Themselves": "it makes the most sense to override as_json to explicitly define the default encoding of an object to JSON"

## Claims to correct

1. "Put business logic in a service layer of plain classes in `app/services`." **The book supports this.** Ch 5 says to put each bit of logic "in its own class, and put all those classes somewhere inside app/ like app/services or app/businesslogic", and §17.4 creates `app/services/widget_creator.rb`. Nuance: the book says the layer "can be called something else" and "can be designed any way you like" (§5.4). It does recommend stateless, explicitly named classes with explicitly named methods (§15.2).

2. "Controllers should be thin." **The book supports the substance but not the slogan.** §18.1 says "you won’t end up needing much code in your controllers" and treats controller code as configuration. The book mentions "fat model, skinny controller" only as history (§2.5) and rejects the fat-model half. Controllers still own parameter conversion, `find` lookups and branching on the result (§18.3, §17.4).

3. "Active Record models should hold database access/queries." **The book partly supports this and partly contradicts it.** It agrees that "Active Record is for Database Access" (§13.1). But query methods belong on the model only when they are reused and are pure data access (§13.1.3). Otherwise the book says to call `where`, `order` and `limit` directly in business logic (§16.4) and from controllers (`Widget.find`, `Manufacturer.all`, §17.4 and §18.3). Business-rule queries belong in a service (`FreshWidgetLocator`, §16.4). So the queries do not all have to live on the model.

4. "Services should return Result objects." **The book supports this, with conditions.** §15.2.3 says "Return Rich Result Objects, not Booleans or Active Records." Each result class is specific to its service, with past-tense predicates, and "should not be generic". The book also says "you should not create any sort of return value if one isn’t needed".

5. "A background job is a surprising place for a read query." **The book contradicts this.** §19.4.2 says the job "should locate the widget" from its ID (`Widget.find(widget_id)`) before handing off to the service. §13.1.3 shows a job running `Widget.where(status: "fresh").find_each` and calls `where` "a normal, expected, acceptable thing to do". What the book does object to in jobs is business logic (§19.4.2) and passing objects instead of IDs (§19.4.1).

6. "Prefer a single status over many booleans in a result." **The book does not address this.** §15.2.3 argues against returning a bare boolean *instead of* a result object. Its own example grows the result by adding more specific predicates (`created?`, then `existing_widget_updated?`), not a status field. The book's only status-versus-boolean discussion is about database columns: a lookup table for widget status (§14.3.4). It says nothing about status fields on result objects.

7. "Copeland favors separate i18n keys per page over partials taking copy overrides." **The book does not address this.** Its only i18n use is relabeling an attribute in `config/locales/en.yml` (§17.2.4). On partials, it endorses reusable components that take parameters as locals, including optional ones read with `local_assigns`, such as `suppress_cta` to hide copy (§7.3.3). That example points, if anything, toward parameterized partials. Nothing in the book compares per-page i18n keys with copy-override locals.
