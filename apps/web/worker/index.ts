import {
  DEFAULT_MAX_TOKENS,
  configuredProviders,
  findModel,
  providerForRequest,
  resolveModel,
} from '@vibld/ai';

import { clerkConfigured, resolvePrincipal } from './principal.ts';
import { UserBudget } from './budget.ts';
import type { Reservation } from './budget.ts';
import { GenerationWorkflow } from './generation-workflow.ts';
import type { WorkflowParams } from './generation-workflow.ts';
import {
  DEFAULT_LIMITS,
  checkBodySize,
  checkRequestOrigin,
  parseGenerationRequest,
  parseKnowledge,
  parseModel,
  parsePreviewRequest,
  parseAdminTopupRequest,
  parseReferenceUrl,
  parseStyleDna,
  parseStylePreset,
} from './request-guard.ts';
import { fetchReferenceContext } from './reference-fetch.ts';
import { MAX_REFERENCE_CHARS } from '@vibld/ai/limits';
import { isPlatformAdmin, parsePlatformAdmins } from './platform-admins.ts';
import {
  clerkLookupConfigured,
  findClerkUserIdByEmail,
} from './clerk-lookup.ts';
import { decideModel, grantedFor } from './model-access.ts';
import { grantSignupCreditOnce } from './signup-credit.ts';
import {
  ACCOUNT_BUDGET_KEY,
  dayKey,
  parsePrices,
  worstCaseMicroUsd,
} from './spend.ts';
import type { SpendVerdict } from './spend.ts';
import {
  DEFAULT_FREE_INCLUDED_MICRO_USD,
  allowancePeriodKey,
  monthlyAllowanceMicroUsd,
  tierFor,
} from './entitlement.ts';
import {
  KEEPALIVE_COMMENT,
  STREAM_HEADERS,
  encodeEvent,
  parseKeepaliveMs,
} from './stream.ts';
import {
  createShare,
  listShares,
  previewConfigured,
  previewStatus,
  revokeShare,
  startPreview,
  stopPreview,
} from './preview-client.ts';
import type { ServiceBinding } from './preview-client.ts';
import {
  autoPublishConfigured,
  buildProject,
  publishProject,
} from './publish-client.ts';
import {
  billingConfigured,
  handleBillingCheckout,
  handleBillingPortal,
  handleStripeWebhook,
  reconcileSubscriptions,
} from './billing-handlers.ts';
import { checkProviderBalances } from './provider-balance.ts';
import { BillingStore } from './billing-store.ts';
import { createStripeClient } from './stripe-client.ts';

