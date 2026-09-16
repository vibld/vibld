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
import type { OnPurchaseReversed, ResolveCharge } from './billing-events.ts';
import { BillingStore } from './billing-store.ts';
import type { EventReplayCursor } from './billing-store.ts';

/** The cursor row this sweep uses. One today; named so a second is not a schema change. */
export const STRIPE_EVENTS_CURSOR = 'stripe-events';

/**
 * The most events one Stripe request may return.
 *
 * Stripe's own maximum, and also D1's hundred bound parameters per query,
 * which is what the page's one dedupe read is bounded by. The page actually
 * asked for is smaller whenever the query budget below cannot afford this
 * many.
 */
const PAGE_SIZE_CAP = 100;

/**
 * D1 queries one event can cost, at its worst.
 *
 * A settled top-up Checkout is the worst: `linkCustomer`, `recordTopup`,
 * `recordPayment`, then `markEventProcessed`. An invoice or a subscription
 * costs one fewer. Whether an event has already been applied is asked once
 * for the whole page rather than once per event, which is why that is not in
 * this number.
 *
 * Over-counting here is safe and under-counting is not, so a handler that
 * grows a write has to grow this.
 *
 * A reversal is now the worst case, not a top-up Checkout. `charge.refunded`
 * and a lost `charge.dispute.closed` resolve the customer, then the clawback
 * reads the attribution, reads each side's granted total and writes each
 * side's deduction: nine at the worst.
 *
 * That worst case is rare (a refund of a purchase no referral was attached
 * to stops after the attribution read) and this number is a worst case
 * regardless, so the page size it produces is smaller than the average run
 * needs. The cost is stated rather than hidden: the replay reads fewer
 * events per night than it did, so catching up from a backlog takes
 * proportionally longer. That is the price of a missed refund being
 * recovered at all, and losing one silently is what the alternative costs.
 */
const MAX_QUERIES_PER_EVENT = 9;

/** The page's dedupe read, plus the cursor save after it. */
const QUERIES_PER_PAGE = 2;

/** The sweep header written before the first request. */
const QUERIES_PER_RUN = 1;

/**
 * D1 queries one run may spend.
 *
 * D1 counts queries per Worker invocation and stops the invocation at the
 * limit: 1000 on Workers Paid, 50 on Workers Free. Exceeding it is not a slow
 * run, it is a throw partway through a page, and a throw leaves the cursor
 * where it was, so every following night would die in the same place for
 * ever. A budget that never decides what is reachable has to be a budget in
 * the unit the platform actually meters.
 *
 * The default is the one that is safe wherever this is deployed, because
 * which plan a deployment is on is not something this code can read. A
 * deployment on Workers Paid should raise it: see `VIBLD_REPLAY_QUERY_BUDGET`
 * in `worker/index.ts`.
 */
export const DEFAULT_QUERY_BUDGET = 40;

/**
 * How many events a page may hold, given what a run may spend.
 *
 * At least one, always. A page that cannot fit in the budget could never be
 * completed, and a page that is never completed is a cursor that never
 * advances, which is the stuck-for-ever failure in another costume.
 */
