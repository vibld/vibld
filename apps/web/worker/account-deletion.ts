/**
 * Self-serve account deletion (docs/decisions.md L32): what happens the
 * moment somebody asks, what the nightly pass retries, and the purge 30
 * days later.
 *
 * Three moments, one record (`0031_account_deletions.sql`):
 *
 * 1. **The request.** The row is written first and on its own, because it is
 *    the part that has to land: from that write on, every authenticated
 *    request from the account is refused (`principal.ts`). Then each
 *    immediate step is attempted, and each one that fails is left for later
 *    rather than failing the request.
 * 2. **The retries.** Every step is idempotent and marked done only once it
 *    is established, so asking again (the person pressing the button again,
 *    or the nightly pass) finishes whatever did not happen the first time.
 * 3. **The purge.** Once the 30 days are up and every immediate step is done,
 *    the account's data is deleted in steps, each idempotent, with the
 *    position saved after each so a night that runs out of allowance resumes
 *    where it stopped.
 *
 * The retries and the purge run in the nightly pass (`scheduled` in
 * `index.ts`), inside the same D1 allowance as the billing pass. How much
 * of it they get is `planNight` in `billing-replay.ts`: nothing on a night
 * with nothing waiting, a turn in the rotation on an allowance that
 * rotates, and a share of its own on one large enough to split.
 *
 * **One step the nightly pass does not take.** Taking a site off the web
 * from a cron is exactly what ADR-0013 and `publish-authorisation.test.ts`
 * forbid: nothing automated may reach the takedown path. So the site is
 * taken down while the person is asking, through the owner's own takedown
 * route, and if that fails the retry is the person asking again or an
 * operator's hold. The nightly pass only checks whether the site is down,
 * and the purge will not start while one is still serving. The operator's
 * panel lists any that are.
 */
import { mediaObjectKey } from '@vibld/core';

import {
  AccountDeletionStore,
  IMMEDIATE_STEPS,
  immediateStepsDone,
} from './account-deletion-store.ts';
import type {
  DeletionRecord,
  ImmediateStep,
} from './account-deletion-store.ts';
import { BILLABLE_STATUSES, BillingStore } from './billing-store.ts';
import { clerkLookupConfigured } from './clerk-lookup.ts';
import type { ClerkLookupEnv } from './clerk-lookup.ts';
import { GitHubStore } from './github-store.ts';
import { previewConfigured, stopPreview } from './preview-client.ts';
import type { PreviewServiceEnv, ServiceOutcome } from './preview-client.ts';
import { topupKeyFor } from './reserve.ts';
import { sharePreviewKey } from './share-link.ts';
import { createStripeClient, stripeConfigured } from './stripe-client.ts';
import type { StripeEnv } from './stripe-client.ts';
import {
  R2_PAGES_PER_STEP,
  assertPrefixSafe,
  deletePrefix,
} from './storage-purge.ts';
import type { PurgeBucket } from './storage-purge.ts';

// Where they have always been imported from. The functions moved to
// `storage-purge.ts` when deleting one project needed them too.
export { R2_PAGES_PER_STEP };
export type { PurgeBucket };

/**
 * The phrase a person types to confirm. Checked here as well as in the
 * builder, so a script or a stray request cannot delete an account by
 * posting to the route without it. `src/account/deletion-client.ts` carries
 * the same string, and `account-deletion.test.ts` holds the two equal.
 */
export const CONFIRMATION_PHRASE = 'delete my account';

/**
 * The slice of Stripe these steps call.
 *
 * Narrow so a test can hand in something that records what it was asked,
 * the same seam `access-billing.ts` uses with `makeStripe`.
 */
export interface StripeSubscriptions {
  subscriptions: {
    list(params: {
      customer: string;
      status: 'all';
      limit: number;
    }): PromiseLike<{ data: { id: string; status: string }[] }>;
    cancel(
      id: string,
      params: { invoice_now: boolean; prorate: boolean },
    ): PromiseLike<unknown>;
  };
}

export type ClerkDeletion = { ok: true } | { ok: false; error: string };

