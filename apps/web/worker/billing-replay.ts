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
  /** Events that threw. The cursor does not advance past one. */
  failed: number;
  /**
   * Events whose owner this deployment could not work out yet, so nothing
   * was written and nothing was marked done.
   *
   * Ordinary during a catch-up rather than an error. A descent reads newest
   * first, so a missed `invoice.paid` can be read before the older
   * `checkout.session.completed` that creates the customer mapping. The next
   * run retries it, by which time the older event has been applied.
   */
  unresolved: number;
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

  // Written before the first request, so the top of the descent is durable
  // even if this run's first page is the one that fails and nothing else is
  // ever persisted. Without it a new sweep would forget its own top and the
  // next run would pin a later one.
  await store.saveEventReplayCursor(STRIPE_EVENTS_CURSOR, cursor);

  let read = 0;
  let applied = 0;
  let failed = 0;
  let unresolved = 0;
  let requests = 0;
  /**
   * Whether anything this run read was left undone.
   *
   * One flag rather than a condition per exit, because getting this wrong
   * once per exit is exactly how this function was wrong twice. It means the
   * same thing everywhere: the cursor may not move past a page that still
   * holds work, and the floor may not move at all. A throw and an event
   * nobody could be attributed to are the same answer to that question, so
   * they set the same flag.
   */
  let blocked = false;
  /**
   * Where the next request in *this* run picks up.
   *
   * Held apart from the persisted `sweepAfterId`, and they are two different
   * questions. This one has to advance on every page or the descent never
   * moves: a blocked run that kept asking from the same place would spend
   * its whole budget re-reading one page, and the older events below it are
   * exactly what an unresolved event is waiting for. The persisted one must
   * not advance past a blocked page, because it is where the next run
   * starts.
   */
  let after = cursor.sweepAfterId;

  while (requests < budget) {
    const page = await stripe.events.list({
      limit: PAGE_SIZE,
      types: REPLAYED_EVENT_TYPES,
      created: { gte: cursor.doneBelow, lt: sweepTop },
      ...(after === null ? {} : { starting_after: after }),
    } as Stripe.EventListParams);
    requests += 1;

    // Oldest first within the page, because applying a subscription update
    // before the update that superseded it leaves the mirror holding the
    // older one.
    //
    // Reversed before the sort, not sorted alone. Stripe lists newest first
    // and `created` has one-second resolution, so two updates in the same
    // second compare equal and a stable sort leaves them in the order they
    // arrived in, which is the newest-first order this is trying to undo.
    // Reversing first makes the page oldest-first, and the sort then only
    // has to fix the pairs whose seconds actually differ.
    const events = [...page.data]
      .reverse()
      .sort((a, b) => a.created - b.created);
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
        const outcome = await applyStripeEvent(store, event);
        if (outcome === 'unresolved') {
          // Nothing was written, so it is not done. Marking it processed on
          // a normal return is how a real payment is lost for ever: a
          // missed `invoice.paid` read before the older Checkout that
          // creates its customer mapping has nobody to attribute to yet,
          // and does once that older event is applied further down this
          // same descent. `blocked` holds the floor so the next run comes
          // back for it.
          unresolved += 1;
          blocked = true;
          continue;
        }
        await store.markEventProcessed(event.id, event.type);
        applied += 1;
      } catch (error) {
        console.error('replay: failed to apply stripe event', event.id, error);
        failed += 1;
        blocked = true;
      }
    }

    const oldest = page.data.at(-1);
    // Recorded after every page, not once at the end. A run cut off
    // mid-descent then loses one page rather than the whole descent, and a
    // descent that restarts at the top every night never reaches the bottom.
    //
    // And only while nothing has failed. The saved resume point must never
    // go below a page something threw on, because the next run's `failed`
    // starts at zero: it would resume under the failed event, reach the
    // bottom clean, and move the floor over the payment. Every way out of
    // this loop has to hold that, not just the one that reaches the bottom.
    // The budget can run out below a failure, and the next `events.list` can
    // reject, and both leave through a different door.
    //
    // Later pages are still applied, which is worth doing and costs nothing
    // to redo. They are simply not credited to the cursor, so the next run
    // resumes at the page that failed.
    if (oldest !== undefined) {
      after = oldest.id;
      if (!blocked) {
        cursor = { ...cursor, sweepAfterId: oldest.id };
        await store.saveEventReplayCursor(STRIPE_EVENTS_CURSOR, cursor);
      }
    }

    if (!page.has_more) {
      // The descent reached the floor, so everything below the top of this
      // sweep has now been replayed. Only here does the floor move, and it
      // moves to where the descent started rather than to where it stopped.
      if (!blocked) {
        await store.saveEventReplayCursor(STRIPE_EVENTS_CURSOR, {
          doneBelow: sweepTop,
          sweepTop: null,
          sweepAfterId: null,
        });
        return {
          read,
          applied,
          failed,
          unresolved,
          requests,
          incomplete: false,
        };
      }

      // Something was left undone, so this descent did not cover its ground
      // and the
      // floor stays where it is. The resume point needs no rewind: nothing
      // has been persisted since the failure, so it already sits at the page
      // that failed and the next run reads it again.
      //
      // The deliberate consequence is that an event which fails for ever
      // holds the floor for ever, and nothing above this sweep is replayed
      // until it is fixed. That is the trade taken on purpose. The
      // alternative is stepping over a payment somebody made, and a stall
      // says so every night in `failed` and `incomplete` while a step-over
      // says nothing at all.
      return { read, applied, failed, unresolved, requests, incomplete: true };
    }
  }

  return { read, applied, failed, unresolved, requests, incomplete: true };
}
