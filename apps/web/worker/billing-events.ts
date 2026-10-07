import type Stripe from 'stripe';
import type {
  AutoReloadDisabledReason,
  BillingStore,
  ClawbackCause,
  SubscriptionRecord,
} from './billing-store.ts';
import {
  AUTO_RELOAD_ATTEMPT_METADATA_KEY,
  AUTO_RELOAD_PURPOSE,
  AUTO_SUBSCRIBE_PURPOSE,
  PURPOSE_METADATA_KEY,
  SIGNUP_CARD_PURPOSE,
  TOPUP_CREDIT_USD_CENTS,
  planKeyOf,
  tierForLookupKey,
} from './stripe-client.ts';
import { grantSignupCreditForCard } from './signup-grant.ts';
import { monthKey } from './spend.ts';

/**
 * Turn a verified Stripe event into a `BillingStore` write (docs/decisions.md
 * L13). Pure and Stripe-SDK-network-free -- `Stripe` is imported only for its
 * types -- so it is testable against hand-built event fixtures and a fake
 * `BillingStore`, the same way `generation-workflow.ts`'s `runGeneration` is
 * tested against a fake `GenerationStore`.
 *
 * Dispatches on `event.type`. `invoice.payment_failed` is acknowledged and
 * not acted on: `customer.subscription.updated` already carries the status
 * change it implies (`past_due`, `unpaid`), so there is nothing further to
 * mirror. `invoice.paid` used to be treated the same way and is not any more,
 * because it is the only event that records that money actually moved, and a
 * subscription's current status cannot answer that afterwards.
 */

/**
 * Threaded through `subscription_data.metadata` and `session.metadata` at
 * Checkout Session creation (billing-checkout.ts), and read back here --
 * deliberately, so a webhook never needs a second Stripe call just to learn
 * which of our users a subscription or a top-up belongs to.
 */
const USER_ID_METADATA_KEY = 'vibld_user_id';
const CREDIT_USD_CENTS_METADATA_KEY = 'vibld_credit_usd_cents';

function customerId(
  customer: string | { id: string } | null,
): string | undefined {
  if (!customer) return undefined;
  return typeof customer === 'string' ? customer : customer.id;
}