export interface DeletionDeps {
  store: AccountDeletionStore;
  billing: BillingStore;
  github: GitHubStore;
  /** Null when this deployment has no Stripe. */
  stripe: StripeSubscriptions | null;
  /** Null when this deployment has no preview service. */
  stopPreview: ((userId: string) => Promise<ServiceOutcome>) | null;
  /** Null when this deployment has no R2 bucket, so nothing was stored. */
  bucket: PurgeBucket | null;
  /** The spend ledger's Durable Objects, by name. Null when unbound. */
  ledger: ((name: string) => { forget(): Promise<void> }) | null;
  deleteClerkUser: (userId: string) => Promise<ClerkDeletion>;
  now: () => Date;
}

export interface DeletionEnv
  extends StripeEnv, PreviewServiceEnv, ClerkLookupEnv {
  DB?: D1Database;
  PROJECT_CONTENT?: R2Bucket;
  USER_BUDGET?: DurableObjectNamespace<{ forget(): void }>;
}

/** Whether this deployment can record a deletion at all. */
export function accountDeletionConfigured(env: { DB?: D1Database }): boolean {
  return Boolean(env.DB);
}

/**
 * Delete the Clerk user (Backend API `DELETE /v1/users/{id}`), with the
 * `CLERK_SECRET_KEY` the Worker already holds for the admin tools.
 *
 * Raw `fetch`, for the reason `clerk-lookup.ts` gives. A 404 is success:
 * the user being gone is what was asked for, and it is what a retry after a
 * lost reply finds.
 *
 * Not verified against a live call from this environment: there is no
 * Clerk secret here. The method, path and bearer header are the ones Clerk
 * documents and the ones `clerk-lookup.ts` already uses for the same API.
 */