export interface Env {
  /** Worker secret. Never reaches the browser. */
  ANTHROPIC_API_KEY?: string;
  /** Worker secret. Never reaches the browser. */
  DEEPSEEK_API_KEY?: string;
  OPENAI_API_KEY?: string;
  /** "anthropic" or "deepseek". Explicit beats inferred; see selectProvider. */
  VIBLD_PROVIDER?: string;
  /**
   * Worker secret. Which models each principal may use, as JSON -- see
   * `parseModelPolicy`. A secret rather than a var because it names people
   * and this repository is public. Absent means no policy: everyone may use
   * whatever the deployment can serve.
   */
  VIBLD_MODEL_POLICY?: string;
  /**
   * Clerk's Frontend API URL -- a public identifier, not a secret. Used as
   * both the JWT issuer to match and the base for the JWKS fetch
   * (clerk-auth.ts appends /.well-known/jwks.json). docs/decisions.md L5:
   * this replaces ACCESS_TEAM_DOMAIN/ACCESS_AUD, now that Access is off.
   */
  CLERK_FRONTEND_API_URL?: string;
  VIBLD_MODEL?: string;
  /** Transport keepalive interval in ms. Configuration, not a literal. */
  VIBLD_STREAM_KEEPALIVE_MS?: string;
  /** Per-user spend ledger. Without it the ceiling cannot be enforced. */
  USER_BUDGET?: DurableObjectNamespace<UserBudget>;
  /**
   * Burst gates. Optional: they are per-location and documented as permissive,
   * so they are a speed bump in front of the ledger rather than the limit.
   */
  PLAN_BURST?: RateLimit;
  PLAN_SUSTAINED?: RateLimit;
  /**
   * Per-IP, checked before identity (docs/decisions.md L29). PLAN_BURST and
   * PLAN_SUSTAINED above key on the caller's Clerk user id, so they do
   * nothing for a flood of requests that never resolves to a valid user.
   */
  IP_BURST?: RateLimit;
  /**
   * Micro-USD the Free tier (no active subscription) may spend per UTC
   * calendar month -- docs/decisions.md L36 sets this at $1.00
   * (`entitlement.ts`'s `DEFAULT_FREE_INCLUDED_MICRO_USD`); set this only to
   * correct that figure. Build and Ship are not configurable here: their
   * included spend is fixed by the accepted price table, not an operator
   * knob (`entitlement.ts`'s `TIER_INCLUDED_MICRO_USD`).
   */
  VIBLD_FREE_MONTHLY_MICRO_USD?: string;
  /**
   * Cents of one-time credit a new account is granted on its first
   * authenticated request. Defaults to 100 ($1.00); "0" stops the grant.
   *
   * Separate money from VIBLD_FREE_MONTHLY_MICRO_USD above, which resets
   * every month. This does not reset, and is spent from the same top-up
   * bucket as Stripe purchases and admin grants. See signup-credit.ts.
   */
  VIBLD_SIGNUP_CREDIT_USD_CENTS?: string;
  /** Runs one user may have in flight at once. */
  VIBLD_MAX_IN_FLIGHT?: string;
  /**
   * Micro-USD the whole deployment may spend per UTC day, across every user
   * -- docs/decisions.md L29. Layered above the per-user tier allowances so
   * one compromised account cannot spend the month; those ceilings alone
   * bound only what *one* identity can do, not what N of them can do
   * together. The default is a starting point, not a measured figure;
   * correct it once real usage gives one.
   */
  VIBLD_ACCOUNT_DAILY_MICRO_USD?: string;
  VIBLD_USD_MICRO_PER_INPUT_TOKEN?: string;
  VIBLD_USD_MICRO_PER_OUTPUT_TOKEN?: string;
  /**
   * The control plane (docs/decisions.md L24/L25): D1 for generation
   * metadata, R2 for the file content it points at. Read only by
   * `GenerationWorkflow` (generation-workflow.ts) -- `handlePlan` itself
   * never touches D1/R2 directly, the same way it never calls the model
   * directly any more.
   */
  DB?: D1Database;
  PROJECT_CONTENT?: R2Bucket;
  /**
   * Durable generation (docs/decisions.md L26). `handlePlan` creates one
   * instance per run and polls it; see generation-workflow.ts for why a
   * Workflow rather than the in-request model call this replaced.
   */
  GENERATION_WORKFLOW?: Workflow<WorkflowParams>;
  /**
   * The sandbox execution service (docs/decisions.md L7-L11; see
   * apps/preview/README.md for why it is a separate Worker). `/api/preview`
   * is unavailable, not open, when this or `PREVIEW_INTERNAL_SECRET` is
   * unset -- the same fail-closed rule `isConfigured` already applies to
   * generation.
   */
  PREVIEW?: ServiceBinding;
  /** Worker secret, shared with @vibld/preview -- see preview-client.ts. */
  PREVIEW_INTERNAL_SECRET?: string;
  /**
   * Cloudflare auto-publish's serving Worker (ADR-0010; see
   * apps/publish/README.md). `/api/publish` is unavailable, not open, when
   * this, `PUBLISH_INTERNAL_SECRET`, `PREVIEW` or `PREVIEW_INTERNAL_SECRET`
   * is unset -- publishing needs both apps/preview's build step and
   * apps/publish's store, the same fail-closed rule `isConfigured` already
   * applies to generation.
   */
  PUBLISH?: ServiceBinding;
  /** Worker secret, shared with @vibld/publish -- see publish-client.ts. */
  PUBLISH_INTERNAL_SECRET?: string;
  /**
   * Publishing runs a real build and writes real storage, so it gets its
   * own burst gate keyed on the caller rather than riding PLAN_BURST's --
   * a naive flood here costs sandbox compute and R2 writes, not model spend,
   * so the ceiling that matters is a different one. Optional and permissive
   * for the same reason PLAN_BURST is: a speed bump, not the boundary
   * (there is no ledger to size a hard limit against yet).
   */
  PUBLISH_BURST?: RateLimit;
  /**
   * Stripe billing (docs/decisions.md L12-L15). Worker secret, live-mode --
   * see billing-handlers.ts. `/api/billing/*` and `/api/stripe/webhook` are
   * unavailable, not open, when this or `STRIPE_WEBHOOK_SECRET` is unset,
   * the same fail-closed rule `isConfigured` already applies to generation.
   */
  STRIPE_SECRET_KEY?: string;
  /** Worker secret: the signing secret for this deployment's registered webhook endpoint. */
  STRIPE_WEBHOOK_SECRET?: string;
  /**
   * L44: the nightly balance check answers "not configured" for DeepSeek,
   * same as every other optional secret here, when this is unset -- see
   * provider-balance.ts. Shared with apps/marketing's own Resend key in
   * spirit, but not the same secret store: each Worker holds its own copy.
   */
  RESEND_API_KEY?: string;
  /** USD threshold for the DeepSeek balance alert. Default: $10. */
  VIBLD_DEEPSEEK_BALANCE_ALERT_USD?: string;
  /** Where the balance alert is sent. Default: billing@vibld.com. */
  VIBLD_ALERT_EMAIL?: string;
  /** The alert's From address. Default: alerts@notifications.vibld.com. */
  VIBLD_ALERT_FROM?: string;
  /**
   * Platform admins (docs/decisions.md L4): a GitHub Actions secret,
   * comma-separated verified emails, synced to the Worker on deploy the
   * same way `VIBLD_MODEL_POLICY` already is. Checked via
   * `platform-admins.ts`'s `isPlatformAdmin` against `policyIdentity`,
   * never `userId` -- this predates Clerk and is human-edited by email,
   * the same exception `VIBLD_MODEL_POLICY` is.
   */
  VIBLD_PLATFORM_ADMINS?: string;
  /**
   * Worker secret. Lets `/api/admin/*` resolve an email an admin typed into
   * the Clerk user id the ledger actually keys on -- see clerk-lookup.ts.
   * `/api/admin/*` is unavailable, not open, when this or
   * `VIBLD_PLATFORM_ADMINS` is unset, the same fail-closed rule
   * `isConfigured` already applies to generation.
   */
  CLERK_SECRET_KEY?: string;
}