function metadataUserId(metadata: Stripe.Metadata | null): string | undefined {
  const value = metadata?.[USER_ID_METADATA_KEY];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * What to do when an account's money has actually arrived.
 *
 * A callback rather than a store, so this module keeps knowing only about
 * Stripe and billing. The referral payout is the only caller today, and it is
 * the kind of thing that must never be able to fail a webhook delivery: see
 * where it is invoked below.
 */
export type OnPurchaseCleared = (
  userId: string,
  /**
   * Every Stripe id this payment can be recognised by later.
   *
   * Carried so a referral reward can be tied to the purchase that funded it.
   * Without it the reversal path knew only the account, so refunding an
   * unrelated later top-up took back a reward the original purchase still
   * funds. More than one because a charge names itself differently
   * depending on how it was made: a subscription charge carries its invoice,
   * a Checkout carries its payment intent, and neither carries the other.
   */
  fundedBy: string[],
) => Promise<void>;

/**
 * Called when money that had already arrived goes back out: a refund, or a
 * dispute this deployment lost.
 *
 * A separate callback rather than a branch inside this module, for the same
 * reason `OnPurchaseCleared` is one. What a reversal means for a referral is
 * the referral module's rule, and importing it here would put a payout
 * decision inside the file that reads Stripe's envelopes.
 *
 * `reason` is carried through to the ledger note, so a negative row in
 * somebody's credit history says which of the two happened rather than
 * appearing as an unexplained deduction.
 */
export type OnPurchaseReversed = (
  userId: string,
  reason: string,
  /**
   * Every Stripe id the refunded charge can be recognised by, so the reward
   * taken back is the one this payment earned. See `clawBackReferral`.
   */
  refundedIds: string[],
) => Promise<void>;

/**
 * Fetch a charge Stripe referred to by id alone.
 *
 * `charge.dispute.closed` carries `charge` as a bare id in the ordinary
 * case, and a dispute is the one reversal whose customer cannot be read off
 * the event. Without this the whole dispute path was dead: the handler
 * answered `unresolved`, the webhook marked the event processed anyway, and
 * a replayed one parked for ever because nothing would ever expand it. Lost
 * disputes never clawed anything back.
 *
 * Injected rather than reached for, because this module reads Stripe's
 * envelopes and does not call Stripe. The caller has a client; this is the
 * one question it has to ask on this module's behalf.
 */
export type ResolveCharge = (chargeId: string) => Promise<Stripe.Charge>;

/**
 * Fetch a SetupIntent with its `payment_method` expanded.
 *
 * The welcome credit is limited to one per card, and the card is known only
 * by its `fingerprint`, which lives on the PaymentMethod. Neither event that
 * reports a saved card carries it: `checkout.session.completed` names the
 * SetupIntent by id, and `setup_intent.succeeded` names the PaymentMethod by
 * id. So both ask Stripe the same one question, injected for the same reason
 * `ResolveCharge` is.
 */
export type ResolveSetupIntent = (
  setupIntentId: string,
) => Promise<Stripe.SetupIntent>;

/**
 * End a subscription in Stripe now, because the payment for its period went
 * back out. Immediately and without proration (a refund is the operator's
 * decision in Stripe, and nothing here refunds anything further).
 *
 * `already-ended` for one Stripe no longer bills, which is what makes a
 * retry, a replay and a second reversal of the same subscription safe.
 * Injected for the reason `ResolveCharge` is: this module reads Stripe's
 * envelopes and does not call Stripe.
 */
export type CancelSubscription = (
  stripeSubscriptionId: string,
) => Promise<'cancelled' | 'already-ended'>;

/**
 * The invoice a payment intent paid, and that invoice's subscription.
 *
 * The fallback for a charge whose ids match no recorded payment. On the
 * current Stripe API a charge names no invoice and an `invoice.paid` names
 * no payment intent, so for a subscription payment the two meet only in
 * Stripe's invoice payments. `null` means Stripe knows of no invoice for it.
 */
export type ResolveInvoiceOfPayment = (
  paymentIntentId: string,
) => Promise<{ invoiceId: string; subscriptionId: string | null } | null>;

/**
 * What removing what a reversed payment bought needs from outside D1
 * (docs/decisions.md, resolved 2026-09-28).
 *
 * Every member is optional so a test can supply only what it exercises. A
 * reversal that needs one that is missing answers `unresolved` rather than
 * doing half of it: parked is visible and retried, and half is neither.
 */
export interface ClawbackDeps {
  /**
   * Top-up credit this account has already spent, in micro-USD: the spend
   * ledger's `"<userId>:topup"` total, which is a Durable Object and not a
   * table. What a refund removes is floored at what is still unspent, and
   * this is the half of that floor D1 cannot see.
   */
  creditSpentMicroUsd?: (userId: string) => Promise<number>;
  cancelSubscription?: CancelSubscription;
  resolveInvoice?: ResolveInvoiceOfPayment;
}

/** Which reversal this is, carried from the event to the record. */
interface Reversal {
  cause: ClawbackCause;
  stripeEventId: string | null;
  /** Present for a dispute: its own id and amount are what get recorded. */
  dispute?: Stripe.Dispute;
}

/**
 * Whether applying an event actually wrote what the event was about.
 *
 * `unresolved` means the handler could not work out whose money this is, so
 * it wrote nothing. Reported rather than logged and dropped, because the
 * answer can change: a missed `invoice.paid` read before the older
 * `checkout.session.completed` that creates the customer mapping has nobody
 * to attribute to yet, and does once that older event has been applied. A
 * caller that records the event as handled on the strength of a normal
 * return loses the payment permanently. `billing-replay.ts` is the caller
 * that has to care.
 *
 * The webhook path ignores this and still marks the delivery processed, as
 * it did before. Failing a delivery Stripe will retry for days over an event
 * that may never resolve is a different trade, and not one this change is
 * making.
 */
export type EventOutcome = 'applied' | 'unresolved';

/**
 * Whether Stripe has actually taken the money for this session.
 *
 * `no_payment_required` is a real settled state, not an edge case to ignore:
 * a Checkout fully covered by a coupon or a credit balance completes that way
 * and owes nothing further.
 */
function isSettled(session: Stripe.Checkout.Session): boolean {
  return (
    session.payment_status === 'paid' ||
    session.payment_status === 'no_payment_required'
  );
}

async function applyCheckoutSessionCompleted(
  store: BillingStore,
  session: Stripe.Checkout.Session,
  onPurchaseCleared?: OnPurchaseCleared,
  resolveSetupIntent?: ResolveSetupIntent,
  signupCreditOpen = false,
): Promise<EventOutcome> {
  const userId =
    metadataUserId(session.metadata) ??
    session.client_reference_id ??
    undefined;
  const stripeCustomerId = customerId(session.customer);
  if (!userId || !stripeCustomerId) {
    console.error(
      'stripe checkout.session.completed with no resolvable user id',
      session.id,
    );
    return 'unresolved';
  }

  // Redundant with billing-checkout.ts's own write at Checkout creation, on
  // purpose: this event is the durable record that the checkout genuinely
  // happened, so re-asserting the link here means a failed write at
  // creation time still gets corrected once the webhook lands.
  await store.linkCustomer(userId, stripeCustomerId);

  // A card saved for the welcome credit. Nothing was sold, so nothing below
  // applies; the grant is `applyCardSaved`'s, which `setup_intent.succeeded`
  // reaches too. Either event arriving first pays, and the other is a no-op.
  if (session.mode === 'setup') {
    if (!isSignupCard(session.metadata)) return 'applied';
    return await applyCardSaved(
      store,
      idsOf(session.setup_intent)[0],
      userId,
      resolveSetupIntent,
      signupCreditOpen,
    );
  }

  // A subscription checkout is mirrored by the subscription events below.
  if (session.mode !== 'payment') return 'applied';

  // A completed Checkout is not a paid one. With a delayed payment method
  // (bank debits and the like) the session completes `unpaid` and settles
  // later, through `checkout.session.async_payment_succeeded`, or fails and
  // never settles at all. Recording the top-up on completion alone therefore
  // grants credit for money that may never arrive, and pays a referral on it.
  //
  // The settled events route back into this same function, so the top-up and
  // the payout both happen exactly once, when the money is actually there.
  if (!isSettled(session)) {
    console.log(
      JSON.stringify({
        event: 'billing.checkout.unsettled',
        session: session.id,
        paymentStatus: session.payment_status,
      }),
    );
    // Kept until it settles or fails, so auto-subscribe (D167) waits for it.
    await store.recordUnsettledTopup(
      session.id,
      userId,
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent?.id ?? null),
    );
    return 'applied';
  }

  const raw = session.metadata?.[CREDIT_USD_CENTS_METADATA_KEY];
  const creditUsdCents = raw ? Number(raw) : TOPUP_CREDIT_USD_CENTS;
  await store.recordTopup(
    session.id,
    userId,
    stripeCustomerId,
    Number.isFinite(creditUsdCents) ? creditUsdCents : TOPUP_CREDIT_USD_CENTS,
  );

  // The credit granted above and the money taken here are different numbers
  // and must not be conflated. `no_payment_required` is a settled state that
  // took nothing (a Checkout fully covered by a coupon or a credit balance),
  // and it still grants the credit the customer was promised. What it must
  // not do is earn a referral, which is why the amount is recorded and
  // `announceIfPaid` reads it rather than the fact that a top-up row exists.
  const amountUsdCents = session.amount_total ?? 0;
  // The ids computed once and used twice: recorded against the payment, and
  // handed to the payout hook. A Checkout is recorded under its session id,
  // which a refund never names, so without the aliases stored here a reward
  // this session funds can only ever be reversed by the event that paid it.
  const settledBy = idsOf(session.id, session.payment_intent);
  await store.recordPayment(
    session.id,
    userId,
    amountUsdCents,
    new Date().toISOString(),
    settledBy,
  );

  await announceIfPaid(onPurchaseCleared, userId, amountUsdCents, settledBy);
  return 'applied';
}