export function pageSizeFor(queryBudget: number): number {
  const forEvents = queryBudget - QUERIES_PER_RUN - QUERIES_PER_PAGE;
  return Math.max(
    1,
    Math.min(PAGE_SIZE_CAP, Math.floor(forEvents / MAX_QUERIES_PER_EVENT)),
  );
}

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
  'charge.refunded',
  'charge.dispute.closed',
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
   * D1 queries this run reserved against the invocation's allowance.
   *
   * The worst case it charged itself, not what it happened to use, because
   * what the phases after it may safely spend depends on what this one could
   * have spent rather than on what it did. Reported so the caller can hand
   * the rest of the pass what is actually left: a later phase sizing itself
   * from the whole allowance is how an invocation goes over the limit while
   * every phase believes it stayed inside one.
   */
  queriesReserved: number;
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
  queryBudget: number = DEFAULT_QUERY_BUDGET,
  onPurchaseReversed?: OnPurchaseReversed,
  resolveCharge?: ResolveCharge,
): Promise<ReplayResult> {
  const pageSize = pageSizeFor(queryBudget);
  // What a page costs at its worst, which is what decides whether there is
  // room for another one. Measured against the worst case rather than what
  // the last page happened to cost: the budget exists to keep the run inside
  // a limit the platform enforces by throwing, and a throw is the one
  // outcome this must not reach.
  const worstPageCost = QUERIES_PER_PAGE + pageSize * MAX_QUERIES_PER_EVENT;
  let spent = QUERIES_PER_RUN;
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
   * holds work, and the floor may not move at all.
   *
   * A throw only. An event nobody could be attributed to used to set this
   * too, and that was wrong for a reason worth keeping written down: a
   * permanently unattributable event would pin the sweep for ever while
   * Stripe's retention window kept moving, so the freeze meant to save one
   * payment would lose every later one. Those are parked instead. A throw
   * is a bug in this deployment, is expected to be fixed, and is the case
   * where stopping is right.
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

  while (requests < budget && spent + worstPageCost <= queryBudget) {
    spent += worstPageCost;
    const page = await stripe.events.list({
      limit: pageSize,
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
    // One query for the page rather than one per event, which is what makes
    // a page of a hundred affordable at all.
    const alreadyDone = await store.processedEventIds(
      events.map((event) => event.id),
    );
    for (const event of events) {
      read += 1;
      try {
        if (alreadyDone.has(event.id)) continue;
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
        // The reversal hook is passed and the purchase hook is not, which
        // is not an inconsistency. A payout that fails can be picked up
        // later because the payment it depends on was recorded, and
        // `resumeStrandedPayouts` does exactly that. A reversal records
        // nothing, so a run that applies one without clawing back marks the
        // event done and the credit stays for ever. The hook below is
        // wrapped by its caller so a failure inside it can never throw here
        // and hold the floor.
        const outcome = await applyStripeEvent(
          store,
          event,
          undefined,
          onPurchaseReversed,
          resolveCharge,
        );
        if (outcome === 'unresolved') {
          // Nothing was written, so it is not done, and marking it processed
          // on a normal return is how a real payment is lost for ever: a
          // missed `invoice.paid` read before the older Checkout that
          // creates its customer mapping has nobody to attribute to yet,
          // and does once that older event is applied.
          //
          // It does not hold the sweep either, which is the part that took
          // two goes to get right. Freezing looks like the safe direction
          // and is not: Stripe keeps events about 30 days, so a freeze holds
          // the cursor still while the retention boundary moves, and an
          // event that can never be attributed turns one stuck event into
          // every future payment. The freeze causes the loss it was meant to
          // prevent.
          //
          // So the event is taken out of Stripe's custody and put into ours,
          // payload and all, and `retryUnattributedEvents` comes back for it
          // every night at no request cost. Nothing is lost and nothing is
          // pinned.
          unresolved += 1;
          await store.parkUnattributedEvent(
            event.id,
            event.type,
            event.created,
            JSON.stringify(event),
          );
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
          queriesReserved: spent,
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
      return {
        read,
        applied,
        failed,
        unresolved,
        requests,
        queriesReserved: spent,
        incomplete: true,
      };
    }
  }

  return {
    read,
    applied,
    failed,
    unresolved,
    requests,
    queriesReserved: spent,
    incomplete: true,
  };
}

/**
 * How many parked events one retry run may take on.
 *
 * This runs in the same Worker invocation as the replay, so the argument is
 * what the replay *left*, never the whole allowance. Sizing both phases from
 * the same number is how an invocation goes over D1's limit while each phase
 * believes it stayed inside one: the replay can reserve most of it, and a
 * batch scaled to the full budget then spends it a second time.
 *
 * Zero is a legitimate answer. A run with nothing left does no parked work
 * tonight rather than throwing partway through some, and the queue rotates
 * by `last_attempt_at`, so nothing is skipped over: what it did not reach is
 * at the front of the next one.
 */
export function retryBatchFor(queryBudget: number): number {
  return Math.max(0, Math.floor(queryBudget / MAX_QUERIES_PER_PARKED_ROW));
}

/**
 * The share of an invocation's allowance held back for parked events, before
 * the replay is allowed to reserve any of it.
 *
 * Leftovers do not work, and the arithmetic says so rather than the
 * intention: the replay reserves a page's worst case up front whether or not
 * the page had anything in it, so on the smallest supported budget (40, the
 * Workers Free default) it took 39 of 40 every night and the retry was
 * handed 1, which buys no rows. Every night, for ever, while the cursor
 * moved on past the very events that were parked. Money already taken and
 * never credited to anybody.
 *
 * A quarter, and never fewer than one row's worth. The order of precedence
 * is deliberate: a parked event is a payment this deployment has already
 * seen and cannot attribute, which is worse than a payment it has not read
 * yet, so it is served first and the replay takes what is left rather than
 * the other way round.
 */
export function parkedReserveFor(queryBudget: number): number {
  return Math.max(MAX_QUERIES_PER_PARKED_ROW, Math.floor(queryBudget / 4));
}

/**
 * D1 queries one stranded referral payout costs at its worst: the attempt
 * stamp, the attribution read, the slot claim, a credit grant for each side,
 * then the paid mark. Read off `resumeStrandedPayouts` and
 * `payReferralIfEarned`.
 */
const MAX_QUERIES_PER_PAYOUT_ROW = 6;

/**
 * How many stranded payouts one run may take on, given an allowance.
 *
 * The minus one is the query that selects the batch, which is paid once
 * rather than per row.
 */
export function payoutBatchFor(queryBudget: number): number {
  return Math.max(
    0,
    Math.floor((queryBudget - 1) / MAX_QUERIES_PER_PAYOUT_ROW),
  );
}

/**
 * The share held back for stranded referral payouts.
 *
 * Reserved off the top for the same reason the parked queue is: a payout
 * that is owed is money somebody has already earned, so it does not wait on
 * whatever discovery happens to leave behind. Its default batch of 100 rows
 * costs 601 queries on its own, which is most of a Workers Paid invocation,
 * and nothing used to bound it at all.
 */
export function payoutReserveFor(queryBudget: number): number {
  return Math.max(1 + MAX_QUERIES_PER_PAYOUT_ROW, Math.floor(queryBudget / 4));
}

/**
 * What the replay may reserve, once the two phases that pay out what is
 * already owed have had their shares.
 *
 * The replay is last on purpose. It looks for money that may have been
 * missed; the other two hand over money already established as owed, and a
 * night that does those and reads less history is the better night.
 */
export function replayBudgetFor(queryBudget: number): number {
  return Math.max(
    0,
    queryBudget - parkedReserveFor(queryBudget) - payoutReserveFor(queryBudget),
  );
}

/**
 * D1 queries one parked row costs at its worst: the attempt stamp, the
 * handler's own writes, then the mark and the delete once it resolves.
 */
const MAX_QUERIES_PER_PARKED_ROW = MAX_QUERIES_PER_EVENT + 2;

export interface RetryResult {
  /** Parked events this run looked at. */
  tried: number;
  /** How many of them could finally be attributed and applied. */
  applied: number;
  /** Still waiting for whatever would tell us whose money this is. */
  waiting: number;
  /** Rows that threw, left parked. */
  failed: number;
}

/**
 * Come back for the events nobody could be attributed to.
 *
 * Reads no Stripe: the payload was kept when the event was parked, which is
 * the whole reason it was kept. So this costs a few local queries and can
 * run every night for as long as it takes, long after Stripe has forgotten
 * the event ever existed.
 *
 * Oldest first, the same ordering rule the replay uses within a page, so an
 * older Checkout that maps a customer is applied before the invoice that
 * needs the mapping.
 *
 * It never gives up. A row that cannot be attributed after a hundred nights
 * is a question for a person, not a thing to delete: `attempts` and
 * `first_seen_at` are there so it can be asked.
 */
export async function retryUnattributedEvents(
  store: BillingStore,
  limit = retryBatchFor(DEFAULT_QUERY_BUDGET),
  now: () => string = () => new Date().toISOString(),
  onPurchaseReversed?: OnPurchaseReversed,
  resolveCharge?: ResolveCharge,
): Promise<RetryResult> {
  // Least recently tried first, so a row that can never be attributed costs
  // one attempt a night rather than holding the front of the queue for ever.
  // Then oldest-first within the batch, because the ordering that gets a row
  // *into* the batch and the ordering it has to be applied in are different
  // questions: a Checkout that maps a customer has to run before the invoice
  // that needs the mapping.
  const parked = [...(await store.listUnattributedEvents(limit))].sort(
    (a, b) => a.created - b.created,
  );
  let applied = 0;
  let waiting = 0;
  let failed = 0;

  for (const row of parked) {
    // Stamped before the attempt, never after. A row that throws is exactly
    // the one that has to move to the back, and stamping afterwards skips
    // precisely those.
    await store.markUnattributedAttempted(row.stripeEventId, now());
    try {
      const event = JSON.parse(row.payload) as Stripe.Event;
      const outcome = await applyStripeEvent(
        store,
        event,
        undefined,
        onPurchaseReversed,
        resolveCharge,
      );
      if (outcome === 'unresolved') {
        waiting += 1;
        continue;
      }
      await store.markEventProcessed(row.stripeEventId, row.type);
      await store.dropUnattributedEvent(row.stripeEventId);
      applied += 1;
    } catch (error) {
      // Left parked on purpose. A row that throws is still money somebody
      // paid, and the next night tries it again.
      console.error('replay: parked event failed', row.stripeEventId, error);
      failed += 1;
    }
  }

  return { tried: parked.length, applied, waiting, failed };
}