/** Re-exported so Wrangler can find the classes from the Worker's entrypoint. */
export { UserBudget, GenerationWorkflow };

const DEFAULT_MAX_IN_FLIGHT = 2;
const DEFAULT_ACCOUNT_DAILY_MICRO_USD = 80_000_000;
/** How often `handlePlan` checks its Workflow instance for a result. */
const POLL_INTERVAL_MS = 1500;

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Generation is available only when the key AND Clerk are configured.
 * Missing configuration means unavailable, never "open" -- an
 * unauthenticated endpoint on a public URL lets anyone spend the account's
 * model budget, so the failure has to be closed.
 */
function isConfigured(env: Env): boolean {
  return Boolean(
    // Any provider's key configures the endpoint. Which one it selects is
    // `selectProvider`'s business, not this gate's.
    (env.ANTHROPIC_API_KEY || env.DEEPSEEK_API_KEY || env.OPENAI_API_KEY) &&
    clerkConfigured(env) &&
    // The ledger is part of the grant, not an optimisation: a deployment
    // that cannot account for spend must not be able to spend.
    env.USER_BUDGET &&
    // Durable generation (L26) needs all three, or there is nowhere for a
    // run to execute and nothing to persist it.
    env.GENERATION_WORKFLOW &&
    env.DB &&
    env.PROJECT_CONTENT,
  );
}

interface BudgetLayers {
  account: Reservation;
  user: Reservation;
  /**
   * Which `USER_BUDGET` instance `user.id` was actually reserved against:
   * `userId` for the caller's own monthly tier allowance, or
   * `"<userId>:topup"` if that allowance was already exhausted and the
   * reservation was drawn from top-up credit instead. Threaded through
   * `WorkflowParams.reservationKey` so settlement targets the same instance.
   */
  userReservationKey: string;
}

/** Only ever constructed from a verdict already known to deny the run. */
type DeniedVerdict = Extract<SpendVerdict, { allow: false }>;

function topupKeyFor(userId: string): string {
  return `${userId}:topup`;
}

/**
 * Reserves against every ceiling before a run may start: the account-wide
 * one first (cheaper to check, and failing it means nothing else needs
 * touching), then the caller's own monthly tier allowance (L35-L39), then --
 * only if that allowance is exhausted, not merely low -- their top-up
 * credit balance (L37). If an earlier layer allows but a later one refuses,
 * the earlier hold is released at once: a run that never starts must never
 * leave a phantom charge sitting against a ceiling for up to fifteen
 * minutes waiting on the abandoned-reservation reclaim.
 *
 * `monthlyAllowance` and `topupCeiling` are the caller's to compute
 * (`handlePlan` reads them from `BillingStore`) -- this function only knows
 * how to spend them, not where they come from.
 */
async function reserveBudget(
  env: Env,
  userId: string,
  worstCase: number,
  monthlyAllowance: number,
  topupCeiling: number,
  now: number,
): Promise<
  { ok: true; layers: BudgetLayers } | { ok: false; verdict: DeniedVerdict }
> {
  const ledger = env.USER_BUDGET!;
  const accountCeiling = positiveInt(
    env.VIBLD_ACCOUNT_DAILY_MICRO_USD,
    DEFAULT_ACCOUNT_DAILY_MICRO_USD,
  );
  // Unbounded in-flight on purpose: concurrency is the per-user layer's job
  // below. This layer enforces spend only.
  const account = await ledger
    .getByName(ACCOUNT_BUDGET_KEY)
    .reserve(worstCase, accountCeiling, Number.MAX_SAFE_INTEGER, dayKey(now));
  if (!account.verdict.allow) {
    return { ok: false, verdict: account.verdict };
  }

  const releaseAccount = async () => {
    if (account.id !== undefined) {
      await ledger.getByName(ACCOUNT_BUDGET_KEY).settle(account.id, 0);
    }
  };

  const maxInFlight = positiveInt(
    env.VIBLD_MAX_IN_FLIGHT,
    DEFAULT_MAX_IN_FLIGHT,
  );
  const primary = await ledger
    .getByName(userId)
    .reserve(worstCase, monthlyAllowance, maxInFlight, allowancePeriodKey(now));
  if (primary.verdict.allow) {
    return {
      ok: true,
      layers: { account, user: primary, userReservationKey: userId },
    };
  }

  // A top-up buys more spend, not more in-flight runs: concurrency is only
  // ever gated by the primary bucket, so this denial is final regardless of
  // top-up balance.
  if (primary.verdict.reason === 'too-many-in-flight' || topupCeiling <= 0) {
    await releaseAccount();
    return { ok: false, verdict: primary.verdict };
  }

  // The monthly allowance is exhausted -- try the caller's top-up balance
  // next, automatically. "lifetime" as the period key on purpose: unlike the
  // allowance above, a top-up does not reset month to month, it is drawn
  // down until spent (or, approximately, until it is 12 months old -- see
  // `BillingStore.totalTopupCreditMicroUsd`).
  const topupKey = topupKeyFor(userId);
  const topup = await ledger
    .getByName(topupKey)
    .reserve(worstCase, topupCeiling, Number.MAX_SAFE_INTEGER, 'lifetime');
  if (topup.verdict.allow) {
    return {
      ok: true,
      layers: { account, user: topup, userReservationKey: topupKey },
    };
  }

  await releaseAccount();
  // The monthly-allowance denial is the one worth reporting: it is what a
  // top-up would have fixed, whereas the top-up bucket's own denial is just
  // "also not enough" and says nothing new.
  return { ok: false, verdict: primary.verdict };
}