/** Whether a PaymentIntent is one auto-reload made (D166). */
function isAutoReload(metadata: Stripe.Metadata | null | undefined): boolean {
  return metadata?.[PURPOSE_METADATA_KEY] === AUTO_RELOAD_PURPOSE;
}

/**
 * An automatic top-up's charge went through, so credit it as a Checkout
 * top-up is credited (D166).
 *
 * Keyed on the PaymentIntent, for the top-up and the payment alike, and with
 * the charge as an alias. That is what makes a refund or a lost dispute of
 * this charge take the credit back with no new code: the charge a refund
 * names carries this PaymentIntent, `findReversedPayment` matches it, and the
 * top-up joined on the same key says it was credit that was bought.
 *
 * Called twice for one charge in the ordinary case, by the request that made
 * it and by this webhook, and every write is keyed so the second is nothing.
 */
export async function applyAutoReloadSucceeded(
  store: BillingStore,
  intent: Stripe.PaymentIntent,
  onPurchaseCleared?: OnPurchaseCleared,
): Promise<EventOutcome> {
  const userId = metadataUserId(intent.metadata);
  const stripeCustomerId = customerId(intent.customer);
  if (!userId || !stripeCustomerId) {
    console.error(
      'stripe auto-reload charge with no resolvable user',
      intent.id,
    );
    return 'unresolved';
  }
  await store.linkCustomer(userId, stripeCustomerId);
  const raw = Number(intent.metadata?.[CREDIT_USD_CENTS_METADATA_KEY]);
  await store.recordTopup(
    intent.id,
    userId,
    stripeCustomerId,
    Number.isFinite(raw) && raw > 0 ? raw : TOPUP_CREDIT_USD_CENTS,
  );
  const settledBy = idsOf(intent.id, intent.latest_charge);
  const amountUsdCents = intent.amount_received ?? 0;
  await store.recordPayment(
    intent.id,
    userId,
    amountUsdCents,
    new Date().toISOString(),
    settledBy,
  );
  const attempt = intent.metadata?.[AUTO_RELOAD_ATTEMPT_METADATA_KEY];
  if (attempt) {
    // Counted in the month Stripe made the charge, which a charge asked
    // about again after midnight on the last of the month is not the month
    // it was claimed in.
    await store.settleAutoReloadAttempt(
      attempt,
      'succeeded',
      intent.id,
      null,
      monthKey(
        Number.isFinite(intent.created) ? intent.created * 1000 : Date.now(),
      ),
    );
  }
  await announceIfPaid(onPurchaseCleared, userId, amountUsdCents, settledBy);
  return 'applied';
}

/** Why a failed automatic charge turns auto-reload off. */
export function autoReloadFailureReason(
  code: string | null | undefined,
): AutoReloadDisabledReason {
  return code === 'authentication_required'
    ? 'authentication_required'
    : 'declined';
}

/**
 * An automatic top-up's charge failed: nothing was credited, so nothing is
 * undone. Auto-reload turns itself off, and the builder says why and offers
 * the one-click top-up again (D166), rather than trying the card again.
 */
export async function applyAutoReloadFailed(
  store: BillingStore,
  intent: Stripe.PaymentIntent,
): Promise<EventOutcome> {
  const userId = metadataUserId(intent.metadata);
  if (!userId) return 'applied';
  const code =
    intent.last_payment_error?.decline_code ??
    intent.last_payment_error?.code ??
    null;
  // Only an attempt still waiting on this answer turns auto-reload off. One
  // the charge's own reply already ended was answered, and the account may
  // have turned auto-reload back on since, with another card.
  const attempt = intent.metadata?.[AUTO_RELOAD_ATTEMPT_METADATA_KEY];
  if (attempt) {
    await store.failAutoReloadAttempt(
      userId,
      attempt,
      intent.id,
      code,
      autoReloadFailureReason(intent.last_payment_error?.code),
    );
  }
  return 'applied';
}

/** Whether a Stripe object was made by the welcome-credit card flow. */
function isSignupCard(metadata: Stripe.Metadata | null | undefined): boolean {
  return metadata?.[PURPOSE_METADATA_KEY] === SIGNUP_CARD_PURPOSE;
}

/**
 * A card was saved through the welcome-credit flow, so pay the credit if the
 * card and the account are both unclaimed.
 *
 * `unresolved` for the two failures that can change: Stripe could not be
 * asked about the SetupIntent, or it answered without the card on it. The
 * webhook then answers 5xx and Stripe retries, and the replay parks it.
 * Everything else is `applied`, including a refusal: a card that already
 * paid another account will have paid it on every retry too.
 *
 * The SetupIntent is re-read rather than trusted from the event, so the
 * `setup_intent.succeeded` delivery and the Checkout one make the same
 * decision from the same object.
 */
