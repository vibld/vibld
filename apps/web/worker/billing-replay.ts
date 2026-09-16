/**
 * Recover payments whose webhook was never delivered, by replaying Stripe's
 * own event log through the handler the webhook uses.
 *
 * A delivery can be missed outright, and Stripe stops retrying a failing
 * endpoint after a few days. What that delivery would have carried is still
 * in Stripe's event log, so this asks Stripe for the events rather than
 * asking each customer for their history.
 *
 * That choice is the point of this module. Three previous attempts walked
 * per-customer Checkout and invoice history and produced eight findings
 * between them, always the same shape: an unbounded read inside a run with a
 * fixed budget, then a bound that turned "never finishes" into "stops early
 * and reports success". The cases that broke them are all absent here rather
 * than handled:
 *
 * - a customer mapped at Checkout creation whose session has not settled has
 *   no settled event, so there is nothing to find and nothing to re-read;
 * - a subscriber whose invoices all collected zero needs no short-circuit,
 *   because no invoice history is read;
 * - a customer whose history is long enough to exhaust the budget cannot
 *   pin the run, because the descent is global and resumes below where it
 *   stopped instead of starting again at the top.
 *
 * What remains bounded is Stripe's retention: events live about 30 days, so
 * a deployment that has been down longer than that has a gap this cannot
 * close. That is stated rather than worked around.
 */
import type Stripe from 'stripe';
import { applyStripeEvent } from './billing-events.ts';
import { BillingStore } from './billing-store.ts';
import type { EventReplayCursor } from './billing-store.ts';

/** The cursor row this sweep uses. One today; named so a second is not a schema change. */
export const STRIPE_EVENTS_CURSOR = 'stripe-events';

/** Events per Stripe request. Stripe's own maximum, so the fewest requests per event. */
const PAGE_SIZE = 100;

/**
 * Stripe requests one run may spend.
 *
 * A budget rather than a limit on what is covered. Running out ends the run
 * with the cursor recorded, and the next run resumes below it, so the budget
 * decides how long a catch-up takes and never what is reachable.
 */
export const DEFAULT_REQUEST_BUDGET = 20;

/**
 * The event types this deployment knows how to apply.
 *
 * Asked of Stripe rather than filtered after the fact, so a busy account's
 * unrelated events do not spend the budget. It is the same list
 * `billing-handlers.ts` registers as the webhook's `enabled_events`, and
 * `applyStripeEvent` logs anything outside it.
 */
export const REPLAYED_EVENT_TYPES = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
];

export interface ReplayResult {
  /** Events read from Stripe, including ones a delivery had already applied. */
  read: number;
  /** Events this run applied, which is the number no delivery had. */
  applied: number;
  /** Events that threw. The cursor does not advance past a failure. */
  failed: number;
  /** Stripe requests spent, out of the budget. */
  requests: number;
  /**
   * Whether ground remains below where this run stopped.
   *
   * True is not a failure and false is not an assurance that nothing was
   * missed: it says only that this descent reached its bottom. It exists so
   * the caller cannot read a run that ran out of budget as a run that found
   * nothing, which is the mistake every previous attempt at this made.
   */
  incomplete: boolean;
}

/** Stripe's list, narrowed to what this module uses, so the fake can be small. */
interface EventLister {
  events: {
    list(params: Stripe.EventListParams): Promise<{
      data: Stripe.Event[];
      has_more: boolean;
    }>;
  };
}

/**
 * Replay one run's worth of Stripe's event log.
 *
 * Descends from the top of the current sweep towards the floor, applying
 * each event and recording the resume point after every page. Stops when the
 * descent reaches the floor (the sweep is complete and the floor moves up to
 * the sweep's top), when the budget is spent, or when an event fails.
 */