/**
 * GET -> the caller's own billing status: current tier, this period's spend
 * against their monthly allowance, and any top-up credit remaining. Read-only
 * mirror of exactly what `handlePlan`'s Layer three above computes and
 * reserves against -- `UserBudget` stays the one authoritative ledger, this
 * only reads it back for the shell to show a "generations remaining"
 * readout and drive its checkout/portal buttons (L35).
 */
async function handleBillingStatus(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);

  const resolved = await resolvePrincipal(request, env);
  if (resolved.denied) return resolved.denied;
  const { principal } = resolved;

  if (!env.USER_BUDGET || !env.DB) {
    return json(
      { error: 'Usage accounting is not configured for this deployment.' },
      503,
    );
  }

  try {
    const now = Date.now();
    const billing = new BillingStore(env.DB);
    // Before the balance is read, so a brand new account sees its welcome
    // credit on the very first load rather than after a refresh. Idempotent
    // on a deterministic id, so calling it on every status request is free.
    await grantSignupCreditOnce(billing, principal.userId, env);
    const subscription = await billing.findActiveSubscription(principal.userId);
    const tier = tierFor(subscription);
    const freeAllowance = positiveInt(
      env.VIBLD_FREE_MONTHLY_MICRO_USD,
      DEFAULT_FREE_INCLUDED_MICRO_USD,
    );
    const allowanceMicroUsd = monthlyAllowanceMicroUsd(tier, freeAllowance);
    const usage = await env.USER_BUDGET.getByName(principal.userId).usageFor(
      allowancePeriodKey(now),
    );
    // Stripe top-ups and admin-granted credit (L4) combined -- see
    // `totalSpendableCreditMicroUsd`'s own comment.
    const topupCreditMicroUsd = await billing.totalSpendableCreditMicroUsd(
      principal.userId,
    );
    const topupUsage = await env.USER_BUDGET.getByName(
      topupKeyFor(principal.userId),
    ).usageFor('lifetime');
    // The Billing Portal (`handleBillingPortal`) 502s without a Stripe
    // customer to manage -- a first-time free-tier caller has none yet, so
    // the shell needs to know before it offers that button at all.
    const hasStripeCustomer = Boolean(
      await billing.findCustomerId(principal.userId),
    );

    return json({
      tier,
      allowanceMicroUsd,
      spentMicroUsd: usage.spentMicroUsd,
      topupRemainingMicroUsd: Math.max(
        0,
        topupCreditMicroUsd - topupUsage.spentMicroUsd,
      ),
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
      hasStripeCustomer,
      billingConfigured: billingConfigured(env),
    });
  } catch (error) {
    console.error('billing status unavailable', error);
    return json(
      { error: 'Could not read billing status. Try again shortly.' },
      503,
    );
  }
}

function adminConfigured(env: Env): boolean {
  return Boolean(
    env.VIBLD_PLATFORM_ADMINS && clerkLookupConfigured(env) && env.DB,
  );
}

/**
 * The one check every `/api/admin/*` handler makes before anything else:
 * Clerk-verified identity, then platform-admin membership. Both endpoints
 * below call this rather than trusting the shell's own `isAdmin` readout
 * (`/api/config`) -- that field only decides whether the shell *offers* the
 * tool, the same "picker is a convenience, this endpoint is the boundary"
 * rule `handlePlan`'s model check already follows (ADR-0006).
 */
async function requireAdmin(
  request: Request,
  env: Env,
): Promise<{ denied: Response } | { denied: null; adminEmail: string }> {
  if (!adminConfigured(env)) {
    return {
      denied: json(
        {
          error: 'The admin credit tool is not configured for this deployment.',
        },
        503,
      ),
    };
  }
  const resolved = await resolvePrincipal(request, env);
  if (resolved.denied) return { denied: resolved.denied };
  const { principal } = resolved;
  if (
    !isPlatformAdmin(
      { email: principal.email, emailVerified: principal.emailVerified },
      parsePlatformAdmins(env.VIBLD_PLATFORM_ADMINS),
    )
  ) {
    return { denied: json({ error: 'Not authorized.' }, 403) };
  }
  return { denied: null, adminEmail: principal.policyIdentity };
}

/**
 * GET -> a user's current spendable credit and admin-grant history, looked
 * up by email. What the admin tool shows before granting more, so a repeat
 * visit does not mean guessing whether an earlier grant already landed.
 */
async function handleAdminUser(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);

  const admin = await requireAdmin(request, env);
  if (admin.denied) return admin.denied;

  const email = new URL(request.url).searchParams.get('email');
  if (!email)
    return json({ error: 'A "email" query parameter is required.' }, 400);

  const lookup = await findClerkUserIdByEmail(env, email);
  if (!lookup.ok) return json({ error: lookup.error }, 404);

  const billing = new BillingStore(env.DB!);
  const [creditMicroUsd, grants] = await Promise.all([
    billing.totalSpendableCreditMicroUsd(lookup.userId),
    billing.listAdminCredits(lookup.userId),
  ]);
  return json({
    userId: lookup.userId,
    spendableCreditMicroUsd: creditMicroUsd,
    grants: grants.map((grant) => ({
      creditUsdCents: grant.creditUsdCents,
      grantedByEmail: grant.grantedByEmail,
      note: grant.note,
      createdAt: grant.createdAt,
    })),
  });
}

