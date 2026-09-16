/**
 * "This account has begun paying for something", written once.
 *
 * The referral offer is for somebody who arrived through a link and then
 * bought, so a claim has to be refused once a purchase is under way. Two
 * separate statements cannot do that: a read here and a write there is a
 * check-then-act, and the window between them is real. A claim submitted
 * after Checkout completes but before its webhook is mirrored sees no
 * purchase, records the attribution anyway, and that purchase or the next one
 * pays a referral that was attached afterwards.
 *
 * So the same predicate is used two ways: as the readable rule's input
 * (`BillingStore.hasBegunAPurchase`, which produces the refusal reason), and
 * inside the INSERT that records an attribution (`ReferralStore.attribute`),
 * where SQLite's single writer serialises it against the webhook's own
 * writes. Neither alone is enough, for the same reason `paid_at` and the
 * deterministic grant id are both needed on the payout.
 *
 * **The barrier is a started purchase, not a completed one.** The customer
 * row is written when Checkout is created, before Stripe can charge, which is
 * the only point early enough to be a barrier at all. The cost is a real one
 * and it is deliberate: somebody who starts a checkout, abandons it, and is
 * then sent a referral link can no longer claim it. That is the conservative
 * direction on a rule that hands out credit.
 *
 * `?1` is the user id. Every statement embedding this must bind it first.
 */
export const PURCHASE_BARRIER_SQL = `(
     EXISTS (SELECT 1 FROM billing_customers WHERE user_id = ?1)
  OR EXISTS (SELECT 1 FROM billing_topups WHERE user_id = ?1)
  OR EXISTS (SELECT 1 FROM billing_subscriptions
              WHERE user_id = ?1
                AND status NOT IN ('incomplete', 'incomplete_expired')))`;

/**
 * "Money has actually cleared for this account", which is a different
 * question from the barrier above and must not be confused with it.
 *
 * The barrier is deliberately early: a customer row exists from the moment a
 * Checkout is created, before Stripe can charge. That is right for refusing a
 * referral claim and catastrophic for deciding to pay one, because it would
 * pay out on a checkout somebody abandoned.
 *
 * This is the late signal, and every term is a record that money moved:
 *
 * - a `billing_topups` row, which is only written for a settled Session
 *   (billing-events.ts checks `payment_status` first), and
 * - a subscription with `ever_paid_at`, which is written from `invoice.paid`,
 *   the only event that says an invoice was actually paid.
 *
 * A subscription's *current status* is deliberately not a term. It is a fact
 * about now rather than about what happened: a subscriber who paid once and
 * then cancelled reads `canceled` for ever, and reading status was exactly
 * how the recovery sweep came to skip them.
 *
 * `?1` is the user id. Every statement embedding this must bind it first.
 */
export const CLEARED_PAYMENT_SQL = `(
     EXISTS (SELECT 1 FROM billing_topups WHERE user_id = ?1)
  OR EXISTS (SELECT 1 FROM billing_subscriptions
              WHERE user_id = ?1 AND ever_paid_at IS NOT NULL))`;
