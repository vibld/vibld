/**
 * What the parked-payment queue looks like on screen (#46).
 *
 * Separated from the component for the reason `github/panel-view.ts` gives:
 * the interesting part is the wording, and wording tested through a rendered
 * tree is tested through two things at once. Nothing here touches React.
 *
 * The queue is money Stripe says moved that this deployment cannot yet put a
 * name to (`0010_unattributed_events.sql`). Nothing here has been credited to
 * anybody, and the copy has to keep saying so: an operator reading "3 parked"
 * as "3 payments lost" would go looking for a refund to issue, and reading it
 * as "3 payments handled" would stop looking at all.
 */

export interface ParkedPayment {
  stripeEventId: string;
  type: string;
  created: number;
  firstSeenAt: string;
  attempts: number;
  customerId?: string;
  amountCents?: number;
  currency?: string;
}

export interface ParkedQueue {
  parked: number;
  oldestFirstSeenAt: string | null;
  oldestCreated: number | null;
  events: ParkedPayment[];
}

export interface ParkedRow {
  stripeEventId: string;
  /** "invoice.paid", as Stripe names it: the operator will search for this. */
  type: string;
  /** "$19.99", or "amount unknown" when the event carried none. */
  amount: string;
  /** The Stripe customer, or "no customer on the event". */
  customer: string;
  attempts: string;
  waiting: string;
}

export interface ParkedQueueView {
  /** One line an operator can read without opening anything. */
  headline: string;
  /**
   * Whether this is worth acting on now. The queue existing is normal: an
   * event can park at 3am and resolve at 3:01. A queue that is *old* is the
   * signal, because it means the nightly retry has stopped resolving things.
   */
  tone: 'quiet' | 'watch' | 'stale';
  /** Present only when there is something to explain. */
  note?: string;
  rows: ParkedRow[];
  /** True when the count exceeds the rows shown, so the table does not lie. */
  truncated: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long something has been waiting, in words.
 *
 * Days and hours only. A queue measured in minutes is a queue working
 * normally, and putting a precise duration on screen invites reading it as
 * precision about the payment, which this is not: it is how long we have
 * been unable to name it.
 */
export function waitedFor(since: string, now: number): string {
  const started = Date.parse(since);
  if (Number.isNaN(started)) return 'unknown';
  const elapsed = Math.max(0, now - started);
  const days = Math.floor(elapsed / DAY_MS);
  if (days >= 1) return days === 1 ? '1 day' : `${days} days`;
  const hours = Math.floor(elapsed / (60 * 60 * 1000));
  if (hours >= 1) return hours === 1 ? '1 hour' : `${hours} hours`;
  return 'under an hour';
}

function money(row: ParkedPayment): string {
  if (typeof row.amountCents !== 'number') return 'amount unknown';
  const currency = (row.currency ?? 'usd').toUpperCase();
  const amount = (row.amountCents / 100).toFixed(2);
  return currency === 'USD' ? `$${amount}` : `${amount} ${currency}`;
}

/**
 * Two days, because the retry runs nightly.
 *
 * One night failing to resolve something is the system working: the mapping
 * it needs may simply not have arrived yet. Two nights means the retry has
 * had two goes and got nowhere, which is when a person should look.
 */
const STALE_DAYS = 2;

export function parkedQueueView(
  queue: ParkedQueue,
  now: number = Date.now(),
): ParkedQueueView {
  if (queue.parked === 0) {
    return {
      headline: 'No payments waiting to be attributed.',
      tone: 'quiet',
      rows: [],
      truncated: false,
    };
  }

  const payments = queue.parked === 1 ? 'payment' : 'payments';
  const waited =
    queue.oldestFirstSeenAt === null
      ? null
      : waitedFor(queue.oldestFirstSeenAt, now);
  const oldestMs =
    queue.oldestFirstSeenAt === null
      ? 0
      : now - Date.parse(queue.oldestFirstSeenAt);
  const stale = oldestMs >= STALE_DAYS * DAY_MS;

  return {
    headline:
      waited === null
        ? `${queue.parked} ${payments} waiting to be attributed.`
        : `${queue.parked} ${payments} waiting to be attributed, the oldest for ${waited}.`,
    tone: stale ? 'stale' : 'watch',
    // Said on the screen rather than left to be inferred, because both wrong
    // readings of a queue like this are expensive.
    note: stale
      ? 'The nightly retry has had more than one attempt at the oldest of these and has not resolved it. Nothing here has been credited to anybody.'
      : 'These usually clear on the next nightly retry. Nothing here has been credited to anybody.',
    rows: queue.events.map((row) => ({
      stripeEventId: row.stripeEventId,
      type: row.type,
      amount: money(row),
      customer: row.customerId ?? 'no customer on the event',
      attempts: row.attempts === 1 ? '1 attempt' : `${row.attempts} attempts`,
      waiting: waitedFor(row.firstSeenAt, now),
    })),
    truncated: queue.parked > queue.events.length,
  };
}