async function applyCardSaved(
  store: BillingStore,
  setupIntentId: string | undefined,
  fallbackUserId: string | undefined,
  resolveSetupIntent?: ResolveSetupIntent,
  signupCreditOpen = false,
): Promise<EventOutcome> {
  if (!setupIntentId) {
    // A setup-mode Checkout always creates one. Nothing a retry can supply.
    console.error('stripe card-saved event with no SetupIntent');
    return 'applied';
  }
  if (!resolveSetupIntent) {
    console.error(
      'stripe card-saved event with no way to read it',
      setupIntentId,
    );
    return 'unresolved';
  }

  let intent: Stripe.SetupIntent;
  try {
    intent = await resolveSetupIntent(setupIntentId);
  } catch (error) {
    console.error('stripe SetupIntent could not be read', setupIntentId, error);
    return 'unresolved';
  }

  // Checked again on the re-read object: the Checkout session's own mark is
  // what let the event get this far, but the SetupIntent is what is paid on.
  if (!isSignupCard(intent.metadata)) return 'applied';
  if (intent.status !== 'succeeded') {
    // No card was saved. The event that says one was will come separately.
    console.log(
      JSON.stringify({
        event: 'billing.signup_card.unsettled',
        setupIntent: intent.id,
        status: intent.status,
      }),
    );
    return 'applied';
  }

  const userId = metadataUserId(intent.metadata) ?? fallbackUserId;
  if (!userId) {
    console.error('stripe SetupIntent with no resolvable user id', intent.id);
    return 'unresolved';
  }

  const method = intent.payment_method;
  if (method === null || typeof method === 'string') {
    // The resolver did not expand it, which is a bug on this side, and
    // retrying with the bug fixed would find the card.
    console.error('stripe SetupIntent read without its card', intent.id);
    return 'unresolved';
  }
  const fingerprint = method.type === 'card' ? method.card?.fingerprint : null;
  if (!fingerprint) {
    // Card-only Checkout makes this unreachable in practice. Without a
    // fingerprint the once-per-card limit cannot hold, so nothing is paid.
    console.error('stripe saved payment method has no card fingerprint', {
      setupIntent: intent.id,
      type: method.type,
    });
    return 'applied';
  }

  const stripeCustomerId = customerId(intent.customer);
  if (stripeCustomerId) await store.linkCustomer(userId, stripeCustomerId);

  const { outcome, paid } = await grantSignupCreditForCard(store, {
    userId,
    setupIntentId: intent.id,
    cardFingerprint: fingerprint,
    offerOpen: signupCreditOpen,
  });
  // The fingerprint is left out on purpose: it identifies a card across
  // every Stripe account that has seen it, and the outcome says enough.
  console.log(
    JSON.stringify({
      event: 'billing.signup_card',
      userId,
      setupIntent: intent.id,
      outcome,
      paid,
    }),
  );
  return 'applied';
}

/**
 * Run the purchase hook, and let a failure fail the delivery.
 *
 * This used to swallow the error, on the reasoning that a reward bug should
 * not look like a billing outage and that a later delivery would recover it.
 * The second half was false. `handleStripeWebhook` records the event as
 * processed once this returns, and Stripe's redelivery then exits at that
 * check, so a swallowed failure meant a payout that was owed and would never
 * be attempted again. Half a payout, too: the referrer's credit could land
 * and the referred account's not.
 *
 * Failing is the cheaper half of the trade. The top-up above is already
 * written and is keyed on the checkout session, so the redelivery Stripe
 * makes re-runs it as a no-op and the customer's own credit is never at
 * stake; what is red is a webhook delivery, which is a thing somebody should
 * be told about. A reward silently not paid is not.
 */
async function announceIfPaid(
  hook: OnPurchaseCleared | undefined,
  userId: string,
  amountUsdCents: number,
  fundedBy: string[] = [],
): Promise<void> {
  // The gate, in the one place every announce goes through. A settlement
  // that took nothing is not a purchase, however settled Stripe considers
  // it, and this is the same question `CLEARED_PAYMENT_SQL` asks of the
  // recorded row: the immediate path and the recovery sweep must not be able
  // to disagree about who has paid.
  if (amountUsdCents <= 0) return;
  if (!hook) return;
  await hook(userId, fundedBy);
}

/**
 * The mirror row a Stripe subscription maps to, given who it belongs to.
 * Pure and reused by `reconcileSubscriptions` (billing-handlers.ts) as well
 * as the webhook path below, so the two can never disagree about what a
 * subscription object means.
 *
 * `undefined` for a subscription this deployment cannot make sense of (no
 * customer, no recognised price) -- the caller decides what that means for
 * it (skip a webhook event, or leave a reconciled row alone).
 */
export function subscriptionRecordFrom(
  subscription: Stripe.Subscription,
  userId: string | undefined,
): SubscriptionRecord | undefined {
  const stripeCustomerId = customerId(subscription.customer);
  if (!stripeCustomerId || !userId) return undefined;

  const item = subscription.items.data[0];
  const price = item?.price;
  const tier = tierForLookupKey(price ? planKeyOf(price) : null);
  if (!item || !price || !tier) return undefined;

  return {
    stripeSubscriptionId: subscription.id,
    userId,
    stripeCustomerId,
    tier,
    status: subscription.status,
    priceId: price.id,
    currentPeriodEnd: new Date(item.current_period_end * 1000).toISOString(),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };
}

/**
 * Who a subscription belongs to, from the subscription alone.
 *
 * Its own metadata first, then the customer mapping this deployment owns.
 * Exported because the nightly reconcile needs exactly this: a subscription
 * Stripe reports that was never mirrored has no local row to read a user id
 * from, which is the whole reason it was missed.
 */
export async function ownerOfSubscription(
  store: BillingStore,
  subscription: Stripe.Subscription,
): Promise<string | undefined> {
  const stripeCustomerId = customerId(subscription.customer);
  return (
    metadataUserId(subscription.metadata) ??
    (stripeCustomerId
      ? await store.findUserIdForCustomer(stripeCustomerId)
      : undefined)
  );
}

