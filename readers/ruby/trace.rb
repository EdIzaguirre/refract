# frozen_string_literal: true

# Loaded with RUBYOPT=-r<this file> while Refract runs the tests that touch a
# change. It records which application methods call which, so request flows
# are drawn from what really ran. Calls outside REFRACT_TRACE_ROOT (gems,
# Ruby itself, the tests) are not recorded; their callees still are, as new
# entries.

require "json"

module RefractTrace
  ROOT = File.expand_path(ENV.fetch("REFRACT_TRACE_ROOT", Dir.pwd))
  OUT = ENV.fetch("REFRACT_TRACE_OUT")
  SKIP = %r{/(test|spec|vendor|node_modules|config|db)/}
  MAX_FLOWS = 400
  MAX_CALLS = 300

  @flows = {}
  @current = nil
  @stack = []

  class << self
    attr_reader :flows

    def app_path?(path)
      path&.start_with?(ROOT) && !SKIP.match?(path.delete_prefix(ROOT))
    end

    def label(tp)
      owner = tp.defined_class
      if owner.singleton_class?
        recv = tp.self
        name = recv.is_a?(Module) ? recv.name : nil
        [name, "."]
      else
        recv_class = tp.self.is_a?(Module) ? tp.self : tp.self.class
        [recv_class.name || owner.name, "#"]
      end
    rescue StandardError
      [nil, "#"]
    end

    def on_call(tp)
      return unless app_path?(tp.path)

      klass, sep = label(tp)
      return unless klass

      node = "#{klass}#{sep}#{tp.method_id}"
      if @stack.empty?
        @current = { "entry" => node, "calls" => [] }
      elsif @current && @current["calls"].size < MAX_CALLS
        caller_klass = @stack.last[0]
        @current["calls"] << { "from" => caller_klass, "to" => klass, "method" => tp.method_id.to_s,
                               "source" => "observed", "depth" => @stack.size - 1 }
      end
      @stack.push([klass, node])
    end

    def on_return(tp)
      return unless app_path?(tp.path)
      return if @stack.empty?

      @stack.pop
      finish if @stack.empty?
    end

    def finish
      flow = @current
      @current = nil
      return unless flow && !flow["calls"].empty?

      key = flow["entry"] + flow["calls"].map { |c| "#{c['to']}.#{c['method']}" }.join(",")
      @flows[key] ||= flow if @flows.size < MAX_FLOWS
    end

    def write
      File.write("#{OUT}.#{Process.pid}.json", JSON.generate({ "flows" => @flows.values }))
    end
  end

  TRACE = TracePoint.new(:call, :return) do |tp|
    tp.event == :call ? RefractTrace.on_call(tp) : RefractTrace.on_return(tp)
  rescue StandardError
    nil
  end
  TRACE.enable
  at_exit { RefractTrace.write }
end