export async function replayStripeEvents(
  stripe: EventLister,
  store: BillingStore,
  budget: number = DEFAULT_REQUEST_BUDGET,
  now: () => number = () => Math.floor(Date.now() / 1000),
): Promise<ReplayResult> {
  const saved = await store.getEventReplayCursor(STRIPE_EVENTS_CURSOR);
  // A deployment that has never run one asks for everything Stripe still
  // holds. Bounded by retention, not by this number.
  let cursor: EventReplayCursor = saved ?? {
    doneBelow: 0,
    sweepTop: null,
    sweepAfterId: null,
  };

  // A descent that is not already in progress starts at this moment. Events
  // created after it belong to the next sweep, which is why the top is
  // pinned here rather than read again per page: a busy account would
  // otherwise keep raising the ceiling and the descent would chase it.
  const sweepTop = cursor.sweepTop ?? now();
  cursor = {
    ...cursor,
    sweepTop,
    sweepAfterId: cursor.sweepTop === null ? null : cursor.sweepAfterId,
  };

  let read = 0;
  let applied = 0;
  let failed = 0;
  let requests = 0;

  while (requests < budget) {
    const page = await stripe.events.list({
      limit: PAGE_SIZE,
      types: REPLAYED_EVENT_TYPES,
      created: { gte: cursor.doneBelow, lt: sweepTop },
      ...(cursor.sweepAfterId === null
        ? {}
        : { starting_after: cursor.sweepAfterId }),
    } as Stripe.EventListParams);
    requests += 1;

    // Oldest first within the page. Stripe lists newest first, and applying
    // a subscription update before the update that superseded it would leave
    // the mirror holding the older one.
    const events = [...page.data].sort((a, b) => a.created - b.created);
    for (const event of events) {
      read += 1;
      try {
        if (await store.wasEventProcessed(event.id)) continue;
        // No purchase hook, deliberately. `announceIfPaid` lets a failed
        // referral payout fail the delivery, which is right for a webhook
        // because Stripe retries it, and wrong here because nothing retries
        // this: the throw would count as a failure, hold the floor, and stop
        // every future payment being recovered over a bug in an unrelated
        // subsystem. The payment is recorded before the payout is announced
        // in both handlers, so what this module exists for has already
        // happened by then, and `resumeStrandedPayouts` pays on the recorded
        // payment rather than on being told. It runs straight after this in
        // the same nightly pass.
        await applyStripeEvent(store, event);
        await store.markEventProcessed(event.id, event.type);
        applied += 1;
      } catch (error) {
        console.error('replay: failed to apply stripe event', event.id, error);
        failed += 1;
      }
    }

    const oldest = page.data.at(-1);
    if (oldest !== undefined) {
      // Recorded after every page, not once at the end. A run cut off
      // mid-descent then loses one page rather than the whole descent, and a
      // descent that restarts at the top every night never reaches the
      // bottom.
      cursor = { ...cursor, sweepAfterId: oldest.id };
      await store.saveEventReplayCursor(STRIPE_EVENTS_CURSOR, cursor);
    }

    if (!page.has_more) {
      // The descent reached the floor, so everything below the top of this
      // sweep has now been replayed. Only here does the floor move, and it
      // moves to where the descent started rather than to where it stopped.
      if (failed === 0) {
        await store.saveEventReplayCursor(STRIPE_EVENTS_CURSOR, {
          doneBelow: sweepTop,
          sweepTop: null,
          sweepAfterId: null,
        });
        return { read, applied, failed, requests, incomplete: false };
      }

      // Something threw, so this descent did not cover its ground and the
      // floor stays where it is. The resume point has to go back to the top
      // with it: it points below the page the failure was on, so leaving it
      // would send the next run past the failed event, let that run finish
      // clean, and move the floor over the event anyway. Which is the silent
      // loss this module exists to prevent, arrived at one run later.
      //
      // So the whole sweep is walked again. Everything that did apply is
      // skipped by `wasEventProcessed`, so the cost is requests rather than
      // writes, and the deliberate consequence is that an event which fails
      // for ever holds the floor for ever: nothing above this sweep is
      // replayed until it is fixed. That is the trade taken on purpose. The
      // alternative is stepping over a payment somebody made, and a stall
      // says so every night in `failed` while a step-over says nothing at
      // all.
      await store.saveEventReplayCursor(STRIPE_EVENTS_CURSOR, {
        doneBelow: cursor.doneBelow,
        sweepTop,
        sweepAfterId: null,
      });
      return { read, applied, failed, requests, incomplete: true };
    }
  }

  return { read, applied, failed, requests, incomplete: true };
}