/**
 * Mirror a subscription's state. It does not announce a purchase.
 *
 * It used to, on `status === 'active'`, and that was the wrong question. A
 * status is not a charge: a subscription covered in full by a coupon, or one
 * whose first invoice is zero, reads `active` having taken nothing, and the
 * announce paid a referral for it. `invoice.paid` is the event that says
 * money moved and it carries the amount, so the announce belongs there and
 * nowhere else.
 *
 * If that delivery never arrives, the nightly reconcile reads the paid
 * invoices back from Stripe itself and records them, so the payout is late
 * rather than lost. That is the trade, taken deliberately: a referral credit
 * a day late costs nothing, and one paid on a charge that never happened is
 * a way to farm the offer for free.
 */
async function applySubscriptionEvent(
  store: BillingStore,
  subscription: Stripe.Subscription,
): Promise<EventOutcome> {
  const userId = await ownerOfSubscription(store, subscription);

  const record = subscriptionRecordFrom(subscription, userId);
  if (!record) {
    console.error(
      'stripe subscription event this deployment cannot resolve',
      subscription.id,
      subscription.items.data[0]?.price?.id,
    );
    return 'unresolved';
  }

  await store.upsertSubscription(record);
  // A plan auto-subscribe started (D167) has done the one thing it does:
  // the setting turns itself off saying so, if the reply to the request
  // that started it has not already.
  if (
    record.userId &&
    isAutoSubscribe(subscription.metadata) &&
    (subscription.status === 'active' || subscription.status === 'trialing')
  ) {
    await store.settleAutoSubscribed(record.userId, subscription.id);
  }
  return 'applied';
}

/** Whether a Stripe subscription was started by auto-subscribe (D167). */
function isAutoSubscribe(
  metadata: Stripe.Metadata | null | undefined,
): boolean {
  return metadata?.[PURPOSE_METADATA_KEY] === AUTO_SUBSCRIBE_PURPOSE;
}

/**
 * What this invoice charged through Stripe, in USD cents.
 *
 * Deliberately not "what Stripe collected", which is a larger claim than
 * this makes. A refund or a lost dispute returns money afterwards without
 * moving `amount_paid`, and nothing here reads either, so this is what was
 * charged at the time and not a current balance. Netting reversals is
 * tracked separately; treating this number as one would be wrong.
 *
 * Not `amount_paid` either, which is the wrong number twice over. It counts money
 * that never moved through Stripe: an invoice marked paid out of band (a
 * bank transfer, a cheque, a cash payment recorded by hand) reports the full
 * `amount_paid` with `amount_paid_off_stripe` carrying the part Stripe never
 * saw. And a zero-amount invoice is `paid` in Stripe's sense having taken
 * nothing at all, which a trial and a full coupon both produce.
 *
 * Subtracting leaves only what Stripe itself put through a card, which is
 * the conservative direction on a rule that hands out credit and the same
 * one the purchase barrier takes.
 *
 * **This is a product decision, not just a safety one, and it is reversible
 * in one line.** Vibld has no out-of-band invoicing today, so today this
 * changes nothing. If it ever bills an enterprise customer by bank transfer,
 * that customer really has bought something, and whether their referrer gets
 * paid is a question about the offer rather than about Stripe. Drop the
 * subtraction to say yes.
 */
export function stripeCollectedUsdCents(invoice: Stripe.Invoice): number {
  return invoice.amount_paid - (invoice.amount_paid_off_stripe ?? 0);
}

/**
 * An invoice that was actually paid.
 *
 * This event was acknowledged and discarded, on the reasoning that
 * `customer.subscription.updated` already carries whatever status change an
 * invoice implies. That is true about the status and false about the history,
 * and the difference cost a payout: a subscriber whose first subscription
 * event was missed and who then cancelled reads as `canceled` for ever, so
 * nothing downstream could tell they had ever paid.
 *
 * It is the only event that says money moved, so it is now the durable record
 * that it did, and it announces the purchase itself. Announcing on every
 * paid invoice rather than only the first is safe and deliberate: the payout
 * is idempotent per referred account, so the second invoice is a no-op and
 * the first one nobody delivered is recovered by the next.
 */
async function applyInvoicePaid(
  store: BillingStore,
  invoice: Stripe.Invoice,
  onPurchaseCleared?: OnPurchaseCleared,
): Promise<EventOutcome> {
  const stripeCustomerId = customerId(invoice.customer);
  const userId =
    metadataUserId(invoice.metadata ?? null) ??
    (stripeCustomerId
      ? await store.findUserIdForCustomer(stripeCustomerId)
      : undefined);

  // No resolvable owner means there is nobody to record the payment against.
  // Logged rather than swallowed: an invoice this deployment cannot
  // attribute is a mirror that has drifted from Stripe, not a normal event.
  if (!userId) {
    console.error('stripe invoice.paid with no resolvable user id', invoice.id);
    return 'unresolved';
  }

  // Recorded against the user and keyed on the invoice, not hung off the
  // subscription row. `invoice.paid` can arrive before
  // `customer.subscription.created`, and an UPDATE against a row that does
  // not exist yet changes nothing and reports nothing, which is how a real
  // payment could go unrecorded for ever.
  //
  const amountUsdCents = stripeCollectedUsdCents(invoice);
  const settledBy = invoicePaymentIds(invoice);
  await store.recordPayment(
    invoice.id ?? `invoice-unknown-${userId}`,
    userId,
    amountUsdCents,
    new Date().toISOString(),
    settledBy,
    subscriptionOfInvoice(invoice),
  );

  await announceIfPaid(onPurchaseCleared, userId, amountUsdCents, settledBy);
  return 'applied';
}

