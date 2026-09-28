/**
 * The routes for deleting an account (docs/decisions.md L32):
 *
 * - `POST /api/account/delete` asks, or asks again. Asking again is the
 *   retry for any immediate step that did not happen the first time, and it
 *   never moves the date.
 * - `GET /api/account/delete` says where the caller's request stands.
 * - `POST /api/account/delete/cancel` keeps the account, while the purge
 *   has not started.
 * - `GET /api/admin/deletions` is the operator's list; the admin check is
 *   the router's (`requireAdmin`), as for every other `/api/admin/*` route.
 *
 * The first three resolve the caller with `allowPendingDeletion`, which no
 * other route does: they are the only things an account that asked to be
 * deleted can still do.
 */
import {
  CONFIRMATION_PHRASE,
  accountDeletionConfigured,
  deletionDepsFor,
  requestAccountDeletion,
  runImmediateSteps,
} from './account-deletion.ts';
import type { DeletionDeps, DeletionEnv } from './account-deletion.ts';
import {
  AccountDeletionStore,
  IMMEDIATE_STEPS,
} from './account-deletion-store.ts';
import type {
  DeletionRecord,
  ImmediateStep,
} from './account-deletion-store.ts';
import { resolvePrincipal } from './principal.ts';
import type {
  PrincipalDenied,
  PrincipalEnv,
  PrincipalGranted,
  ResolveOptions,
} from './principal.ts';

export type AccountDeletionEnv = DeletionEnv & PrincipalEnv;

/** Identify the caller. `resolvePrincipal` in production; a stub in tests. */
export type ResolveCaller = (
  request: Request,
  options: ResolveOptions,
) => Promise<PrincipalDenied | PrincipalGranted>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function unconfigured(): Response {
  return json(
    { error: 'Account deletion is not configured for this deployment.' },
    503,
  );
}

/** What the builder is told about a request. No tombstone: that is not theirs to hold. */
function describeRequest(
  record: DeletionRecord,
  done: (step: ImmediateStep) => boolean,
  errors: string[],
) {
  return {
    scheduled: true,
    requestedAt: record.requestedAt,
    purgeAfter: record.purgeAfter,
    steps: Object.fromEntries(
      IMMEDIATE_STEPS.map((step) => [step, done(step)]),
    ),
    errors,
    // The purge has not touched anything yet, so keeping the account still
    // gives back everything that was not stopped.
    cancellable: record.purgeStep === 0,
  };
}

export interface AccountDeleteOptions {
  /**
   * Takes every site the caller published down as their owner, one per
   * project that has one. The router's to
   * supply, because the owner's takedown route is the one path allowed to
   * do that and it lives there (`publish-authorisation.test.ts`).
   */
  takeDown: () => Promise<unknown>;
  resolve?: ResolveCaller;
  depsFor?: (env: AccountDeletionEnv) => DeletionDeps;
}

/**
 * Ask for this account to be deleted, or ask again.
 *
 * The typed phrase is required to make a request, and checked here as well
 * as in the page, so a script or a stray request cannot delete an account
 * without it. Asking again for a request that already stands needs no
 * phrase: nothing new is decided, and it is how a step that failed (Stripe
 * unreachable, the takedown refused) is finished by the person who asked.
 */
export async function handleAccountDelete(
  request: Request,
  env: AccountDeletionEnv,
  options: AccountDeleteOptions,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return json({ error: 'Use GET or POST.' }, 405);
  }
  if (!accountDeletionConfigured(env)) return unconfigured();

  const resolve =
    options.resolve ?? ((req, opts) => resolvePrincipal(req, env, opts));
  const resolved = await resolve(request, { allowPendingDeletion: true });
  if (resolved.denied) return resolved.denied;
  const { userId } = resolved.principal;
  const deps = (options.depsFor ?? deletionDepsFor)(env);

  let existing: DeletionRecord | null;
  try {
    existing = await deps.store.find(userId);
  } catch (error) {
    console.error('account deletion: could not read the request', error);
    return json({ error: 'Could not check this account right now.' }, 503);
  }
  const standing =
    existing !== null &&
    existing.cancelledAt === null &&
    existing.purgedAt === null
      ? existing
      : null;

  if (request.method === 'GET') {
    return standing
      ? json(
          describeRequest(
            standing,
            (step) => standing.done[step] !== null,
            standing.lastError ? [standing.lastError] : [],
          ),
        )
      : json({ scheduled: false });
  }

  if (standing) {
    const result = await runImmediateSteps(deps, standing, {
      takeDown: options.takeDown,
    });
    return json(
      describeRequest(
        standing,
        (step) => result.done.includes(step),
        result.errors,
      ),
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }
  const confirm = (body ?? {}) as { confirm?: unknown };
  if (
    typeof confirm.confirm !== 'string' ||
    confirm.confirm.trim().toLowerCase() !== CONFIRMATION_PHRASE
  ) {
    return json({ error: `Type "${CONFIRMATION_PHRASE}" to confirm.` }, 400);
  }

  let requested: Awaited<ReturnType<typeof requestAccountDeletion>>;
  try {
    requested = await requestAccountDeletion(deps, userId, {
      takeDown: options.takeDown,
    });
  } catch (error) {
    // Only the request itself can land here: every step after it catches
    // its own failure. So nothing was recorded, and saying so is the truth.
    console.error('account deletion could not be recorded', error);
    return json(
      { error: 'Your request could not be recorded. Nothing was deleted.' },
      503,
    );
  }
  const { record, result } = requested;
  return json(
    describeRequest(
      record,
      (step) => result.done.includes(step),
      result.errors,
    ),
  );
}

/** Keep the account: withdraw a request whose purge has not started. */
export async function handleAccountDeleteCancel(
  request: Request,
  env: AccountDeletionEnv,
  resolve: ResolveCaller = (req, opts) => resolvePrincipal(req, env, opts),
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!accountDeletionConfigured(env)) return unconfigured();

  const resolved = await resolve(request, { allowPendingDeletion: true });
  if (resolved.denied) return resolved.denied;

  const store = new AccountDeletionStore(env.DB!);
  const cancelled = await store.cancel(
    resolved.principal.userId,
    new Date().toISOString(),
  );
  if (cancelled) return json({ cancelled: true });

  // Nothing changed. Either there was nothing to cancel, which is the state
  // asked for, or the purge has started and cannot be taken back.
  const record = await store.find(resolved.principal.userId);
  if (record && record.cancelledAt === null && record.purgedAt === null) {
    return json(
      {
        error:
          'The deletion has already started and can no longer be cancelled.',
      },
      409,
    );
  }
  return json({ cancelled: false, scheduled: false });
}

/** The operator's list. Assumes the admin check already ran. */
export async function handleAdminDeletions(
  request: Request,
  env: { DB?: D1Database },
): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
  if (!env.DB) return unconfigured();
  const store = new AccountDeletionStore(env.DB);
  const [pending, purged] = await Promise.all([
    store.listPending(100),
    store.purgedCount(),
  ]);
  return json({ pending, purged });
}