/** POST -> grant a user manual spend credit (docs/decisions.md L4). */
async function handleAdminTopup(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const admin = await requireAdmin(request, env);
  if (admin.denied) return admin.denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }

  const parsed = parseAdminTopupRequest(body);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);

  const lookup = await findClerkUserIdByEmail(env, parsed.value.email);
  if (!lookup.ok) return json({ error: lookup.error }, 404);

  const billing = new BillingStore(env.DB!);
  const id = crypto.randomUUID();
  await billing.grantAdminCredit(
    id,
    lookup.userId,
    parsed.value.amountUsdCents,
    admin.adminEmail,
    parsed.value.note,
  );
  // The row itself is the audit trail; this line is only for a live
  // `wrangler tail` to catch the same grant in real time.
  console.log(
    `admin credit granted: ${admin.adminEmail} -> ${lookup.userId} (${parsed.value.amountUsdCents}c)`,
  );

  return json({
    ok: true,
    userId: lookup.userId,
    creditUsdCents: parsed.value.amountUsdCents,
  });
}

async function handlePlan(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Use POST.' }, 405);
  }

  // Cheap rejections first, so a hostile request is refused before it costs
  // anything: shape, then size, then identity, then content.
  const origin = checkRequestOrigin(
    request.headers,
    new URL(request.url).origin,
  );
  if (!origin.ok) return json({ error: origin.error }, origin.status);

  const size = checkBodySize(request.headers);
  if (!size.ok) return json({ error: size.error }, size.status);

  // Per-IP, ahead of identity (docs/decisions.md L29): the burst gates below
  // key on the caller's Clerk user id, so a flood of garbage or expired
  // tokens -- each still costing a JWKS verification -- would otherwise
  // reach resolvePrincipal every time. Fails open on the limiter itself
  // being unavailable, the same as the per-user gates below; a rate limiter
  // outage is not a reason to refuse every legitimate caller.
  if (env.IP_BURST) {
    try {
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      const result = await env.IP_BURST.limit({ key: `ip:${ip}` });
      if (!result.success) {
        return json({ error: 'Too many requests from this address.' }, 429);
      }
    } catch (error) {
      console.error('IP rate limiter unavailable', error);
    }
  }

  // Whether this deployment can generate at all -- keys, Clerk, and the
  // ledger -- is checked before spending effort on any one caller's token.
  if (!isConfigured(env)) {
    return json(
      { error: 'Model generation is not configured for this deployment.' },
      403,
    );
  }

  const resolved = await resolvePrincipal(request, env);
  if (resolved.denied) return resolved.denied;
  const { principal } = resolved;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }

  const parsed = parseGenerationRequest(body);
  if (!parsed.ok) {
    return json({ error: parsed.error }, parsed.status);
  }

  const style = parseStylePreset(body);
  if (!style.ok) {
    return json({ error: style.error }, style.status);
  }

  const styleDna = parseStyleDna(body);
  if (!styleDna.ok) {
    return json({ error: styleDna.error }, styleDna.status);
  }

  const knowledge = parseKnowledge(body);
  if (!knowledge.ok) {
    return json({ error: knowledge.error }, knowledge.status);
  }

  const referenceUrl = parseReferenceUrl(body);
  if (!referenceUrl.ok) {
    return json({ error: referenceUrl.error }, referenceUrl.status);
  }
  // Fetched here, before anything is reserved against the caller's budget --
  // the same reasoning as every other validation above. A failed fetch is
  // reported and the request stops; it never silently proceeds without the
  // reference material the caller specifically asked for.
  let referenceContext: string | undefined;
  if (referenceUrl.value) {
    const fetched = await fetchReferenceContext(referenceUrl.value);
    if (!fetched.ok) {
      return json({ error: fetched.error }, 422);
    }
    referenceContext = fetched.text;
  }

  const chosenModel = parseModel(body, configuredProviders(env));
  if (!chosenModel.ok) {
    return json({ error: chosenModel.error }, chosenModel.status);
  }

  // The picker only offers what this person may use, but the picker is a
  // convenience and this endpoint is the boundary. Model policy is keyed by
  // email (L4), not the Clerk user id the ledger below uses (L3) -- it is a
  // human-edited secret that predates Clerk.
  const decision = decideModel(
    env,
    principal.policyIdentity,
    chosenModel.value,
    resolveModel(env),
  );
  if (!decision.ok) return json({ error: decision.error }, decision.status);
  const effectiveModel = decision.model;

  // Layer one: a burst gate keyed on the caller. It is per-location and
  // documented as permissive, so it stops a naive flood and nothing more --
  // it is allowed to fail open only because the layer below fails closed.
  try {
    const key = `plan:${principal.userId}`;
    const gates = [env.PLAN_BURST, env.PLAN_SUSTAINED].filter(
      (gate): gate is RateLimit => gate !== undefined,
    );
    const results = await Promise.all(gates.map((gate) => gate.limit({ key })));
    if (results.some((result) => !result.success)) {
      return json(
        { error: 'Too many generation requests. Try again shortly.' },
        429,
      );
    }
  } catch (error) {
    console.error('rate limiter unavailable', error);
  }

  // Layer two: the ceiling. The worst case is charged before the run, because
  // charging afterwards gives an accurate ledger and no limit -- concurrent
  // callers would all read the same balance and all find headroom.
  const chosen = findModel(effectiveModel);
  const prices = parsePrices(
    env,
    providerForRequest(env, effectiveModel),
    chosen
      ? {
          inputMicroUsd: chosen.inputMicroUsd,
          outputMicroUsd: chosen.outputMicroUsd,
        }
      : undefined,
  );
  const worstCase = worstCaseMicroUsd(
    prices,
    DEFAULT_MAX_TOKENS,
    // Prompt plus the base project that goes with it. Both are what the
    // guard above has already refused to exceed.
    DEFAULT_LIMITS.maxPromptChars +
      DEFAULT_LIMITS.maxTotalContentChars +
      DEFAULT_LIMITS.maxKnowledgeChars +
      MAX_REFERENCE_CHARS,
  );

  // Layer three: what the caller's own subscription actually buys them
  // (L35-L39) -- a monthly allowance by tier, plus whatever top-up credit
  // they have left.
  let reserved;
  try {
    const now = Date.now();
    const billing = new BillingStore(env.DB!);
    // Also here, and not only in handleBillingStatus: a client that never
    // calls the status endpoint must not be refused its first generation for
    // want of a credit it was promised. The deterministic id means whichever
    // path arrives first wins and the other is a no-op.
    await grantSignupCreditOnce(billing, principal.userId, env);
    const subscription = await billing.findActiveSubscription(principal.userId);
    const tier = tierFor(subscription);
    const freeAllowance = positiveInt(
      env.VIBLD_FREE_MONTHLY_MICRO_USD,
      DEFAULT_FREE_INCLUDED_MICRO_USD,
    );
    const monthlyAllowance = monthlyAllowanceMicroUsd(tier, freeAllowance);
    // Stripe top-ups and admin-granted credit (L4) combined -- see
    // `totalSpendableCreditMicroUsd`'s own comment.
    const topupCeiling = await billing.totalSpendableCreditMicroUsd(
      principal.userId,
    );

    reserved = await reserveBudget(
      env,
      principal.userId,
      worstCase,
      monthlyAllowance,
      topupCeiling,
      now,
    );
  } catch (error) {
    // Fail closed. A retry costs the user a minute; an unbounded endpoint on
    // a public URL costs real money. 503 rather than 429: this is the
    // service's problem, and telling the user they did too much is a lie.
    console.error('spend ledger unavailable', error);
    return new Response(
      JSON.stringify({
        error: 'Usage accounting is unavailable; generation is paused.',
      }),
      { status: 503, headers: { ...JSON_HEADERS, 'retry-after': '30' } },
    );
  }

  if (!reserved.ok) {
    return json(
      {
        error:
          reserved.verdict.reason === 'period-ceiling'
            ? "This month's generation budget is used up. Buy a top-up to keep going, or it resets on the 1st (UTC)."
            : 'A generation is already running. Wait for it to finish.',
      },
      429,
    );
  }
  const reservation = reserved.layers.user;
  // Reservations settle inside the Workflow itself now (generation-workflow.ts's
  // 'settle-budget' step), once the run's real usage is known -- `handlePlan`
  // no longer holds the model call in its own scope to settle around. A run
  // this connection never sees complete (a crash, a terminated instance that
  // never reached that step) still settles: it falls back to `budget.ts`'s
  // existing abandoned-reservation reclaim, the same backstop a Worker dying
  // mid-request already relied on.

  const runId = crypto.randomUUID();
  // One project per Clerk user -- there is no multi-project UI yet, so the
  // user id is the whole of "which project" for now. See WorkflowParams's
  // own comment.
  const projectId = principal.userId;

  let instance;
  try {
    instance = await env.GENERATION_WORKFLOW!.create({
      id: runId,
      params: {
        projectId,
        runId,
        prompt: parsed.value.prompt,
        base: parsed.value.base,
        ...(style.value ? { style: style.value } : {}),
        ...(Object.keys(styleDna.value).length > 0
          ? { styleDna: styleDna.value }
          : {}),
        ...(knowledge.value ? { knowledge: knowledge.value } : {}),
        ...(referenceContext ? { referenceContext } : {}),
        model: effectiveModel,
        userId: principal.userId,
        ...(principal.email ? { email: principal.email } : {}),
        reservationId: reservation.id,
        reservationKey: reserved.layers.userReservationKey,
        accountReservationId: reserved.layers.account.id,
        worstCaseMicroUsd: worstCase,
        prices,
      },
    });
  } catch (error) {
    console.error('failed to start generation workflow', error);
    return json(
      { error: 'Generation could not be started. Try again shortly.' },
      503,
    );
  }

  // Stream rather than buffer. A buffered response sends nothing until the
  // run finishes, and the client gives up first -- which surfaces as an
  // opaque network error, not a failed generation.
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const keepaliveMs = parseKeepaliveMs(env.VIBLD_STREAM_KEEPALIVE_MS);

  let keepalive: ReturnType<typeof setInterval> | undefined;
  const stopKeepalive = () => {
    if (keepalive !== undefined) {
      clearInterval(keepalive);
      keepalive = undefined;
    }
  };

  // A run nobody is waiting for should stop, not run to completion unread.
  // Termination lands at the Workflow's next step boundary, not mid-step
  // (generation-workflow.ts's own module comment), so a cancel that arrives
  // while the model call itself is in flight cannot stop that one call --
  // the ledger's abandoned-reservation reclaim is the backstop either way.
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    stopKeepalive();
    ctx.waitUntil(instance.terminate().catch(() => {}));
  };

  // Two independent notices that the client is gone. The runtime aborts
  // `request.signal` on disconnect; a failed write catches the same thing at
  // the next keepalive, which is the backstop if the signal is unavailable.
  request.signal?.addEventListener('abort', cancel);

  const write = (chunk: string) =>
    writer.write(encoder.encode(chunk)).catch(cancel);

  // First bytes immediately, so the connection is never idle from the start.
  void write(KEEPALIVE_COMMENT);
  keepalive = setInterval(() => void write(KEEPALIVE_COMMENT), keepaliveMs);

  const run = (async () => {
    try {
      for (;;) {
        if (cancelled) return;

        let status;
        try {
          status = await instance.status();
        } catch (error) {
          console.error('workflow status unavailable', error);
          if (!cancelled) {
            await write(
              encodeEvent('error', {
                error: 'Generation failed unexpectedly.',
              }),
            );
          }
          return;
        }

        if (status.status === 'complete') {
          const result = status.output as {
            state: string;
            accepted?: { revision: string; files: unknown[] };
            errors: string[];
            summary?: string;
          };
          if (result.state === 'accepted' && result.accepted) {
            await write(
              encodeEvent('plan', {
                providerId: effectiveModel,
                plan: {
                  summary: result.summary ?? '',
                  files: result.accepted.files,
                },
              }),
            );
          } else {
            await write(
              encodeEvent('error', {
                error: result.errors[0] ?? 'Generation failed.',
              }),
            );
          }
          return;
        }

        if (status.status === 'errored' || status.status === 'terminated') {
          if (!cancelled) {
            await write(
              encodeEvent('error', {
                error:
                  status.error?.message ?? 'Generation failed unexpectedly.',
              }),
            );
          }
          return;
        }

        // Still queued, running, paused or waiting: nothing new to report.
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    } finally {
      stopKeepalive();
      await writer.close().catch(() => {});
    }
  })();

  ctx.waitUntil(run);

  return new Response(readable, { status: 200, headers: STREAM_HEADERS });
}