/**
 * The ids among these that are usable, as strings.
 *
 * Stripe hands an expandable field back as an id, as the expanded object, or
 * as null, and which one depends on the caller and the API version. Reading
 * `.id` off a string or a null is how a plain read here becomes a throw in a
 * handler that has already written a payment row.
 */
export function idsOf(...values: unknown[]): string[] {
  const ids: string[] = [];
  for (const value of values) {
    if (typeof value === 'string' && value !== '') ids.push(value);
    else if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { id?: unknown }).id === 'string'
    ) {
      ids.push((value as { id: string }).id);
    }
  }
  return ids;
}

/**
 * Every id a paid invoice can be recognised by when a refund names it.
 *
 * Read in both shapes Stripe has sent. An invoice from an older API version
 * carries `payment_intent` and `charge` itself; a current one carries
 * neither and lists its payments under `payments`, which Stripe includes
 * only when asked. Whatever is present is recorded, and a refund that still
 * matches nothing is tied back through `ResolveInvoiceOfPayment` instead.
 */
export function invoicePaymentIds(invoice: Stripe.Invoice): string[] {
  const loose = invoice as unknown as {
    payment_intent?: unknown;
    charge?: unknown;
    payments?: { data?: unknown };
  };
  const listed = Array.isArray(loose.payments?.data) ? loose.payments.data : [];
  return [
    ...new Set(
      idsOf(
        invoice.id,
        loose.payment_intent,
        loose.charge,
        ...listed.flatMap((entry) => {
          const payment = (
            entry as {
              payment?: { payment_intent?: unknown; charge?: unknown };
            }
          )?.payment;
          return [payment?.payment_intent, payment?.charge];
        }),
      ),
    ),
  ];
}

/**
 * The subscription an invoice paid for, or null for one that paid for none.
 *
 * `parent.subscription_details.subscription` on the current API and a
 * top-level `subscription` on older ones, as an id or an expanded object.
 */
export function subscriptionOfInvoice(invoice: Stripe.Invoice): string | null {
  const loose = invoice as unknown as {
    subscription?: unknown;
    parent?: {
      subscription_details?: { subscription?: unknown } | null;
    } | null;
  };
  return (
    idsOf(
      loose.parent?.subscription_details?.subscription,
      loose.subscription,
    )[0] ?? null
  );
}

export async function applyStripeEvent(
  store: BillingStore,
  event: Stripe.Event,
  onPurchaseCleared?: OnPurchaseCleared,
  onPurchaseReversed?: OnPurchaseReversed,
  resolveCharge?: ResolveCharge,
  resolveSetupIntent?: ResolveSetupIntent,
  /**
   * What removing what a reversed payment bought needs beyond the store.
   * Absent means the caller is not asking for that, the same way an absent
   * `onPurchaseReversed` means it is not asking about referrals; every path
   * that applies real events passes it (the webhook, the replay and the
   * parked retry).
   */
  clawback?: ClawbackDeps,
  /**
   * Whether this deployment still offers the welcome credit
   * (`signupCreditCents(env) > 0`). Asked here, on the webhook, because a
   * card form opened while it was offered can be submitted after it was
   * switched off (D163). Absent means off, the default since D163.
   */
  signupCreditOpen = false,
): Promise<EventOutcome> {
  switch (event.type) {
    case 'checkout.session.completed':
    // The delayed-payment settlement of a session that completed unpaid. Same
    // handler, because it checks `payment_status` itself: the delivery that
    // arrived unpaid did nothing, and this one does the work.
    case 'checkout.session.async_payment_succeeded':
      return await applyCheckoutSessionCompleted(
        store,
        event.data.object,
        onPurchaseCleared,
        resolveSetupIntent,
        signupCreditOpen,
      );
    case 'setup_intent.succeeded':
      // Every saved card fires this, the Billing Portal's included, so the
      // mark is checked before Stripe is asked anything.
      if (!isSignupCard(event.data.object.metadata)) return 'applied';
      return await applyCardSaved(
        store,
        event.data.object.id,
        undefined,
        resolveSetupIntent,
        signupCreditOpen,
      );
    case 'payment_intent.succeeded':
      // Every charge fires this, a Checkout top-up's and an invoice's too,
      // so the mark is checked before anything is written: only the charges
      // auto-reload made are credited here (D166).
      if (!isAutoReload(event.data.object.metadata)) return 'applied';
      return await applyAutoReloadSucceeded(
        store,
        event.data.object,
        onPurchaseCleared,
      );
    case 'payment_intent.payment_failed':
      if (!isAutoReload(event.data.object.metadata)) return 'applied';
      return await applyAutoReloadFailed(store, event.data.object);
    case 'checkout.session.async_payment_failed':
      // Nothing to undo, which is the whole reason the grant is gated on
      // `payment_status` rather than on the session having completed. Only
      // the marker auto-subscribe waits on goes (D167).
      await store.dropUnsettledTopup(event.data.object.id);
      return 'applied';
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return await applySubscriptionEvent(store, event.data.object);
    case 'invoice.paid':
      return await applyInvoicePaid(
        store,
        event.data.object,
        onPurchaseCleared,
      );
    case 'invoice.payment_failed':
      // See the module comment: no separate mirror yet, only acknowledged.
      return 'applied';
    case 'charge.refunded':
      return await applyChargeReversed(
        store,
        event.data.object,
        { cause: 'refund', stripeEventId: event.id ?? null },
        'Referral reversed: the payment was refunded.',
        onPurchaseReversed,
        resolveCharge,
        clawback,
      );
    case 'charge.dispute.closed':
      // Only a dispute that was lost took the money back. A won dispute
      // means it stayed, and clawing back on `dispute.created` instead would
      // mean re-crediting everybody whose dispute this deployment wins. The
      // same holds for what the payment bought: a won or withdrawn dispute
      // removes nothing and suspends nobody.
      if (event.data.object.status !== 'lost') return 'applied';
      return await applyChargeReversed(
        store,
        event.data.object.charge,
        {
          cause: 'dispute',
          stripeEventId: event.id ?? null,
          dispute: event.data.object,
        },
        'Referral reversed: the dispute was lost.',
        onPurchaseReversed,
        resolveCharge,
        clawback,
      );
    default:
      // Every type here is one this deployment asked Stripe for
      // (`scripts/configure-accounts.mjs` sets the webhook endpoint's
      // `enabled_events`, and its test reads this switch), so reaching this
      // branch means the endpoint's own subscription list drifted from this
      // switch -- worth knowing about, not worth failing the delivery over.
      console.error('unhandled stripe webhook event type', event.type);
      // Applied in the sense that matters to a caller deciding whether to
      // come back: nothing here can write it, and reading it again would
      // reach this same branch.
      return 'applied';
  }
}

