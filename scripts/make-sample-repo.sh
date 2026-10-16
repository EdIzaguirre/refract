#!/usr/bin/env bash
# Builds a small Ruby shop app with a base on main and an "agent" branch of
# three commits, so Refract has something real to show without a Rails app.
#   scripts/make-sample-repo.sh [dir]     (default: ./sample-shop)
# Then:  cd sample-shop && refract main..agent/receipts
set -euo pipefail
DIR="${1:-sample-shop}"
rm -rf "$DIR"
mkdir -p "$DIR"
cd "$DIR"
git init -q -b main
git config user.email "agent@example.com"
git config user.name "Sample Agent"

mkdir -p app/models app/services app/controllers app/jobs test
cat > app/models/order.rb <<'RB'
class Order
  attr_reader :id, :user, :items, :status

  def initialize(id:, user:, items:)
    @id = id
    @user = user
    @items = items
    @status = :open
  end

  def total
    items.sum { |i| i[:price] * i[:qty] }
  end

  def paid!
    @status = :paid
  end

  def paid?
    status == :paid
  end
end
RB
cat > app/models/user.rb <<'RB'
class User
  attr_reader :email, :name

  def initialize(email:, name:)
    @email = email
    @name = name
  end
end
RB
cat > app/jobs/receipt_email_job.rb <<'RB'
class ReceiptEmailJob
  SENT = []

  def self.perform_later(order_id, email)
    SENT << [order_id, email]
  end
end
RB
cat > app/services/checkout.rb <<'RB'
class Checkout
  def initialize(order)
    @order = order
  end

  def complete
    return false if @order.paid?

    @order.paid!
    # Tell the customer.
    ReceiptEmailJob.perform_later(@order.id, @order.user.email)
    true
  end
end
RB
cat > app/controllers/orders_controller.rb <<'RB'
class OrdersController
  def create(params)
    order = Order.new(id: params[:id], user: User.new(email: params[:email], name: params[:name]), items: params[:items])
    if Checkout.new(order).complete
      { status: 201, order: order }
    else
      { status: 422 }
    end
  end

  def resend_receipt(order)
    if order.paid?
      ReceiptEmailJob.perform_later(order.id, order.user.email)
      { status: 200 }
    else
      { status: 409 }
    end
  end
end
RB
cat > test/test_helper.rb <<'RB'
require "minitest/autorun"
Dir[File.expand_path("../app/**/*.rb", __dir__)].sort.each { |f| require f }
RB
cat > test/checkout_test.rb <<'RB'
require_relative "test_helper"

class CheckoutTest < Minitest::Test
  def test_completes_an_order
    user = User.new(email: "a@example.com", name: "A")
    order = Order.new(id: 1, user: user, items: [{ price: 5, qty: 2 }])
    assert Checkout.new(order).complete
    assert order.paid?
  end
end
RB
cat > test/orders_controller_test.rb <<'RB'
require_relative "test_helper"

class OrdersControllerTest < Minitest::Test
  def test_create_and_resend
    controller = OrdersController.new
    res = controller.create(id: 7, email: "b@example.com", name: "B", items: [{ price: 3, qty: 1 }])
    assert_equal 201, res[:status]
    assert_equal 200, controller.resend_receipt(res[:order])[:status]
  end
end
RB
git add -A && git commit -qm "Shop: orders, checkout and receipts"

git checkout -qb agent/receipts
cat > app/services/receipts.rb <<'RB'
# Owns sending receipts, so callers no longer queue the job themselves.
class Receipts
  def send_for(order, reason: :paid)
    return Result.new(sent: false) unless order.paid?

    ReceiptEmailJob.perform_later(order.id, order.user.email)
    Result.new(sent: true, reason: reason)
  end

  class Result
    def initialize(sent:, reason: nil)
      @sent = sent
      @reason = reason
    end

    def sent?
      @sent
    end
  end
end
RB
cat > app/services/checkout.rb <<'RB'
class Checkout
  def initialize(order)
    @order = order
  end

  def complete
    return false if @order.paid?

    @order.paid!
    Receipts.new.send_for(@order)
    true
  end
end
RB
cat > app/controllers/orders_controller.rb <<'RB'
class OrdersController
  def create(params)
    order = Order.new(id: params[:id], user: User.new(email: params[:email], name: params[:name]), items: params[:items])
    if Checkout.new(order).complete
      { status: 201, order: order }
    else
      { status: 422 }
    end
  end

  def resend_receipt(order)
    result = Receipts.new.send_for(order, reason: :resend)
    { status: result.sent? ? 200 : 409 }
  end
end
RB
git add -A && git commit -qm "Move receipt sending into a Receipts service"

cat > app/models/order.rb <<'RB'
class Order
  attr_reader :id, :user, :items, :status, :coupon

  def initialize(id:, user:, items:, coupon: nil)
    @id = id
    @user = user
    @items = items
    @coupon = coupon
    @status = :open
  end

  def total
    subtotal - discount
  end

  def subtotal
    items.sum { |i| i[:price] * i[:qty] }
  end

  def discount
    return 0 unless coupon
    if coupon.start_with?("PCT")
      subtotal * coupon.delete_prefix("PCT").to_i / 100
    elsif coupon.start_with?("OFF")
      [coupon.delete_prefix("OFF").to_i, subtotal].min
    else
      0
    end
  end

  def paid!
    @status = :paid
  end

  def paid?
    status == :paid
  end
end
RB
git add -A && git commit -qm "Support coupons on orders"

cat > app/services/payments.rb <<'RB'
module Payments
  class Gateway
    def charge(order)
      { ok: order.total.positive?, amount: order.total }
    end
  end
end
RB
cat > app/services/checkout.rb <<'RB'
class Checkout
  def initialize(order, gateway: Payments::Gateway.new)
    @order = order
    @gateway = gateway
  end

  def complete
    return false if @order.paid?
    return false unless @gateway.charge(@order)[:ok]

    @order.paid!
    Receipts.new.send_for(@order)
    true
  end
end
RB
git add -A && git commit -qm "Charge through a payment gateway before marking paid"
git checkout -q main
echo "Built $(pwd): main plus agent/receipts (3 commits)."