/**
 * Start, check on, or stop a live preview of the caller's own project
 * (docs/decisions.md L7-L11). Thin by design: every real decision --
 * concurrency, egress, lifetime -- is `@vibld/preview`'s; this only
 * authenticates the caller and forwards their own userId, never trusting
 * one a client could supply itself.
 */
async function handlePreview(request: Request, env: Env): Promise<Response> {
  if (!previewConfigured(env)) {
    return json(
      { error: 'Preview is not configured for this deployment.' },
      503,
    );
  }

  const resolved = await resolvePrincipal(request, env);
  if (resolved.denied) return resolved.denied;
  const { principal } = resolved;

  if (request.method === 'GET') {
    return json(await previewStatus(env, principal.userId));
  }

  if (request.method === 'POST') {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Body must be valid JSON.' }, 400);
    }
    const files = parsePreviewRequest(body);
    if (!files.ok) return json({ error: files.error }, files.status);
    return json(await startPreview(env, principal.userId, files.value));
  }

  if (request.method === 'DELETE') {
    await stopPreview(env, principal.userId);
    return json({ ok: true });
  }

  return json({ error: 'Use GET, POST or DELETE.' }, 405);
}

/**
 * Create, list, or revoke share links for the caller's own preview (L10).
 * Same authentication as `handlePreview` -- this Worker still never trusts
 * a userId the browser could supply itself, share links included.
 */