/**
 * Money that had arrived has gone back out, so tell the caller whose it was.
 *
 * Nothing about the payment row is rewritten here. `recordPayment`'s own
 * comment already says what it records is what was charged at the time and
 * not a current balance, and changing that now would move a number three
 * other places read as "they have paid at some point", which is still true
 * of somebody who was refunded.
 *
 * Two things must not survive a reversal. Credit handed out because the
 * money arrived (a referral reward) is the callback's business. What the
 * money bought (top-up credit, a plan) is `clawBackPurchase`'s, which
 * records what it removed in a table of its own rather than in the payment
 * row, for the reason above.
 *
 * `unresolved` rather than `applied` when the customer cannot be mapped to
 * an account: a refund read before the `checkout.session.completed` that
 * creates the mapping has nobody to attribute to yet, and will have once
 * that older event lands. Reporting it applied loses the reversal for good.
 */
async function applyChargeReversed(
  store: BillingStore,
  charge: Stripe.Charge | string,
  reversal: Reversal,
  reason: string,
  onPurchaseReversed?: OnPurchaseReversed,
  resolveCharge?: ResolveCharge,
  clawback?: ClawbackDeps,
): Promise<EventOutcome> {
  // A dispute carries its charge as a bare id in the ordinary case, and the
  // customer is only on the charge. This module does not call Stripe, so the
  // caller supplies the one lookup; without it the dispute path answered
  // `unresolved` for every real delivery and nothing ever clawed back.
  let resolved: Stripe.Charge;
  if (typeof charge === 'string') {
    if (!resolveCharge) {
      console.error('stripe reversal with no way to read the charge', charge);
      return 'unresolved';
    }
    try {
      resolved = await resolveCharge(charge);
    } catch (error) {
      // Not `applied`: Stripe was asked and could not answer, so this is
      // still owed. Marking it done here is how a lost dispute keeps its
      // reward for ever.
      console.error('stripe reversal could not read the charge', charge, error);
      return 'unresolved';
    }
  } else {
    resolved = charge;
  }

  const stripeCustomerId = customerId(resolved.customer);
  if (!stripeCustomerId) {
    console.error('stripe reversal with no customer', resolved.id);
    return 'unresolved';
  }

  const userId = await store.findUserIdForCustomer(stripeCustomerId);
  if (!userId) {
    console.error('stripe reversal for an unmapped customer', resolved.id);
    return 'unresolved';
  }

  if (onPurchaseReversed) {
    try {
      await onPurchaseReversed(
        userId,
        reason,
        idsOf(
          resolved.id,
          (resolved as unknown as { invoice?: unknown }).invoice,
          (resolved as unknown as { payment_intent?: unknown }).payment_intent,
        ),
      );
    } catch (error) {
      // Not `applied`. The clawback is the entire work of this event, so an
      // event marked done on a failed one is credit this deployment paid for
      // with nothing left to come back to it. `unresolved` is what the
      // callers already have machinery for: the replay parks it and retries,
      // and the webhook answers retryably rather than 200.
      console.error('stripe reversal could not be applied', userId, error);
      return 'unresolved';
    }
  }

  // After the referral, not before: the referral path is idempotent and
  // already written this way, and a clawback that parks the event (below)
  // brings the whole delivery back, the referral with it, as a no-op.
  if (!clawback) return 'applied';
  return await clawBackPurchase(store, userId, resolved, reversal, clawback);
}

/**
 * Remove what a refunded or disputed payment bought (Chris, 2026-09-28).
 *
 * The payment is found from the charge through the ids recorded when it
 * settled, and only among the account's own payments. What it bought decides
 * the rest:
 *
 * - **A top-up** loses the refunded or disputed share of its credit, floored
 *   at what the account has not spent. The rest is recorded as a shortfall,
 *   never as a debt.
 * - **A subscription payment** ends the subscription, full refund, partial
 *   refund or lost dispute alike. A partial refund is how an operator gives
 *   an annual plan its prorated cancellation, so it is a cancellation: the
 *   allowance stops now, in D1 first and then in Stripe, with no further
 *   proration.
 * - **A lost dispute**, whichever it was, also suspends the account until an
 *   operator lifts it.
 *
 * All of it is one row in `billing_clawbacks`, keyed so every retry lands on
 * the same row. Cancelling in Stripe is not in D1 and is asked every time
 * the event is applied; it is idempotent on Stripe's side (`already-ended`),
 * so a retry after a failed cancel does the one thing that is still owed.
 *
 * `unresolved` whenever the work cannot be done in full, which parks the
 * event exactly as an unattributed payment is parked: a charge that matches
 * no recorded payment (the replay descends newest first, so a refund can be
 * read before the purchase it refunds), Stripe not answering, or a
 * dependency the caller did not supply. Nothing is removed on a guess.
 */
