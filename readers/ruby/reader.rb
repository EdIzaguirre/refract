# frozen_string_literal: true

# Refract's Ruby reader. It turns Ruby source into the language-neutral facts
# Refract compares: classes, their methods and visibility, what they depend
# on, and the Rails declarations that widen them.
#
# Protocol: one JSON object on stdin, {"files": [{"path", "blob", "source"}]},
# and one JSON object on stdout, {"files": [FileFacts]}. See
# src/shared/types.ts for the shape. Parse errors are reported per file and
# never abort the batch.

require "json"
require "prism"

module Refract
  class RubyReader
    CALLBACKS = %w[
      before_action after_action around_action skip_before_action prepend_before_action
      before_validation after_validation before_save after_save around_save
      before_create after_create before_update after_update before_destroy after_destroy
      after_commit after_create_commit after_update_commit after_destroy_commit after_save_commit
      after_initialize after_find after_touch after_rollback before_perform after_perform around_perform
    ].freeze
    ASSOCIATIONS = %w[belongs_to has_many has_one has_and_belongs_to_many].freeze
    VALIDATIONS = %w[validates validate validates_presence_of validates_uniqueness_of validates_format_of
                     validates_length_of validates_inclusion_of validates_numericality_of validates_associated].freeze
    ATTRS = %w[attr_reader attr_writer attr_accessor].freeze
    BRANCH_NODES = %i[if_node unless_node when_node while_node until_node rescue_node and_node or_node
                      in_node for_node].freeze

    def read(files)
      { "files" => files.map { |f| read_file(f["path"], f["blob"], f["source"].to_s) } }
    end

    def read_file(path, blob, source)
      result = Prism.parse(source)
      lines = source.lines
      comment_lines = {}
      result.comments.each do |c|
        loc = c.location
        # A comment that shares its line with code does not make the line a comment line.
        (loc.start_line..loc.end_line).each do |ln|
          text = lines[ln - 1].to_s.strip
          comment_lines[ln] = true if text.start_with?("#") || text.start_with?("=begin") || loc.start_line != loc.end_line
        end
      end
      ctx = FileContext.new(lines, comment_lines)
      walker = Walker.new(ctx)
      walker.walk(result.value)
      {
        "path" => path,
        "blob" => blob,
        "language" => "ruby",
        "lines" => lines.size,
        "codeLines" => ctx.code_lines(1, lines.size),
        "classes" => walker.classes.map(&:to_h),
        "errors" => result.errors.first(3).map { |e| e.message }
      }
    rescue StandardError => e
      { "path" => path, "blob" => blob, "language" => "ruby", "lines" => source.lines.size,
        "codeLines" => 0, "classes" => [], "errors" => ["reader: #{e.class}: #{e.message}"] }
    end

    # Lines, minus blanks and comments, so sizes measure code a reader must hold in their head.
    class FileContext
      def initialize(lines, comment_lines)
        @lines = lines
        @comment_lines = comment_lines
      end

      def code_line?(ln)
        !@lines[ln - 1].to_s.strip.empty? && !@comment_lines[ln]
      end

      def code_lines(from, to, except = [])
        (from..to).count { |ln| code_line?(ln) && except.none? { |r| r.cover?(ln) } }
      end
    end

    ClassFacts = Struct.new(
      :name, :kind, :line, :end_line, :superclass, :nested_in, :methods, :includes, :extends,
      :references, :callbacks, :associations, :validations, :scopes, :helper_methods, :delegates,
      :nested_ranges, :code_lines, :ivars, keyword_init: true
    ) do
      def to_h
        {
          "name" => name, "kind" => kind, "line" => line, "endLine" => end_line,
          "superclass" => superclass, "nestedIn" => nested_in, "codeLines" => code_lines,
          "methods" => methods.map(&:to_h), "includes" => includes.uniq, "extends" => extends.uniq,
          "references" => references.uniq.sort, "callbacks" => callbacks, "associations" => associations,
          "validations" => validations, "scopes" => scopes, "helperMethods" => helper_methods.uniq,
          "delegates" => delegates, "ivars" => ivars.uniq.sort
        }
      end
    end

    MethodFacts = Struct.new(:name, :scope, :visibility, :params, :line, :end_line, :code_lines, :branches,
                             :calls, :kind, keyword_init: true) do
      def to_h
        {
          "name" => name, "scope" => scope, "visibility" => visibility, "params" => params,
          "line" => line, "endLine" => end_line, "codeLines" => code_lines, "branches" => branches,
          "calls" => calls.uniq, "kind" => kind
        }
      end
    end

    # Walks the tree once, keeping a stack of open classes and the current
    # default visibility of each.
    class Walker
      attr_reader :classes

      def initialize(ctx)
        @ctx = ctx
        @classes = []
        @stack = [] # [ClassFacts, visibility, class_scope?]
        @namespace = []
      end

      def walk(node)
        return unless node.is_a?(Prism::Node)

        case node
        when Prism::ClassNode, Prism::ModuleNode then open_class(node)
        when Prism::SingletonClassNode then in_singleton(node)
        when Prism::DefNode then define_method(node)
        when Prism::CallNode then call(node)
        when Prism::ConstantPathNode, Prism::ConstantReadNode then reference(node)
        when Prism::InstanceVariableReadNode, Prism::InstanceVariableWriteNode,
             Prism::InstanceVariableOrWriteNode, Prism::InstanceVariableOperatorWriteNode
          current&.ivars&.push(node.name.to_s)
          node.compact_child_nodes.each { |c| walk(c) }
        else
          node.compact_child_nodes.each { |c| walk(c) }
        end
      end

      private

      def current
        @stack.last && @stack.last[0]
      end

      def open_class(node)
        local = node.constant_path.slice
        name = (local.start_with?("::") ? local.delete_prefix("::") : (@namespace + [local]).join("::"))
        superclass = node.is_a?(Prism::ClassNode) && node.superclass ? node.superclass.slice.delete_prefix("::") : nil
        facts = ClassFacts.new(
          name: name, kind: node.is_a?(Prism::ClassNode) ? "class" : "module",
          line: node.location.start_line, end_line: node.location.end_line, superclass: superclass,
          nested_in: current&.name, methods: [], includes: [], extends: [], references: [], callbacks: [],
          associations: [], validations: 0, scopes: [], helper_methods: [], delegates: [], nested_ranges: [],
          ivars: []
        )
        current.nested_ranges << (facts.line..facts.end_line) if current
        @classes << facts
        reference_text(superclass, facts) if superclass
        @stack.push([facts, "public", false])
        @namespace.push(local.delete_prefix("::"))
        walk(node.body) if node.body
        @namespace.pop
        @stack.pop
        facts.code_lines = @ctx.code_lines(facts.line, facts.end_line, facts.nested_ranges)
      end

      def in_singleton(node)
        return node.compact_child_nodes.each { |c| walk(c) } unless current

        frame = @stack.last
        saved = [frame[1], frame[2]]
        frame[1] = "public"
        frame[2] = true
        walk(node.body) if node.body
        frame[1], frame[2] = saved
      end

      def define_method(node, visibility: nil)
        cls = current
        unless cls
          walk(node.body) if node.body
          return
        end
        frame = @stack.last
        scope = node.receiver || frame[2] ? "class" : "instance"
        vis = visibility || frame[1]
        vis = "public" if scope == "class" && visibility.nil? && !frame[2]
        start_line = node.location.start_line
        end_line = node.location.end_line
        facts = MethodFacts.new(
          name: node.name.to_s, scope: scope, visibility: vis, params: param_count(node.parameters),
          line: start_line, end_line: end_line, code_lines: @ctx.code_lines(start_line, end_line),
          branches: Walker.count_branches(node.body), calls: [], kind: "def"
        )
        cls.methods << facts
        @method = facts
        # Default argument values are code too (gateway: Payments::Gateway.new).
        walk(node.parameters) if node.parameters
        walk(node.body) if node.body
        @method = nil
      end

      def param_count(params)
        return 0 unless params

        %i[requireds optionals keywords posts].sum { |k| params.respond_to?(k) ? Array(params.public_send(k)).size : 0 } +
          (params.rest ? 1 : 0) + (params.keyword_rest ? 1 : 0)
      end

      def call(node)
        cls = current
        name = node.name.to_s
        if cls && node.receiver.nil? && !@method
          return if class_body_call(cls, node, name)
        end
        if @method
          target = receiver_label(node.receiver)
          @method.calls << "#{target}#{name}" if target
        end
        node.compact_child_nodes.each { |c| walk(c) }
      end

      # Returns true when the call was fully handled as a class-body declaration.
      def class_body_call(cls, node, name)
        args = node.arguments ? node.arguments.arguments : []
        frame = @stack.last
        case name
        when "private", "public", "protected"
          if args.empty?
            frame[1] = name
            return true
          end
          args.each do |a|
            if a.is_a?(Prism::DefNode)
              define_method(a, visibility: name)
            else
              sym = symbol(a)
              cls.methods.select { |m| m.name == sym && m.scope == "instance" }.each { |m| m.visibility = name } if sym
            end
          end
          return true
        when "private_class_method"
          args.each do |a|
            if a.is_a?(Prism::DefNode)
              define_method(a, visibility: "private")
            else
              sym = symbol(a)
              cls.methods.select { |m| m.name == sym && m.scope == "class" }.each { |m| m.visibility = "private" }
            end
          end
          return true
        when "module_function"
          frame[2] = true if args.empty?
          return true
        when "include", "prepend" then args.each { |a| cls.includes << a.slice if constant?(a) }
        when "extend" then args.each { |a| cls.extends << a.slice if constant?(a) }
        when "helper_method" then args.each { |a| (s = symbol(a)) && cls.helper_methods << s }
        when "scope"
          if (s = symbol(args.first))
            cls.scopes << s
            add_method(cls, s, "class", "public", node, "scope")
          end
        when "delegate"
          syms = args.filter_map { |a| symbol(a) }
          cls.delegates.concat(syms)
          syms.each { |s| add_method(cls, s, "instance", frame[1], node, "delegate") }
        when *ATTRS
          args.each { |a| (s = symbol(a)) && add_method(cls, s, "instance", frame[1], node, "attr") }
        when *ASSOCIATIONS
          if (s = symbol(args.first))
            class_name = keyword_string(args, "class_name")
            cls.associations << { "kind" => name, "name" => s, "className" => class_name }.compact
          end
        when *CALLBACKS
          cls.callbacks << { "kind" => name, "targets" => args.filter_map { |a| symbol(a) } }
        when *VALIDATIONS
          cls.validations += 1
        end
        false
      end

      def add_method(cls, name, scope, visibility, node, kind)
        cls.methods << MethodFacts.new(
          name: name, scope: scope, visibility: visibility, params: 0, line: node.location.start_line,
          end_line: node.location.end_line, code_lines: 1, branches: 0, calls: [], kind: kind
        )
      end

      def receiver_label(recv)
        case recv
        when nil, Prism::SelfNode then "."
        when Prism::ConstantReadNode, Prism::ConstantPathNode then "#{recv.slice.delete_prefix('::')}."
        when Prism::CallNode
          # Foo.new(...).bar is a call on a Foo instance.
          if recv.name == :new && (recv.receiver.is_a?(Prism::ConstantReadNode) || recv.receiver.is_a?(Prism::ConstantPathNode))
            "#{recv.receiver.slice.delete_prefix('::')}#"
          end
        end
      end

      def reference(node)
        cls = current
        reference_text(node.slice.delete_prefix("::"), cls) if cls
        # A path's parts are not separate references.
      end

      def reference_text(text, cls)
        cls.references << text if text.match?(/\A[A-Z]/)
      end

      def symbol(node)
        case node
        when Prism::SymbolNode then node.unescaped.to_s
        when Prism::StringNode then node.unescaped.to_s
        end
      end

      def keyword_string(args, key)
        hash = args.find { |a| a.is_a?(Prism::KeywordHashNode) }
        return unless hash

        pair = hash.elements.find { |e| e.respond_to?(:key) && symbol(e.key) == key }
        pair && symbol(pair.value)
      end

      def constant?(node)
        node.is_a?(Prism::ConstantReadNode) || node.is_a?(Prism::ConstantPathNode)
      end

      public

      def self.count_branches(node)
        return 0 unless node.is_a?(Prism::Node)

        own = BRANCH_NODES.include?(node.type) ? 1 : 0
        own + node.compact_child_nodes.sum { |c| count_branches(c) }
      end
    end
  end
end

if $PROGRAM_NAME == __FILE__
  input = JSON.parse($stdin.read)
  $stdout.write(JSON.generate(Refract::RubyReader.new.read(input["files"] || [])))
end