async function handlePreviewShare(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!previewConfigured(env)) {
    return json(
      { error: 'Preview is not configured for this deployment.' },
      503,
    );
  }

  const resolved = await resolvePrincipal(request, env);
  if (resolved.denied) return resolved.denied;
  const { principal } = resolved;

  if (request.method === 'GET') {
    const shares = await listShares(env, principal.userId);
    return json({ shares });
  }

  if (request.method === 'POST') {
    const result = await createShare(env, principal.userId);
    if (!result.ok) return json({ error: result.error }, 409);
    return json({
      shareId: result.shareId,
      expiresAt: result.expiresAt,
      url: result.url,
    });
  }

  if (request.method === 'DELETE') {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Body must be valid JSON.' }, 400);
    }
    const { shareId } = (body ?? {}) as { shareId?: unknown };
    if (typeof shareId !== 'string' || shareId.length === 0) {
      return json({ error: '"shareId" is required.' }, 400);
    }
    await revokeShare(env, principal.userId, shareId);
    return json({ ok: true });
  }

  return json({ error: 'Use GET, POST or DELETE.' }, 405);
}

/**
 * Cloudflare auto-publish (ADR-0010, docs/decisions.md L40): build the
 * caller's own project, then publish the result. `files` is the accepted
 * checkpoint's own source -- the same client-supplied shape `/api/preview`
 * already takes (`parsePreviewRequest`), not something this Worker reads
 * back from D1/R2 itself. Thin by design, same reason `handlePreview` is:
 * every real decision (how a build runs, where it is served from) belongs
 * to apps/preview and apps/publish, not here.
 */
