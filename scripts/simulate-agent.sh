#!/usr/bin/env bash
# Adds a commit to agent/receipts every few seconds, like an agent at work,
# so you can watch Refract's map update live:
#   refract watch agent/receipts   (in one terminal)
#   scripts/simulate-agent.sh sample-shop   (in another)
set -euo pipefail
DIR="${1:-sample-shop}"
DELAY="${2:-8}"
cd "$DIR"
WT=$(mktemp -d)
git worktree add -q "$WT" agent/receipts
cd "$WT"
sleep "$DELAY"
cat > app/services/refunds.rb <<'RB'
class Refunds
  def refund(order, gateway: Payments::Gateway.new)
    return false unless order.paid?

    gateway.charge(order)
    Receipts.new.send_for(order, reason: :refund)
    true
  end
end
RB
git add -A && git commit -qm "Add refunds" && echo "committed: Add refunds"
sleep "$DELAY"
cat >> app/controllers/orders_controller.rb <<'RB'

class OrdersController
  def refund(order)
    Refunds.new.refund(order) ? { status: 200 } : { status: 409 }
  end
end
RB
git add -A && git commit -qm "Expose refunds on the orders controller" && echo "committed: Expose refunds"
cd - >/dev/null
git worktree remove --force "$WT"