async function clawBackPurchase(
  store: BillingStore,
  userId: string,
  charge: Stripe.Charge,
  reversal: Reversal,
  deps: ClawbackDeps,
): Promise<EventOutcome> {
  const loose = charge as unknown as {
    invoice?: unknown;
    amount?: unknown;
    amount_refunded?: unknown;
    refunded?: unknown;
  };
  const paymentIntentId = idsOf(
    charge.payment_intent,
    reversal.dispute?.payment_intent,
  )[0];
  let payment = await store.findReversedPayment(
    userId,
    idsOf(charge.id, loose.invoice, charge.payment_intent, paymentIntentId),
  );

  // The one Stripe question, asked only when the recorded ids were not
  // enough. On the current API a subscription charge and its `invoice.paid`
  // share no id at all, so without this every subscription refund would
  // park for ever. The answer is still matched against the payments this
  // deployment recorded, so it can find a payment and never invent one.
  let asked: { invoiceId: string; subscriptionId: string | null } | null = null;
  let askedAlready = false;
  const askStripe = async (): Promise<boolean> => {
    if (askedAlready || !paymentIntentId || !deps.resolveInvoice) return true;
    askedAlready = true;
    try {
      asked = await deps.resolveInvoice(paymentIntentId);
      return true;
    } catch (error) {
      console.error(
        'clawback: the invoice could not be read',
        charge.id,
        error,
      );
      return false;
    }
  };

  if (!payment) {
    if (!(await askStripe())) return 'unresolved';
    const invoiceId = (asked as { invoiceId: string } | null)?.invoiceId;
    if (invoiceId)
      payment = await store.findReversedPayment(userId, [invoiceId]);
  }
  if (!payment) {
    console.error(
      JSON.stringify({
        event: 'billing.clawback_unattributed',
        userId,
        cause: reversal.cause,
        charge: charge.id,
      }),
    );
    return 'unresolved';
  }

  const kind = payment.topup ? 'topup' : 'subscription';
  let subscriptionId: string | null = null;
  if (kind === 'subscription') {
    subscriptionId = payment.stripeSubscriptionId;
    if (!subscriptionId) {
      if (!(await askStripe())) return 'unresolved';
      subscriptionId =
        (asked as { subscriptionId: string | null } | null)?.subscriptionId ??
        null;
    }
    if (!subscriptionId) {
      // A payment that is neither a top-up nor tied to a subscription is not
      // one this deployment sells, so there is nothing it could safely end.
      console.error(
        JSON.stringify({
          event: 'billing.clawback_no_subscription',
          userId,
          charge: charge.id,
          payment: payment.stripeObjectId,
        }),
      );
      return 'unresolved';
    }
    if (!deps.cancelSubscription) {
      console.error('clawback: no way to cancel the subscription', charge.id);
      return 'unresolved';
    }
  }

  let spentCents = 0;
  if (kind === 'topup') {
    if (!deps.creditSpentMicroUsd) {
      console.error('clawback: no way to read what was spent', charge.id);
      return 'unresolved';
    }
    try {
      // Rounded up: a part-cent already spent is spent, and the floor errs
      // towards leaving credit rather than taking it.
      spentCents = Math.ceil((await deps.creditSpentMicroUsd(userId)) / 10_000);
    } catch (error) {
      console.error('clawback: the spend ledger could not be read', error);
      return 'unresolved';
    }
  }

  // Stripe states both in the charge's own currency, which is USD for
  // everything this deployment sells. A charge that somehow lacks them falls
  // back to what was recorded when it settled, and to nothing reversed, so a
  // missing field removes less rather than more.
  const chargeUsdCents =
    typeof loose.amount === 'number' ? loose.amount : payment.amountUsdCents;
  const reversedUsdCents =
    reversal.cause === 'dispute'
      ? typeof reversal.dispute?.amount === 'number'
        ? reversal.dispute.amount
        : chargeUsdCents
      : typeof loose.amount_refunded === 'number'
        ? loose.amount_refunded
        : loose.refunded === true
          ? chargeUsdCents
          : 0;

  const recorded = await store.recordClawback({
    id:
      reversal.cause === 'dispute'
        ? `dispute:${reversal.dispute?.id ?? charge.id}`
        : `refund:${charge.id}:${reversedUsdCents}`,
    userId,
    cause: reversal.cause,
    stripeEventId: reversal.stripeEventId,
    stripeChargeId: charge.id,
    stripeObjectId: payment.stripeObjectId,
    kind,
    chargeUsdCents,
    reversedUsdCents,
    creditUsdCents: payment.topup?.creditUsdCents ?? 0,
    creditGrantedAt: payment.topup?.createdAt ?? null,
    stripeSubscriptionId: subscriptionId,
    suspends: reversal.cause === 'dispute',
    spentCents,
  });

  // After the row, so the allowance has already stopped by the time Stripe
  // is asked, and stays stopped if Stripe has to be asked again tomorrow.
  let stripe: 'cancelled' | 'already-ended' | undefined;
  if (subscriptionId && deps.cancelSubscription) {
    try {
      stripe = await deps.cancelSubscription(subscriptionId);
    } catch (error) {
      console.error(
        'clawback: the subscription could not be canceled',
        subscriptionId,
        error,
      );
      return 'unresolved';
    }
  }

  // The row is the record an operator reads; this is for a live tail.
  console.log(
    JSON.stringify({
      event: 'billing.clawback',
      userId,
      cause: reversal.cause,
      kind,
      charge: charge.id,
      payment: payment.stripeObjectId,
      reversedUsdCents,
      creditRemovedUsdCents: recorded?.creditRemovedUsdCents ?? 0,
      creditShortfallUsdCents: recorded?.creditShortfallUsdCents ?? 0,
      subscription: subscriptionId,
      stripe,
      suspended: reversal.cause === 'dispute',
      alreadyRecorded: recorded === null,
    }),
  );
  return 'applied';
}