export async function deleteClerkUser(
  env: ClerkLookupEnv,
  userId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ClerkDeletion> {
  if (!clerkLookupConfigured(env)) {
    return {
      ok: false,
      error: 'CLERK_SECRET_KEY is not set, so the sign-in account was kept.',
    };
  }
  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`,
      {
        method: 'DELETE',
        headers: { authorization: `Bearer ${env.CLERK_SECRET_KEY}` },
        signal: AbortSignal.timeout(8_000),
      },
    );
  } catch {
    return { ok: false, error: 'Could not reach Clerk to delete the user.' };
  }
  if (response.ok || response.status === 404) return { ok: true };
  return {
    ok: false,
    error: `Clerk refused to delete the user (${response.status}).`,
  };
}

/** The dependencies as a deployed Worker has them. */
export function deletionDepsFor(env: DeletionEnv): DeletionDeps {
  const db = env.DB!;
  const bucket = env.PROJECT_CONTENT;
  const ledger = env.USER_BUDGET;
  return {
    store: new AccountDeletionStore(db),
    billing: new BillingStore(db),
    github: new GitHubStore(db),
    stripe: stripeConfigured(env) ? createStripeClient(env) : null,
    stopPreview: previewConfigured(env)
      ? (userId) => stopPreview(env, userId)
      : null,
    // The runtime binding has `list` and a `delete` that takes many keys;
    // `cloudflare.d.ts` declares them.
    bucket: bucket ?? null,
    ledger: ledger ? (name) => ledger.getByName(name) : null,
    deleteClerkUser: (userId) => deleteClerkUser(env, userId),
    now: () => new Date(),
  };
}

/**
 * What a person reads about a step that did not happen. Written for them,
 * not for a log: it is shown in the builder and in the operator's panel.
 */
const STEP_FAILED: Record<ImmediateStep, string> = {
  subscription: 'Your subscription could not be cancelled yet.',
  preview: 'Your preview could not be stopped yet.',
  sites: 'Your published site is still online.',
  github: 'Your GitHub connection could not be removed yet.',
  referrals: 'Pending referral rewards could not be cancelled yet.',
};

/**
 * Cancel every subscription this account has that can still take money,
 * immediately.
 *
 * **Now, not at period end.** An account that is being deleted has nothing
 * left to use for the rest of the period, and a subscription left to run
 * out would renew nothing but would still be a live billing relationship
 * with somebody who asked to leave. Revoking an invite cancels at period end
 * (`access-billing.ts`) because that person may be let back in; this is
 * the person leaving.
 *
 * **No proration.** `prorate: false` and `invoice_now: false`, matching the
 * published refund policy (apps/marketing's `/legal/refunds`): a period
 * already paid for is not prorated or refunded except where the law
 * requires it, and nothing in this codebase prorates anywhere else. A
 * refund the law requires is a person's decision in the Stripe dashboard,
 * not this code's.
 *
 * Asked of Stripe rather than the mirror, for the reason `liveSubscription`
 * in `access-billing.ts` gives: a missed webhook leaves no local row while
 * Stripe bills on schedule. The mirror is read only to find the customer.
 * A subscription that is already cancelled is not billable and is skipped,
 * which is what makes this safe to repeat.
 */
async function cancelSubscriptions(
  deps: DeletionDeps,
  userId: string,
): Promise<true | string> {
  const customerId =
    (await deps.billing.findCustomerId(userId)) ??
    (await deps.billing.findCancellableSubscription(userId))?.stripeCustomerId;
  // Never reached Checkout: there is nothing in Stripe to stop.
  if (!customerId) return true;
  if (!deps.stripe) {
    return 'Your subscription could not be cancelled: billing is not configured here.';
  }
  const page = await deps.stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 100,
  });
  for (const subscription of page.data) {
    if (!BILLABLE_STATUSES.includes(subscription.status)) continue;
    await deps.stripe.subscriptions.cancel(subscription.id, {
      invoice_now: false,
      prorate: false,
    });
  }
  return true;
}

export interface ImmediateOptions {
  /**
   * Take every site the account has published down, as its owner: an
   * account has one per project it published. Present only while the
   * person is asking: see this file's header for why the nightly pass never
   * has it.
   */
  takeDown?: () => Promise<unknown>;
}

const STEPS: Record<
  ImmediateStep,
  (
    deps: DeletionDeps,
    userId: string,
    options: ImmediateOptions,
  ) => Promise<true | string>
> = {
  subscription: cancelSubscriptions,

  // Idempotent on the service's side: stopping a preview that never
  // started, or already stopped, succeeds. A share link to a stopped
  // preview answers that it is no longer running, so the links go with it.
  //
  // No preview service means no sandbox can be running, and one that was
  // started before the service was removed has outlived the 30-minute hard
  // lifetime anyway (docs/decisions.md, "Values set").
  //
  // And the live previews the account's share links started
  // (`share-handlers.ts`), one sandbox per link, named for the link rather
  // than the account. The links themselves stopped working when the request
  // was recorded (`ProjectStore.findShared` refuses an account that is
  // leaving), but a stranger already watching one would otherwise keep it
  // for the rest of its lifetime.
  preview: async (deps, userId) => {
    if (!deps.stopPreview) return true;
    const outcome = await deps.stopPreview(userId);
    if (!outcome.ok) return STEP_FAILED.preview;
    for (const token of await deps.store.shareTokens(userId)) {
      const shared = await deps.stopPreview(await sharePreviewKey(token));
      if (!shared.ok) return STEP_FAILED.preview;
    }
    return true;
  },

  // Done when D1 says nothing of this account's is serving, whatever took
  // it down: the owner's takedown here, an earlier one, or an operator's
  // hold. The takedown's own answer is not what decides, because a 404
  // (never published) and a 409 (held) are both "not serving" and a 200
  // that raced a republish is not.
  sites: async (deps, userId, options) => {
    if (options.takeDown) {
      try {
        await options.takeDown();
      } catch (error) {
        console.error('account deletion: takedown failed', error);
      }
    }
    return (await deps.store.liveSite(userId)) === null
      ? true
      : STEP_FAILED.sites;
  },

  // This deployment's grants only: the account's connection and every
  // project's binding (D72). The GitHub App installation belongs to the
  // person's GitHub account, may cover repositories shared with other
  // people, and is theirs to remove on GitHub; deleting it from here would
  // be acting on somebody else's account.
  github: async (deps, userId) => {
    await deps.github.disconnectAccount(userId, deps.now());
    return true;
  },

  referrals: async (deps, userId) => {
    await deps.store.cancelReferralPayouts(userId, deps.now().toISOString());
    return true;
  },
};

/** D1 queries one attempt at every immediate step can cost from the nightly pass. */
export const QUERIES_PER_RETRY =
  // The customer mapping, then the mirror when there is no mapping.
  2 +
  // Preview: the share links whose previews to stop. Sites: the live-site
  // read. GitHub: the revoke, which is two statements since D72 (every
  // project's binding and the account's connection). They go in one batch,
  // and are counted as two so the bound holds however a batch is billed.
  1 +
  1 +
  2 +
  // Referrals: the reversal and the code.
  2 +
  // The attempt record.
  1;

export interface ImmediateResult {
  done: ImmediateStep[];
  errors: string[];
}

/**
 * Attempt every immediate step not yet done, and record what happened.
 *
 * Every step is tried whatever happened to the one before it: Stripe being
 * down is no reason to leave a preview running. Each failure is kept as
 * something a person can read, and the steps that did happen are recorded
 * in one statement.
 */
export async function runImmediateSteps(
  deps: DeletionDeps,
  record: DeletionRecord,
  options: ImmediateOptions = {},
): Promise<ImmediateResult> {
  const done = IMMEDIATE_STEPS.filter((step) => record.done[step] !== null);
  const now: ImmediateStep[] = [];
  const errors: string[] = [];
  for (const step of IMMEDIATE_STEPS) {
    if (done.includes(step)) continue;
    try {
      const outcome = await STEPS[step](deps, record.userId, options);
      if (outcome === true) now.push(step);
      else errors.push(outcome);
    } catch (error) {
      console.error(`account deletion: ${step} failed`, error);
      errors.push(STEP_FAILED[step]);
    }
  }
  await deps.store.recordAttempt(
    record.userId,
    now,
    errors.length > 0 ? errors.join(' ') : null,
    deps.now().toISOString(),
  );
  return { done: [...done, ...now], errors };
}

/**
 * Record a request and do what can be done straight away. What the route
 * calls, with the person present.
 */
export async function requestAccountDeletion(
  deps: DeletionDeps,
  userId: string,
  options: ImmediateOptions = {},
): Promise<{ record: DeletionRecord; result: ImmediateResult }> {
  const record = await deps.store.request(
    userId,
    deps.now().toISOString(),
    `deleted-${crypto.randomUUID()}`,
  );
  const result = await runImmediateSteps(deps, record, options);
  return { record, result };
}

// -------------------------------------------------------------------------
// The purge.
// -------------------------------------------------------------------------

/**
 * What one run of a step achieved.
 *
 * - `done`: the step is finished, and the purge moves on.
 * - `more`: there is more to do and tonight has done what it should, so the
 *   purge stops here and resumes at this step tomorrow.
 * - `again`: one piece of the step is finished and there are more pieces,
 *   each as big as the one just done. The step runs again at once if the
 *   night's share can pay for it, and otherwise tomorrow, from where it is.
 *   Nothing is saved between pieces, because the step itself finds the next
 *   one from what is left.
 */
type PurgeOutcome = 'done' | 'more' | 'again' | { error: string };

interface PurgeStep {
  name: string;
  /**
   * D1 queries one run of the step makes, not counting the progress save
   * after it. For a step that `repeats`, that is one pass.
   */
  queries: number;
  /**
   * Whether the step answers `again`: one pass per project the account
   * owns, and a last pass that finds none left.
   */
  repeats?: true;
  run(deps: DeletionDeps, record: DeletionRecord): Promise<PurgeOutcome>;
}

/**
 * The purge, in order. The index into this list is what is saved.
 *
 * Appending a step is safe for a purge in flight; reordering or removing
 * one is not, because a saved index would then name a different step.
 */
export const PURGE_STEPS: readonly PurgeStep[] = [
  {
    // Again, in case a Checkout that was already open when the request was
    // made completed afterwards and started a subscription nobody asked to
    // stop. Cheap, and the purge is the last chance to notice.
    name: 'subscription',
    queries: 2,
    async run(deps, record) {
      const outcome = await cancelSubscriptions(deps, record.userId);
      return outcome === true ? 'done' : { error: outcome };
    },
  },
  {
    // Every project's stored content, and then its rows: the snapshots
    // (`generation-store.ts`'s `projects/{projectId}/snapshots/{revision}.json`)
    // and the saved conversation beside them (`project-store.ts`'s
    // `projects/{projectId}/transcript-{nonce}.json`), which one prefix
    // covers.
    //
    // One project a pass, repeated while the night's share allows
    // (`again`). An account used to have one project, keyed by its user id,
    // and this step deleted that one prefix. Now it can have any number,
    // and listing them all and deleting prefix after prefix would either be
    // unbounded or, with a bound, stop making progress at an account whose
    // projects outnumber it: an empty prefix still costs a list call, and
    // it would be listed again every night. Deleting each project's rows
    // as soon as its bytes are gone takes it out of the next pass's list,
    // so every pass either deletes bytes or retires a project.
    //
    // When no project is left, the prefix keyed by the user id itself is
    // checked last. That is where the account's one project lived before
    // there were several; the migration gave it a row, so it is normally
    // gone by now, and this is the belt to that brace.
    name: 'snapshots',
    queries:
      AccountDeletionStore.NEXT_PROJECT_QUERIES +
      AccountDeletionStore.ONE_PROJECT_QUERIES,
    repeats: true,
    async run(deps, record) {
      if (!deps.bucket) return 'done';
      assertPrefixSafe(record.userId);
      const next = await deps.store.nextProjectToPurge(record.userId);
      if (next === null) {
        return (await deletePrefix(deps.bucket, `projects/${record.userId}/`))
          ? 'done'
          : 'more';
      }
      assertPrefixSafe(next);
      if (!(await deletePrefix(deps.bucket, `projects/${next}/`))) {
        return 'more';
      }
      await deps.store.deleteOneProject(next);
      return 'again';
    },
  },
  {
    // The media library's bytes (`media/{userId}/{id}`).
    name: 'media',
    queries: 0,
    async run(deps, record) {
      if (!deps.bucket) return 'done';
      assertPrefixSafe(record.userId);
      return (await deletePrefix(
        deps.bucket,
        mediaObjectKey(record.userId, ''),
      ))
        ? 'done'
        : 'more';
    },
  },
  {
    name: 'project rows',
    queries: AccountDeletionStore.PROJECT_ROW_QUERIES,
    async run(deps, record) {
      await deps.store.deleteProjectRows(record.userId);
      return 'done';
    },
  },
  {
    name: 'published sites',
    queries: AccountDeletionStore.PUBLISHED_QUERIES,
    async run(deps, record) {
      await deps.store.retirePublishedSites(
        record.userId,
        record.tombstone,
        deps.now().toISOString(),
      );
      return 'done';
    },
  },
  {
    name: 'account rows',
    queries: AccountDeletionStore.ACCOUNT_ROW_QUERIES,
    async run(deps, record) {
      await deps.store.deleteAccountRows(record.userId);
      return 'done';
    },
  },
  {
    name: 'billing records',
    queries: AccountDeletionStore.BILLING_ROW_QUERIES,
    async run(deps, record) {
      await deps.store.tombstoneBillingRows(record.userId, record.tombstone);
      return 'done';
    },
  },
  {
    name: 'credit and referral records',
    queries: AccountDeletionStore.CREDIT_ROW_QUERIES,
    async run(deps, record) {
      await deps.store.tombstoneCreditRows(record.userId, record.tombstone);
      return 'done';
    },
  },
  {
    // The spend ledger's Durable Objects: the account's monthly allowance
    // and its top-up balance (`reserve.ts`). The account-wide daily ledger
    // is not the account's and holds no id.
    name: 'spend ledger',
    queries: 0,
    async run(deps, record) {
      if (!deps.ledger) return 'done';
      await deps.ledger(record.userId).forget();
      await deps.ledger(topupKeyFor(record.userId)).forget();
      return 'done';
    },
  },
  {
    // Last of the deletions, so a purge that stops before it leaves a
    // person who can still sign in and be told their account is being
    // deleted, rather than an account whose data is intact and whose
    // sign-in is gone.
    name: 'sign-in account',
    queries: 0,
    async run(deps, record) {
      const deleted = await deps.deleteClerkUser(record.userId);
      return deleted.ok ? 'done' : { error: deleted.error };
    },
  },
];

/** The progress save after each step. */
const QUERIES_PER_SAVE = 1;

/** Reading whether a site is still live, and recording why the purge stopped. */
export const QUERIES_TO_CHECK_PURGE = 2;

/** The last write, which turns the request into the audit record. */
const QUERIES_TO_FINISH = 1;

/**
 * D1 queries the rest of a purge can cost from where this record stands,
 * for an account with `projects` projects still to purge.
 *
 * The nightly pass plans with the default of none, because the lookup that
 * finds tonight's work does not count anybody's projects, and one more
 * query per request every night to count them would be paid whether or
 * not there was a purge to plan. So for an account with several projects
 * the planned figure is what one night needs to make progress rather than
 * to finish. That is safe: every query is still taken from the share
 * before it is made, so a purge that needs more than it was given stops
 * between two statements and resumes tomorrow, and the share is never
 * exceeded.
 */
export function purgeQueriesLeft(record: DeletionRecord, projects = 0): number {
  return (
    QUERIES_TO_CHECK_PURGE +
    PURGE_STEPS.slice(record.purgeStep).reduce(
      (sum, step) =>
        sum +
        (step.queries + QUERIES_PER_SAVE) * (step.repeats ? projects + 1 : 1),
      0,
    ) +
    QUERIES_TO_FINISH
  );
}

export function purgeDue(record: DeletionRecord, now: Date): boolean {
  return Date.parse(record.purgeAfter) <= now.getTime();
}

/** A query allowance that a unit of work takes from before it starts. */
export class QueryAllowance {
  #left: number;
  #spent = 0;

  constructor(queries: number) {
    this.#left = Math.max(0, queries);
  }

  take(queries: number): boolean {
    if (queries > this.#left) return false;
    this.#left -= queries;
    this.#spent += queries;
    return true;
  }

  get spent(): number {
    return this.#spent;
  }
}

export type PurgeResult =
  | { state: 'purged' }
  | { state: 'partial'; step: number }
  | { state: 'blocked'; reason: string }
  | { state: 'out-of-allowance' };

/**
 * Take a due request as far through the purge as the allowance goes.
 *
 * Refuses to start while anything immediate is undone, or while a site of
 * the account's is still serving. The first because a purge that tombstones
 * the billing rows while a subscription is live leaves Stripe charging an
 * account nobody can find; the second because the purge must not be what
 * takes a live site off the web (see the header).
 */
export async function purgeAccount(
  deps: DeletionDeps,
  record: DeletionRecord,
  allowance: QueryAllowance,
): Promise<PurgeResult> {
  const now = deps.now();
  if (!purgeDue(record, now)) {
    return { state: 'blocked', reason: 'not due' };
  }
  if (!allowance.take(QUERIES_TO_CHECK_PURGE)) {
    return { state: 'out-of-allowance' };
  }
  const blockedBy = !immediateStepsDone(record)
    ? 'An immediate step has not finished, so the purge is waiting for it.'
    : (await deps.store.liveSite(record.userId)) !== null
      ? 'A published site is still online, so the purge is waiting for it to be taken down.'
      : null;
  if (blockedBy) {
    await deps.store.recordPurgeBlocked(
      record.userId,
      blockedBy,
      now.toISOString(),
    );
    return { state: 'blocked', reason: blockedBy };
  }

  for (let index = record.purgeStep; index < PURGE_STEPS.length; index += 1) {
    const step = PURGE_STEPS[index]!;
    if (!allowance.take(step.queries + QUERIES_PER_SAVE)) {
      return { state: 'partial', step: index };
    }
    let outcome: PurgeOutcome;
    try {
      outcome = await step.run(deps, record);
    } catch (error) {
      console.error(`account purge: ${step.name} failed`, error);
      outcome = { error: `The purge could not finish its ${step.name} step.` };
    }
    if (outcome === 'more') return { state: 'partial', step: index };
    // The same step once more, paid for from the share like any other run
    // of it. Its progress needs no save: the step finds its next piece from
    // what the last one left behind.
    if (outcome === 'again') {
      index -= 1;
      continue;
    }
    if (outcome !== 'done') {
      // The allowance for this was taken with `QUERIES_TO_CHECK_PURGE`.
      await deps.store.recordPurgeBlocked(
        record.userId,
        outcome.error,
        now.toISOString(),
      );
      return { state: 'blocked', reason: outcome.error };
    }
    await deps.store.advancePurge(record.userId, index + 1);
  }

  if (!allowance.take(QUERIES_TO_FINISH)) {
    return { state: 'partial', step: PURGE_STEPS.length };
  }
  await deps.store.finishPurge(
    record.userId,
    record.tombstone,
    now.toISOString(),
  );
  return { state: 'purged' };
}

// -------------------------------------------------------------------------
// The nightly pass.
// -------------------------------------------------------------------------

/** Requests one night looks at. Bounds the Stripe, R2 and Clerk calls too. */
export const DELETIONS_PER_NIGHT = 5;

/**
 * Queries spent every night before anything is known: the one read that
 * finds both the requests with work and the audit records that are due to
 * be forgotten (`AccountDeletionStore.work`).
 */
export const QUERIES_TO_FIND_DELETIONS = 1;

/** Deleting tonight's expired audit records, when there are any. */
export const QUERIES_TO_FORGET = 1;

/**
 * The least a night with deletion work has to be handed for it to buy
 * anything: one attempt at the immediate steps, or the purge check and its
 * largest step. `billing-replay.test.ts`'s rotation tests hold every
 * deletion turn to at least this, because a share that buys nothing every
 * night is the starvation internal issue 176 was about.
 */
export const MIN_DELETION_SHARE = Math.max(
  QUERIES_PER_RETRY,
  QUERIES_TO_CHECK_PURGE +
    Math.max(...PURGE_STEPS.map((step) => step.queries)) +
    QUERIES_PER_SAVE,
);

/** What tonight's lookup found, and what it could cost at the most. */
export interface DeletionLookup {
  records: DeletionRecord[];
  expired: string[];
  /** The most the work found could spend tonight. Zero means nothing waits. */
  need: number;
}

/** What the waiting requests could spend tonight at the most. */
export function deletionNeedFor(
  records: readonly DeletionRecord[],
  expired: readonly string[],
  now: Date,
): number {
  return (
    (expired.length > 0 ? QUERIES_TO_FORGET : 0) +
    records.reduce(
      (sum, record) =>
        sum +
        (immediateStepsDone(record) ? 0 : QUERIES_PER_RETRY) +
        (purgeDue(record, now) ? purgeQueriesLeft(record) : 0),
      0,
    )
  );
}

/**
 * Find tonight's deletion work. Costs `QUERIES_TO_FIND_DELETIONS`, whatever
 * it finds.
 *
 * Never rejects. A read that fails leaves nothing to do tonight, which is
 * tomorrow's work rather than a thrown nightly pass that takes the billing
 * pass down with it.
 */
export async function findDeletionWork(
  deps: DeletionDeps,
): Promise<DeletionLookup> {
  const now = deps.now();
  try {
    const { records, expired } = await deps.store.work(
      now.toISOString(),
      DELETIONS_PER_NIGHT,
    );
    return {
      records,
      expired,
      need: deletionNeedFor(records, expired, now),
    };
  } catch (error) {
    console.error('account deletions: could not read the queue', error);
    return { records: [], expired: [], need: 0 };
  }
}

export interface DeletionNightResult {
  looked: number;
  retried: number;
  purged: number;
  blocked: number;
  forgotten: number;
  /** Queries taken from the share, which is what it may not exceed. */
  queries: number;
}

/**
 * Tonight's deletion work, inside its share: forget the audit records that
 * are due, then retry what did not happen and purge what is due, least
 * recently tried first, as `work` returned them.
 *
 * Every query is taken from the share before it is made, so a share that
 * runs out stops the night between two statements rather than part way
 * through one, and the saved purge step is where tomorrow resumes.
 */
export async function runDeletionNight(
  deps: DeletionDeps,
  lookup: DeletionLookup,
  share: number,
): Promise<DeletionNightResult> {
  const allowance = new QueryAllowance(share);
  let retried = 0;
  let purged = 0;
  let blocked = 0;
  let forgotten = 0;

  if (lookup.expired.length > 0 && allowance.take(QUERIES_TO_FORGET)) {
    try {
      forgotten = await deps.store.forget(
        lookup.expired,
        deps.now().toISOString(),
      );
    } catch (error) {
      console.error('account deletions: could not forget audit records', error);
    }
  }

  for (const original of lookup.records) {
    let record = original;
    if (!immediateStepsDone(record)) {
      if (!allowance.take(QUERIES_PER_RETRY)) break;
      try {
        const result = await runImmediateSteps(deps, record);
        retried += 1;
        const at = deps.now().toISOString();
        record = {
          ...record,
          done: Object.fromEntries(
            IMMEDIATE_STEPS.map((step) => [
              step,
              record.done[step] ?? (result.done.includes(step) ? at : null),
            ]),
          ) as DeletionRecord['done'],
        };
      } catch (error) {
        console.error('account deletions: retry failed', error);
        continue;
      }
    }
    if (!purgeDue(record, deps.now())) continue;
    try {
      const result = await purgeAccount(deps, record, allowance);
      if (result.state === 'purged') purged += 1;
      if (result.state === 'blocked') blocked += 1;
      if (result.state === 'out-of-allowance') break;
    } catch (error) {
      console.error('account deletions: purge failed', error);
    }
  }

  return {
    looked: lookup.records.length,
    retried,
    purged,
    blocked,
    forgotten,
    queries: allowance.spent,
  };
}