async function handlePublish(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Use POST.' }, 405);
  }
  if (!autoPublishConfigured(env)) {
    return json(
      { error: 'Publishing is not configured for this deployment.' },
      503,
    );
  }

  const resolved = await resolvePrincipal(request, env);
  if (resolved.denied) return resolved.denied;
  const { principal } = resolved;

  // A real build and a real R2 write, not a model call -- its own gate
  // rather than PLAN_BURST's, and checked after identity (unlike IP_BURST)
  // since it is priced per caller, not per flood.
  if (env.PUBLISH_BURST) {
    try {
      const result = await env.PUBLISH_BURST.limit({
        key: `publish:${principal.userId}`,
      });
      if (!result.success) {
        return json(
          { error: 'Too many publish requests. Try again shortly.' },
          429,
        );
      }
    } catch (error) {
      console.error('publish rate limiter unavailable', error);
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }

  const parsed = parsePreviewRequest(body);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);

  const { slug } = (body ?? {}) as { slug?: unknown };
  if (slug !== undefined && (typeof slug !== 'string' || slug.length === 0)) {
    return json({ error: '"slug" must be a non-empty string.' }, 400);
  }

  const built = await buildProject(env, principal.userId, parsed.value);
  if (!built.ok) return json({ error: built.error }, 422);

  // One project per Clerk user, same convention `handlePlan` already uses --
  // there is no multi-project UI yet.
  const projectId = principal.userId;
  const published = await publishProject(
    env,
    principal.userId,
    projectId,
    slug,
    built.files,
  );
  if (!published.ok) {
    return json({ error: published.error }, published.status);
  }
  return json({
    slug: published.slug,
    url: published.url,
    skipped: built.skipped,
  });
}

/** The slice of Cloudflare's ExecutionContext this Worker uses. */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const { pathname } = new URL(request.url);

    // Lets the shell show which provider is actually in use instead of
    // implying AI when it is running the deterministic fake.
    if (pathname === '/api/config') {
      if (!isConfigured(env)) {
        return json(
          { error: 'Model generation is not configured for this deployment.' },
          403,
        );
      }

      // Identified before answered: the picker is per-person now, so this
      // cannot be served to an anonymous caller without telling them what
      // somebody else may use.
      const resolved = await resolvePrincipal(request, env);
      if (resolved.denied) return resolved.denied;
      const { principal } = resolved;

      // Two filters, in order. What the deployment can serve at all --
      // offering a model whose provider has no key produces a run that fails
      // after the user has waited for it. Then what this person is granted
      // (by email, per L4 -- see the same note in handlePlan).
      const models = grantedFor(env, principal.policyIdentity);
      // The deployment default is only offered if this person may use it.
      const decided = decideModel(
        env,
        principal.policyIdentity,
        null,
        resolveModel(env),
      );
      return json({
        generation: isConfigured(env) ? 'model' : 'fake',
        models: models.map(({ id, label, note, provider }) => ({
          id,
          label,
          note,
          provider,
        })),
        defaultModel: decided.ok ? decided.model : null,
        // So the shell knows whether to offer the admin credit tool at all --
        // `/api/admin/*` itself re-checks this independently either way
        // (ADR-0006), the same as every other grant this endpoint reports.
        isAdmin: isPlatformAdmin(
          { email: principal.email, emailVerified: principal.emailVerified },
          parsePlatformAdmins(env.VIBLD_PLATFORM_ADMINS),
        ),
      });
    }

    if (pathname === '/api/plan') {
      return handlePlan(request, env, ctx);
    }

    if (pathname === '/api/preview') {
      return handlePreview(request, env);
    }

    if (pathname === '/api/preview/share') {
      return handlePreviewShare(request, env);
    }

    if (pathname === '/api/publish') {
      return handlePublish(request, env);
    }

    if (pathname === '/api/billing/status') {
      return handleBillingStatus(request, env);
    }

    if (pathname === '/api/billing/checkout') {
      return handleBillingCheckout(request, env, new URL(request.url).origin);
    }

    if (pathname === '/api/billing/portal') {
      return handleBillingPortal(request, env, new URL(request.url).origin);
    }

    if (pathname === '/api/stripe/webhook') {
      return handleStripeWebhook(request, env);
    }

    if (pathname === '/api/admin/user') {
      return handleAdminUser(request, env);
    }

    if (pathname === '/api/admin/topup') {
      return handleAdminTopup(request, env);
    }

    return json({ error: 'Not found.' }, 404);
  },

  /**
   * Nightly reconcile (docs/decisions.md L13): Stripe, not this deployment's
   * own mirror, is authoritative, and a webhook delivery can be missed or
   * fail. The Cron Trigger that calls this is declared in wrangler.jsonc.
   * Also runs the L44 provider-balance check -- same "daily," same trigger,
   * no separate cron to declare.
   */
  async scheduled(
    _event: unknown,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (billingConfigured(env)) {
      ctx.waitUntil(
        reconcileSubscriptions(
          createStripeClient(env),
          new BillingStore(env.DB!),
        ).then(
          (result) =>
            console.log(
              JSON.stringify({ event: 'billing.reconciled', ...result }),
            ),
          (error: unknown) => console.error('billing reconcile failed', error),
        ),
      );
    }

    ctx.waitUntil(
      checkProviderBalances(env).then(
        (result) =>
          console.log(
            JSON.stringify({ event: 'provider_balance.checked', ...result }),
          ),
        (error: unknown) =>
          console.error('provider balance check failed', error),
      ),
    );
  },
};
