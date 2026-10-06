import {
  MockupProvider,
  availableModels,
  configuredProviders,
  createPlanClient,
  resolveModel,
} from '@vibld/ai';
import type { MediaManifestEntry, PlanUsage } from '@vibld/ai';
import { DEFAULT_PROJECT_NAME, sleep } from '@vibld/core';
import type { RunRefusal } from '@vibld/core';

import {
  signInConfigured,
  signInMode,
  resolvePrincipal,
  type Principal,
  type PrincipalEnv,
} from './principal.ts';
import { handleOwnerSession, ownerIdentity } from './owner-auth.ts';
import { withClientAddress } from './client-address.ts';
import { accountDirectoryFor } from './account-directory.ts';
import {
  handleAccountImport,
  handleAccountList,
  handleAdminList,
} from './admin-accounts.ts';
import { listClerkUsers } from './clerk-lookup.ts';
import { UserBudget } from './budget.ts';
import type { Reservation } from './budget.ts';
import { GenerationWorkflow } from './generation-workflow.ts';
import { D1GenerationStore } from './generation-store.ts';
import type { WorkflowParams } from './generation-workflow.ts';
import {
  checkBodySize,
  checkRequestOrigin,
  parseGenerationRequest,
  parseKnowledge,
  parseChosenMockup,
  parseMockupRequest,
  isProjectId,
  parseModel,
  parsePreviewRequest,
  parsePreviewRevision,
  parseProjectId,
  parseAdminTopupRequest,
  parseReferenceUrl,
  parseGalleryColors,
  parseGalleryStyle,
  parseStyleDna,
  parseStylePreset,
} from './request-guard.ts';
import { fetchReferenceContext } from './reference-fetch.ts';
import { handleMedia, handleMediaFile } from './media-handlers.ts';
import { handleStyleGallery, readGalleryStyle } from './style-gallery.ts';
import type { StyleGalleryEnv } from './style-gallery.ts';
import { handleTemplateBrief } from './template-briefs.ts';
import { handleChat } from './chat-handler.ts';
import {
  DEFAULT_PUBLISH_HOSTNAME,
  handleProjects,
} from './project-handlers.ts';
import type { ProjectLinks } from './project-handlers.ts';
import {
  checkingUpdate,
  endedWith,
  handleRun,
  settleStopped,
  stopAccountBuilds,
} from './run-control.ts';
import {
  ProjectStore,
  liveSiteProjects,
  resolveRunProject,
  resolveSiteProject,
} from './project-store.ts';
import type { SiteProject } from './project-store.ts';
import { handleShare, handleShareHold } from './share-handlers.ts';
import { sharePreviewKey, shareTokenFromLink } from './share-link.ts';
import { MediaStore } from './media-store.ts';
import {
  freeAllowanceOf,
  SUSPENDED_MESSAGE,
  planOf,
  spendableFor,
  tierOf,
} from './spendable.ts';
import { sanitizedProviderFailure, settleBudget } from './generation-run.ts';
import { POLL_INTERVAL_MS, phaseFor, stageFor, stepFor } from './run-stage.ts';
import { isCheckVerdict } from '../src/generation/build-check.ts';
import { RunProgress } from './run-progress.ts';
import {
  refusalFor,
  reserveAccount,
  reserveBudget,
  topupKeyFor,
} from './reserve.ts';
import { whenClientGone } from './client-gone.ts';
import { isPlatformAdmin, platformAdminsFor } from './platform-admins.ts';
import {
  NO_PANEL,
  decideModel,
  draftModelFor,
  grantedFor,
  pickerEntries,
  planModelsNote,
} from './model-access.ts';
import type { ModelGrantSource } from './model-access.ts';
import {
  handleModelAccess,
  isModelRoute,
  modelGrantSource,
} from './model-grants.ts';
import { signupCreditStatus } from './signup-credit.ts';
import {
  handleReferralClaim,
  handleReferralStatus,
} from './referral-handlers.ts';
import {
  ACCOUNT_BUDGET_KEY,
  NOTHING_TO_BILL,
  cancelledUsage,
  microUsdOf,
  worstCaseMicroUsd,
} from './spend.ts';
import type { TokenPrices } from './spend.ts';
import {
  BOUNDED_BUILD_INPUT_CHARS,
  MOCKUP_INPUT_CHARS,
  buildFloorSize,
  carryTokensFor,
  fitBuildToCaller,
  runCeilingFor,
  sizedReservation,
} from './run-ceiling.ts';
import type { BuildSize } from './run-ceiling.ts';
import {
  allowancePeriodKey,
  monthlyAllowanceFor,
  tierFor,
} from './entitlement.ts';
import type { Tier } from './entitlement.ts';
import { securedApp } from '../src/crawling.ts';
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
  previewMode,
  previewStatus,
  UNREADABLE_PREVIEW,
  outcomeResponse,
  revokeShare,
  startPreview,
  stopPreview,
  updatePreview,
} from './preview-client.ts';
import type { ServiceBinding } from './preview-client.ts';
import {
  askWhileBusy,
  autoPublishConfigured,
  buildProject,
  buildWithin,
  publishProject,
  publishServiceConfigured,
  holdProject,
  releaseProject,
  unpublishProject,
} from './publish-client.ts';
import {
  billingConfigured,
  clawbackDepsFor,
  clawbackViewOf,
  handleBillingCard,
  handleLiftSuspension,
  handleBillingCheckout,
  handleBillingPortal,
  handleBillingCancel,
  handleStripeWebhook,
  handleUnattributedQueue,
  readSetupIntent,
  reconcileSubscriptions,
} from './billing-handlers.ts';
import { checkProviderBalances } from './provider-balance.ts';
import {
  handlePlanLimits,
  isPlanRoute,
  planLimitsFor,
  savedPlanLimits,
} from './plan-limits.ts';
import {
  handleProviderKeys,
  isKeyRoute,
  panelKeyQueries,
  withPanelKeys,
} from './provider-keys.ts';
import { BillingStore } from './billing-store.ts';
import { ReferralStore } from './referral-store.ts';
import {
  clawBackReferral,
  payReferralIfEarned,
  resumeStrandedPayouts,
} from './referral-payout.ts';
import {
  handleGitHubBind,
  handleGitHubCallback,
  handleGitHubComplete,
  handleGitHubConnect,
  handleGitHubDisconnect,
  handleGitHubDisconnectAccount,
  handleGitHubDiff,
  handleGitHubWebhook,
  handleGitHubPush,
  handleGitHubStatus,
} from './github-handlers.ts';
import {
  DEFAULT_QUERY_BUDGET,
  payoutBatchFor,
  payoutReserveFor,
  reconcileBatchFor,
  reconcileReserveFor,
  replayBudgetFor,
  replayStripeEvents,
  retryBatchFor,
  retryUnattributedEvents,
  QUERIES_PER_TURN,
  planNight,
} from './billing-replay.ts';
import type {
  NightPlan,
  NightTurn,
  NightWithDeletion,
} from './billing-replay.ts';
import { createStripeClient } from './stripe-client.ts';
import { isGated, routeKeyFor } from './access-gate.ts';
import {
  QUERIES_TO_FIND_DELETIONS,
  accountDeletionConfigured,
  deletionDepsFor,
  findDeletionWork,
  requestAccountDeletion,
  runDeletionNight,
} from './account-deletion.ts';
import { AccountDeletionStore } from './account-deletion-store.ts';
import { AdminStore, type AuditEntry } from './admin-store.ts';
import { handleOverview, readBalances } from './admin-overview.ts';
import {
  appendAudit,
  handleAdminUsers,
  isAdminUserRoute,
  withAudit,
} from './admin-users.ts';
import type { AdminUsersDeps } from './admin-users.ts';
import type { DeletionLookup } from './account-deletion.ts';
import {
  handleAccountDelete,
  handleAccountDeleteCancel,
  handleAdminDeletions,
} from './account-deletion-handlers.ts';
import {
  decideAccessFor,
  handleAccessStatus,
  handleInvite,
  handleInviteList,
  handleInviteRevoke,
  refusal,
} from './access-handlers.ts';

export interface Env extends PrincipalEnv, StyleGalleryEnv {
  /** Worker secret. Never reaches the browser. */
  ANTHROPIC_API_KEY?: string;
  /** Worker secret. Never reaches the browser. */
  DEEPSEEK_API_KEY?: string;
  OPENAI_API_KEY?: string;
  /**
   * A model the owner runs on their own machine (D124, D138): the server's
   * OpenAI-compatible base URL, the model's name on it, and a key only for a
   * server started with one. See `local-client.ts` in @vibld/ai.
   */
  VIBLD_LOCAL_BASE_URL?: string;
  VIBLD_LOCAL_MODEL?: string;
  VIBLD_LOCAL_API_KEY?: string;
  /** "browser" when the sandbox cannot serve previews; see `previewMode`. */
  VIBLD_PREVIEW?: string;
  /** The proxy's client-address header, behind one; see client-address.ts. */
  VIBLD_CLIENT_IP_HEADER?: string;
  /** "anthropic", "deepseek", "openai" or "local". Explicit beats inferred; see selectProvider. */
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
   * The live progress channel a running generation reports through (internal issue 183),
   * read by the poll loop and written by the Workflow step.
   *
   * Optional, unlike the ledger, because what it carries is decoration
   * rather than a control: an absent count is an absent count, and the
   * meter shows the clock alone, which is what it showed before this
   * existed.
   */
  RUN_PROGRESS?: DurableObjectNamespace<
    Pick<
      RunProgress,
      'read' | 'hold' | 'claimSettlement' | 'spentByCalls' | 'stopCharged'
    >
  >;
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
   * Cents of one-time credit a new account is granted once it has a card on
   * file (a Stripe setup-mode Checkout, which charges nothing). Defaults to
   * 100 ($1.00); "0" stops new offers.
   *
   * Separate money from VIBLD_FREE_MONTHLY_MICRO_USD above, which resets
   * every month. This does not reset, and is spent from the same top-up
   * bucket as Stripe purchases and admin grants. See signup-credit.ts.
   */
  VIBLD_SIGNUP_CREDIT_USD_CENTS?: string;
  /**
   * ISO 8601. Only accounts created at or after this instant are offered
   * the credit above. Unset means no grants at all: any default early enough to
   * catch new accounts also catches every account that already exists, and
   * this is money. See signup-credit.ts.
   */
  VIBLD_SIGNUP_CREDIT_FROM?: string;
  /** Runs one user may have in flight at once. */
  VIBLD_MAX_IN_FLIGHT?: string;
  /**
   * "open" opens this deployment to anybody who can sign in. Anything else,
   * including unset, is invite-only (access.ts). Unset is closed on purpose:
   * a deployment that has never considered the question should not be the
   * one handing out model spend to the internet.
   */
  VIBLD_ACCESS_MODE?: string;
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
  /** Uploads to the media library, per caller (`media-handlers.ts`). */
  MEDIA_BURST?: RateLimit;
  /**
   * A project's share link, per address (`share-handlers.ts`): the view,
   * and the live preview's state and start. Keyed on the address rather
   * than a user, because nobody signs in to follow a link, and checked
   * before the database is read.
   */
  SHARE_BURST?: RateLimit;
  /** Remixing a shared project, per caller: code and media copied into R2. */
  REMIX_BURST?: RateLimit;
  /**
   * Starting a shared project's live preview, per signed-in caller: a
   * sandbox's time, counted against the account on top of `SHARE_BURST`'s
   * count against the address (docs/decisions.md, 2026-09-28).
   */
  SHARE_PREVIEW_BURST?: RateLimit;
  /**
   * The domain published sites are served under, for the address a
   * project's view shows. apps/publish's own `PUBLISH_HOSTNAME`, which is
   * what actually serves them; unset here means `vibld-preview.dev`, its
   * value there.
   */
  PUBLISH_HOSTNAME?: string;
  /**
   * The GitHub App this deployment pushes with (internal issue 13). Both are Worker
   * secrets and both are Vibld's own infrastructure credential, never a
   * user's (ADR-0006): the private key signs a JWT, the JWT mints an
   * installation token scoped to the one repository a user connected, and
   * that token lives for the length of a push and is never written down.
   * Unset means `/api/github/*` answers "not configured", the same
   * fail-closed rule publishing and billing already use.
   */
  VIBLD_GITHUB_APP_ID?: string;
  VIBLD_GITHUB_PRIVATE_KEY?: string;
  /** Worker secret. The whole of the authentication on /api/github/webhook. */
  VIBLD_GITHUB_WEBHOOK_SECRET?: string;
  /**
   * The OAuth half of the same App (internal issue 121). Connecting a repository has
   * to establish that the person doing it controls the GitHub account,
   * because GitHub's post-install redirect proves nothing on its own: it is
   * an unsigned GET carrying an installation id. These let Vibld ask GitHub,
   * as that user, which installations they can actually reach.
   *
   * Separate from the App id and key above because they gate different
   * things: without these a deployment can still push on a binding it
   * already has, it just cannot make new ones.
   */
  VIBLD_GITHUB_CLIENT_ID?: string;
  VIBLD_GITHUB_CLIENT_SECRET?: string;
  /**
   * A push is several GitHub API calls and a write to somebody's repository,
   * so it gets its own gate keyed on the caller, for the same reason
   * PUBLISH_BURST has one rather than riding PLAN_BURST's.
   */
  GITHUB_BURST?: RateLimit;
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
   * 32 random bytes, base64: the key the admin panel's provider keys are
   * encrypted under in D1 (D127, D132). The deploy workflow creates it once
   * and never replaces it; unset, the panel stores no keys.
   */
  VIBLD_KEY_ENCRYPTION_KEY?: string;
  /**
   * D1 queries the nightly billing replay may spend in one invocation.
   *
   * Unset means the default that is safe on Workers Free. A Workers Paid
   * deployment sets this to clear a backlog faster; see
   * `billing-replay.ts`'s `DEFAULT_QUERY_BUDGET` for why setting it above
   * the plan's real limit is worse than leaving it alone.
   *
   * Below 92, a four-way split cannot buy every phase of the nightly pass an
   * item, so the pass rotates instead (internal issue 176, `nightSharesFor`): the parked
   * queue keeps its floor every night and the other three phases take the
   * rest in turn. The default of 40 is below it.
   */
  VIBLD_REPLAY_QUERY_BUDGET?: string;
  /**
   * Worker secret. Lets `/api/admin/*` resolve an email an admin typed into
   * the Clerk user id the ledger actually keys on -- see clerk-lookup.ts.
   * `/api/admin/*` is unavailable, not open, when this is unset, or when
   * `VIBLD_PLATFORM_ADMINS` is and there is no owner, the same fail-closed rule
   * `isConfigured` already applies to generation.
   */
  CLERK_SECRET_KEY?: string;
}

/** Re-exported so Wrangler can find the classes from the Worker's entrypoint. */
export { UserBudget, GenerationWorkflow, RunProgress };

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Refuse a run, naming which refusal it is.
 *
 * The sentence is for the person reading it and may be rewritten at any
 * time; `reason` is the contract (`RunRefusal` in @vibld/core), and it is
 * what a script branches on, what the builder disables a control with, and
 * what an audit record stores. Before this, every one of these arrived as
 * prose and a status, so "your allowance is spent" and "a run is already
 * going" were both 429 and told apart by reading English.
 *
 * Deliberately not a run record: a refused run is not a failed run, and
 * writing one would put a generation in somebody's history that never
 * happened.
 */
function refuse(reason: RunRefusal, error: string, status: number): Response {
  return json({ error, reason }, status);
}

/**
 * The caller's tier (D66) and the model access saved in the panel (D133)
 * for `decideModel`, or the refusal to send when either cannot be read.
 * Fails closed, as the reservation does, rather than guessing: guessing
 * Free refuses somebody the model they pay for, guessing paid hands a Free
 * account what its plan withholds, and guessing the policy can hand back a
 * model an admin took away.
 */
async function tierOrRefusal(
  env: Env,
  principal: Principal,
): Promise<
  { tier: Tier | null; access: ModelGrantSource } | { refusal: Response }
> {
  try {
    const [tier, access] = await Promise.all([
      tierOf(env, principal),
      env.DB ? modelGrantSource(env.DB, principal.userId) : NO_PANEL,
    ]);
    return { tier, access };
  } catch (error) {
    console.error('tier unavailable', error);
    return {
      refusal: new Response(
        JSON.stringify({
          error: 'Usage accounting is unavailable; generation is paused.',
          reason: 'accounting-unavailable' satisfies RunRefusal,
        }),
        { status: 503, headers: { ...JSON_HEADERS, 'retry-after': '30' } },
      ),
    };
  }
}

/**
 * Generation is available only when the key AND sign-in are configured.
 * Missing configuration means unavailable, never "open" -- an
 * unauthenticated endpoint on a public URL lets anyone spend the account's
 * model budget, so the failure has to be closed.
 */
function isConfigured(env: Env): boolean {
  return Boolean(
    // Any provider's key configures the endpoint, and so does a local model
    // (D124). Which one it selects is `selectProvider`'s business, not this
    // gate's.
    Object.values(configuredProviders(env)).some(Boolean) &&
    signInConfigured(env) &&
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

/**
 * GET -> the caller's own billing status: current tier, this period's spend
 * against their monthly allowance, and any top-up credit remaining. Read-only
 * mirror of exactly what `handlePlan`'s Layer three above computes and
 * reserves against -- `UserBudget` stays the one authoritative ledger, this
 * only reads it back for the shell to show a "generations remaining"
 * readout and drive its checkout/portal buttons (L35).
 */
/**
 * One project's finished runs, newest first (internal issue 167).
 *
 * Read-only, and scoped to the caller's own projects: the builder names the
 * project in `?project=`, and a project that is not the caller's is "not
 * found", the same answer `/api/projects/:id` gives. A request that names
 * none is from a builder older than projects and reads the caller's most
 * recently opened project, which is the one it was showing. An archived
 * project's history can still be read; only building in one is refused.
 *
 * Deliberately not gated behind the invite check, for the same reason
 * `/api/billing/status` is not: somebody whose access was revoked can still
 * see what their own runs did, and refusing the history of a run they paid
 * for reads as the record being taken away.
 */
async function handleRuns(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);

  const resolved = await resolvePrincipal(request, env);
  if (resolved.denied) return resolved.denied;
  const { principal } = resolved;

  if (!env.DB || !env.PROJECT_CONTENT) {
    return json(
      { error: 'Run history is not configured for this deployment.' },
      503,
    );
  }

  const requested = new URL(request.url).searchParams.get('project');
  if (requested !== null && !isProjectId(requested)) {
    return json({ error: 'That project does not exist.' }, 404);
  }
  const store = new D1GenerationStore(env.DB, env.PROJECT_CONTENT);
  try {
    const chosen = await resolveRunProject(
      new ProjectStore(env.DB, env.PROJECT_CONTENT),
      principal.userId,
      requested,
      {
        // A read makes nothing: an account with no project has no runs.
        create: false,
        allowArchived: true,
        newId: () => crypto.randomUUID(),
        now: () => new Date().toISOString(),
        name: DEFAULT_PROJECT_NAME,
      },
    );
    if (!chosen.ok) return json({ error: chosen.error }, chosen.status);
    if (chosen.projectId === null) return json({ runs: [] });
    return json({ runs: await store.tracesForProject(chosen.projectId) });
  } catch (error) {
    // The history is not the run. A database that will not answer must not
    // turn into a builder that looks broken, so this says what failed and
    // the caller renders the rest of the page without it.
    console.error('run history unavailable', error);
    return json({ error: 'Run history is unavailable right now.' }, 503);
  }
}

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
    // Where this account stands with the welcome credit, which since the
    // card requirement is something the builder has to show rather than
    // something that simply arrives: an account offered it sees how to
    // claim it. Deciding may open the offer, so it is not free, but it is
    // idempotent and asks Clerk at most once per account.
    //
    // Gated, even though the route is not. This route is ungated so that
    // somebody invited, who spent, and whose access was then revoked can
    // still see what happened to their money: refusing a balance read
    // tells them nothing and looks like theft. But opening an offer is the
    // first half of a grant, and the grant is the exact thing the invite
    // gate exists to protect.
    //
    // So the read stays open to anyone signed in, and the offer does not.
    // The check is inside `signupCreditStatus` rather than here, so that no
    // caller can be the one that forgets it.
    const signupCredit = await signupCreditStatus(billing, principal, env);
    // The tier the account has, with a gifted plan counted where it is the
    // higher (D73), and an admin's spend cap in place of the tier's
    // allowance where one is set: the same readings `spendableFor` makes,
    // so the panel shows what a run is actually held to.
    const [plan, overrides, savedPlans] = await Promise.all([
      planOf(env.DB, principal.userId, now),
      new AdminStore(env.DB).overrides(principal.userId),
      savedPlanLimits(env.DB),
    ]);
    const { subscription, tier } = plan;
    const freeAllowance = freeAllowanceOf(env);
    const allowanceMicroUsd = monthlyAllowanceFor(
      tier,
      freeAllowance,
      overrides,
      planLimitsFor(tier, savedPlans, freeAllowance),
    );
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
    const suspended = await billing.isSuspended(principal.userId);

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
      signupCredit,
      suspended,
      // The paid plan on its own, so the panel offers "Cancel plan" only
      // where there is a subscription to cancel, which a gift is not.
      planTier: tierFor(subscription),
      // A gifted plan in force, and whether it is the one that decides the
      // tier above, for the panel to say it is gifted and until when.
      gift: plan.gift
        ? {
            tier: plan.gift.tier,
            endsAt: plan.gift.endsAt,
            inUse: plan.gifted,
          }
        : null,
    });
  } catch (error) {
    console.error('billing status unavailable', error);
    return json(
      { error: 'Could not read billing status. Try again shortly.' },
      503,
    );
  }
}

/**
 * What every `/api/admin/*` route needs before it can decide anything: a
 * list of admins to check the caller against, and the database they all
 * read or write.
 *
 * `CLERK_SECRET_KEY` is deliberately not here, and is needed by more routes
 * than it once was. The two credit routes use it to turn a typed email into
 * a Clerk user id, and `POST /api/admin/invite` now uses it to ask Clerk to
 * approve the address as well (`clerk-waitlist.ts`).
 *
 * That makes leaving it out of this check more important rather than less.
 * Requiring it for every admin route made the invite routes answer 503 on a
 * deployment with no credit tool configured, so an operator with a
 * perfectly good admin list could not invite anybody and was told the
 * credit tool was missing, which is true and not the thing they were doing.
 * Each route that wants the key asks for it itself and degrades on its own
 * terms: the credit routes refuse, and inviting records the invite here and
 * reports that Clerk was not asked.
 */
function adminConfigured(env: Env, needsDatabase = true): boolean {
  // VIBLD_PLATFORM_ADMINS, or the owner of an owner-password copy, who is
  // an admin without being listed (D123; Codex review of internal PR 337). Every tool
  // needs D1 but the read-only admin list, which reads the secret (D129).
  return platformAdminsFor(env).size > 0 && (!needsDatabase || Boolean(env.DB));
}

/**
 * The extra requirement of the credit routes, asked after the caller has
 * been established as an admin rather than before: what a deployment has
 * configured is not something an anonymous caller needs told.
 */
function creditToolDenial(env: Env): Response | null {
  return accountDirectoryFor(env).configured
    ? null
    : json(
        {
          error: 'The admin credit tool is not configured for this deployment.',
        },
        503,
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
  { needsDatabase = true }: { needsDatabase?: boolean } = {},
): Promise<{ denied: Response } | { denied: null; adminEmail: string }> {
  if (!adminConfigured(env, needsDatabase)) {
    return {
      denied: json(
        { error: 'Admin access is not configured for this deployment.' },
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
      platformAdminsFor(env),
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
  const unconfigured = creditToolDenial(env);
  if (unconfigured) return unconfigured;

  const email = new URL(request.url).searchParams.get('email');
  if (!email)
    return json({ error: 'A "email" query parameter is required.' }, 400);

  const lookup = await accountDirectoryFor(env).lookupByEmail(email);
  if (!lookup.ok) return json({ error: lookup.error }, 404);

  const billing = new BillingStore(env.DB!);
  const [creditMicroUsd, grants, suspended, clawbacks] = await Promise.all([
    billing.totalSpendableCreditMicroUsd(lookup.userId),
    billing.listAdminCredits(lookup.userId),
    billing.isSuspended(lookup.userId),
    billing.listClawbacks(lookup.userId),
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
    // What refunds and lost disputes removed, beside the credit an operator
    // is about to grant: a grant to somebody whose top-up was just refunded
    // is a different decision from a grant to anybody else.
    suspended,
    clawbacks: clawbacks.map(clawbackViewOf),
  });
}

/**
 * POST { email } -> lift a lost dispute's suspension. The admin check and
 * the Clerk lookup the credit routes use, then `handleLiftSuspension`.
 */
async function handleAdminLiftSuspension(
  request: Request,
  env: Env,
): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin.denied) return admin.denied;
  const unconfigured = creditToolDenial(env);
  if (unconfigured) return unconfigured;
  const response = await handleLiftSuspension(
    request,
    env,
    admin.adminEmail,
    (email) => accountDirectoryFor(env).lookupByEmail(email),
  );
  return withAudit(env.DB!, response, (body) =>
    typeof body.userId === 'string'
      ? {
          at: new Date().toISOString(),
          adminEmail: admin.adminEmail,
          action: 'suspension-lift',
          targetUserId: body.userId,
          target: null,
          reason: null,
          detail: { lifted: body.lifted ?? null },
        }
      : null,
  );
}

/** POST -> grant a user manual spend credit (docs/decisions.md L4). */
async function handleAdminTopup(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const admin = await requireAdmin(request, env);
  if (admin.denied) return admin.denied;
  const unconfigured = creditToolDenial(env);
  if (unconfigured) return unconfigured;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }

  const parsed = parseAdminTopupRequest(body);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);

  const lookup = await accountDirectoryFor(env).lookupByEmail(
    parsed.value.email,
  );
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
  // The grant's own row is the credit record; the audit log (D73) is where
  // every admin action is listed together. This line is only for a live
  // `wrangler tail` to catch the same grant in real time.
  console.log(
    `admin credit granted: ${admin.adminEmail} -> ${lookup.userId} (${parsed.value.amountUsdCents}c)`,
  );
  const audited = await appendAudit(env.DB!, {
    at: new Date().toISOString(),
    adminEmail: admin.adminEmail,
    action: 'topup',
    targetUserId: lookup.userId,
    target: null,
    reason: parsed.value.note,
    detail: { creditUsdCents: parsed.value.amountUsdCents },
  });

  return json({
    ok: true,
    userId: lookup.userId,
    creditUsdCents: parsed.value.amountUsdCents,
    audited,
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

  // When this caller started waiting. Read here, at the top, rather than
  // where the poll loop begins: everything between the two is still wait
  // the person is sitting through. A request naming a reference URL spends
  // up to twelve seconds fetching that page and its stylesheets before a
  // Workflow is even created, and authentication, accounting and creation
  // each cost their own moment. A clock started after all that would open
  // at 0:00 for somebody who had already waited a quarter of a minute, and
  // would hold back the reassurance by exactly as long as the wait that
  // earned it.
  const waitingSince = Date.now();

  // Cheap rejections first, so a hostile request is refused before it costs
  // anything: shape, then size, then identity, then content.
  const origin = checkRequestOrigin(
    request.headers,
    new URL(request.url).origin,
  );
  if (!origin.ok) {
    return refuse('request-invalid', origin.error, origin.status);
  }

  const size = checkBodySize(request.headers);
  if (!size.ok) return refuse('request-invalid', size.error, size.status);

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
        return refuse(
          'rate-limited',
          'Too many requests from this address.',
          429,
        );
      }
    } catch (error) {
      console.error('IP rate limiter unavailable', error);
    }
  }

  // Whether this deployment can generate at all -- keys, Clerk, and the
  // ledger -- is checked before spending effort on any one caller's token.
  if (!isConfigured(env)) {
    return refuse(
      'not-configured',
      'Model generation is not configured for this deployment.',
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
    return refuse('request-invalid', 'Body must be valid JSON.', 400);
  }

  const parsed = parseGenerationRequest(body);
  if (!parsed.ok) {
    return refuse('request-invalid', parsed.error, parsed.status);
  }

  const style = parseStylePreset(body);
  if (!style.ok) {
    return refuse('request-invalid', style.error, style.status);
  }

  const styleDna = parseStyleDna(body);
  if (!styleDna.ok) {
    return refuse('request-invalid', styleDna.error, styleDna.status);
  }

  // A gallery style's tokens file and guidance (D145, D146), read now so a
  // style this copy does not hold, or edits that fail its contrast pairs,
  // are refused before anything is reserved.
  const galleryStyle = parseGalleryStyle(body);
  if (!galleryStyle.ok) {
    return refuse('request-invalid', galleryStyle.error, galleryStyle.status);
  }
  const galleryColors = parseGalleryColors(body);
  if (!galleryColors.ok) {
    return refuse('request-invalid', galleryColors.error, galleryColors.status);
  }
  const gallery = galleryStyle.value
    ? await readGalleryStyle(
        env,
        new URL(request.url).origin,
        galleryStyle.value,
        galleryColors.value,
      )
    : null;
  if (galleryStyle.value && gallery === null) {
    // A style a later import removed (migration 0045): say what to do.
    return refuse(
      'request-invalid',
      'This style is no longer in the gallery. Choose another in Gallery, or clear it.',
      400,
    );
  }
  // The theme guard (D147), on the server as well as in the builder.
  if (gallery && !gallery.ok) {
    return refuse(
      'request-invalid',
      `These color edits fail the style's contrast checks: ${gallery.problems.join('; ')}.`,
      400,
    );
  }

  const knowledge = parseKnowledge(body);
  if (!knowledge.ok) {
    return refuse('request-invalid', knowledge.error, knowledge.status);
  }

  const referenceUrl = parseReferenceUrl(body);
  if (!referenceUrl.ok) {
    return refuse('request-invalid', referenceUrl.error, referenceUrl.status);
  }
  // Fetched here, before anything is reserved against the caller's budget --
  // the same reasoning as every other validation above. A failed fetch is
  // reported and the request stops; it never silently proceeds without the
  // reference material the caller specifically asked for.
  let referenceContext: string | undefined;
  // The colour the reference page was seeded from, as a hex, not the palette
  // it derives. Workflow params are JSON carried across a boundary, and a
  // fifteen-token palette sent through one is fifteen values that arrive
  // trusted. One hex re-derives the whole thing on the other side, which
  // costs a few hundred floating-point operations and re-establishes the
  // contrast guarantee where it is used rather than asserting it travelled.
  let referencePaletteSource: string | undefined;
  let referencePaletteMode: 'light' | 'dark' | undefined;
  if (referenceUrl.value) {
    const fetched = await fetchReferenceContext(referenceUrl.value);
    if (!fetched.ok) {
      return refuse('request-invalid', fetched.error, 422);
    }
    referenceContext = fetched.text;
    referencePaletteSource = fetched.palette?.source;
    referencePaletteMode = fetched.palette?.mode;
  }

  // What the caller has uploaded, so the build can use it and must not
  // invent anything else (`mediaSection`). The library is the account's,
  // shared by every project it has, not the project's: see the README's
  // "Projects" for why media stayed per account. A library that cannot be read is
  // left unknown rather than taken as empty: the build still runs with no
  // media to use, and the design checks skip the media check instead of
  // flagging every /media/ path in a library that does exist.
  let media: MediaManifestEntry[] | undefined;
  if (env.DB && env.PROJECT_CONTENT) {
    try {
      media = (
        await new MediaStore(env.DB, env.PROJECT_CONTENT).list(principal.userId)
      ).map((entry) => ({
        path: entry.path,
        kind: entry.kind,
        alt: entry.alt,
        ...(entry.posterPath ? { posterPath: entry.posterPath } : {}),
      }));
    } catch (error) {
      console.error('media library unavailable', error);
    }
  }

  // The direction the caller picked from a mockup run, if they ran one
  // (internal issue 185). Carried as the document rather than its name: a build seeded
  // with only a label can ignore the choice and still look like it obeyed.
  const chosenMockup = parseChosenMockup(body);
  if (!chosenMockup.ok) {
    return refuse('request-invalid', chosenMockup.error, chosenMockup.status);
  }

  const chosenModel = parseModel(body, configuredProviders(env));
  if (!chosenModel.ok) {
    return refuse('request-invalid', chosenModel.error, chosenModel.status);
  }

  const requestedProject = parseProjectId(body);
  if (!requestedProject.ok) {
    return refuse(
      'request-invalid',
      requestedProject.error,
      requestedProject.status,
    );
  }

  // The picker only offers what this person may use, but the picker is a
  // convenience and this endpoint is the boundary. Model policy is keyed by
  // email (L4), not the Clerk user id the ledger below uses (L3) -- it is a
  // human-edited secret that predates Clerk. The plan is keyed by the user
  // id, and holds a Free account to GPT-6 Luna whatever the policy says (D66).
  const caller = await tierOrRefusal(env, principal);
  if ('refusal' in caller) return caller.refusal;
  const decision = decideModel(
    env,
    principal.policyIdentity,
    caller.tier,
    chosenModel.value,
    resolveModel(env),
    caller.access,
  );
  if (!decision.ok) {
    return refuse('model-not-allowed', decision.error, decision.status);
  }
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
      return refuse(
        'rate-limited',
        'Too many generation requests. Try again shortly.',
        429,
      );
    }
  } catch (error) {
    console.error('rate limiter unavailable', error);
  }

  // Which project this run builds in, established before anything is
  // reserved so that a project that is not the caller's is refused for
  // free. The builder names it; a builder older than projects names none
  // and is given the caller's most recently opened project, or a new one
  // if they have none, so a tab left open across the deploy keeps working
  // on what it was showing (`resolveRunProject`).
  //
  // Refused as `request-invalid` rather than with a reason of its own: the
  // request named something it may not use, which is what that reason
  // already means, and the status says which way (404 for a project that
  // is not theirs, 409 for one they archived).
  let projectId: string;
  try {
    const chosen = await resolveRunProject(
      new ProjectStore(env.DB!, env.PROJECT_CONTENT!),
      principal.userId,
      requestedProject.value,
      {
        create: true,
        newId: () => crypto.randomUUID(),
        now: () => new Date().toISOString(),
        name: DEFAULT_PROJECT_NAME,
      },
    );
    if (!chosen.ok) {
      return refuse('request-invalid', chosen.error, chosen.status);
    }
    projectId = chosen.projectId!;
  } catch (error) {
    console.error('project lookup unavailable', error);
    return json(
      { error: 'Generation could not be started. Try again shortly.' },
      503,
    );
  }

  // Layer two: the ceiling. The worst case is charged before the run, because
  // charging afterwards gives an accurate ledger and no limit -- concurrent
  // callers would all read the same balance and all find headroom.
  // Priced and ceilinged in one call, so the reservation below and the
  // request `GenerationWorkflow` will send are the same two numbers rather
  // than two derivations that have to be kept in step. A reservation is a
  // promise that the run cannot cost more than this: reserving for 64000
  // tokens while letting the model emit 384000 is a run that outspends its
  // own reservation six times over.
  //
  // A build is bounded steps now (`packages/ai/src/bounded-build.ts`), so
  // both numbers cover the whole run rather than one call: the output
  // budget is summed across its calls, and the input is what all of them
  // may send together. The Workflow is told both and refuses a call that
  // would pass either, so the run cannot outspend this however many steps
  // it takes.
  //
  // A follow-up is sized to carry the project it edits as well (internal issue 209). A
  // follow-up is a patch now and no longer re-emits every file, but one
  // that rewrites most of a large project still writes as much as that, so
  // the room stays until the maintainer decides otherwise.
  const carry =
    env.DB && env.PROJECT_CONTENT
      ? await carryTokensFor(
          new D1GenerationStore(env.DB, env.PROJECT_CONTENT),
          projectId,
          parsed.value.baseRevision,
        )
      : 0;
  const sizeFor = (carryTokens: number): BuildSize => {
    const ceiling = runCeilingFor(env, effectiveModel, 'build', carryTokens);
    return {
      ceiling,
      inputChars: BOUNDED_BUILD_INPUT_CHARS,
      worstCase: worstCaseMicroUsd(
        ceiling.prices,
        ceiling.maxTokens,
        BOUNDED_BUILD_INPUT_CHARS,
      ),
    };
  };
  // Assigned by the reservation below, which may settle on the ordinary
  // size rather than the carried one (internal PR 210 review), or on a smaller one
  // sized to what the caller has left (`fittedBuildSize`). Everything after
  // it, the Workflow's params included, reads what was actually reserved.
  let prices: TokenPrices;
  let maxTokens: number;
  let inputChars: number;
  let worstCase: number;

  // Layer three: what the caller's own subscription actually buys them
  // (L35-L39) -- a monthly allowance by tier, plus whatever top-up credit
  // they have left.
  let reserved;
  // Declared out here because the Workflow is given them too: a repair turn
  // holds its own reservation and must do it against the figures this run
  // was admitted on, not ones it re-derives minutes later (internal issue 194).
  let monthlyAllowance: number;
  let topupCeiling: number;
  // Carried into the Workflow, so a repair turn's hold counts against the
  // same Free share of the day this run was admitted against (D158).
  let freePool = false;
  try {
    const now = Date.now();
    const spendable = await spendableFor(env, principal);
    // Before anything is reserved: a suspended account is refused with its
    // own reason, not left to fail the ceiling below as though it had spent
    // its allowance.
    if (spendable.suspended) {
      return refuse('account-suspended', SUSPENDED_MESSAGE, 403);
    }
    ({ monthlyAllowance, topupCeiling } = spendable);
    freePool = spendable.freePool === true;

    const sized = await sizedReservation(
      carry,
      sizeFor,
      (amount) =>
        reserveBudget(
          env,
          principal.userId,
          amount,
          monthlyAllowance,
          topupCeiling,
          now,
          undefined,
          undefined,
          { freePool },
        ),
      // A caller with less left than the whole run's worst case gets a
      // smaller run rather than a refusal, down to the floor.
      fitBuildToCaller(effectiveModel),
    );
    reserved = sized.reserved;
    ({ prices, maxTokens } = sized.ceiling);
    inputChars = sized.inputChars;
    worstCase = sized.worstCase;
  } catch (error) {
    // Fail closed. A retry costs the user a minute; an unbounded endpoint on
    // a public URL costs real money. 503 rather than 429: this is the
    // service's problem, and telling the user they did too much is a lie.
    console.error('spend ledger unavailable', error);
    // Its own reason, not `account-ceiling`. Being unable to read the ledger
    // and having spent the allowance are different facts, and reporting the
    // second when the first happened tells a user with money left that they
    // are out of it.
    return new Response(
      JSON.stringify({
        error: 'Usage accounting is unavailable; generation is paused.',
        reason: 'accounting-unavailable' satisfies RunRefusal,
      }),
      { status: 503, headers: { ...JSON_HEADERS, 'retry-after': '30' } },
    );
  }

  if (!reserved.ok) {
    // The two refusals internal issue 159 asks for by name. Both were 429 with different
    // prose, so a caller could only tell them apart by reading the sentence,
    // and they lead somewhere completely different: one is resolved by
    // buying a top-up or waiting for the month to turn, the other by waiting
    // about a minute. What a build needs is the floor, since anything above
    // it would have been admitted at a smaller size.
    const refusal = refusalFor(
      reserved,
      'A build on this model',
      buildFloorSize(sizeFor(0), effectiveModel).worstCase,
    );
    return refuse(refusal.reason, refusal.error, 429);
  }
  const reservation = reserved.layers.user;
  // Reservations settle inside the Workflow itself now (generation-workflow.ts's
  // 'settle-budget' step), once the run's real usage is known -- `handlePlan`
  // no longer holds the model call in its own scope to settle around. A run
  // this connection never sees complete still settles. One that Stop
  // terminated is settled by the Stop, at what the reclaim would charge
  // (D60, recorded for it below); a crash, or an instance that errored
  // before that step, falls back to `budget.ts`'s abandoned-reservation
  // reclaim, the same backstop a Worker dying mid-request already relied on.

  const runId = crypto.randomUUID();

  /**
   * Give a caller who left back what was reserved for them.
   *
   * One function because it is needed on both sides of `create()` and two
   * copies of a settlement is two things that can come to disagree about
   * what a cancelled run costs (internal PR 189 review).
   *
   * Settled through the ordinary path rather than a second one:
   * `settleBudget`'s third case is "the provider was never asked", which is
   * what this is.
   */
  const releaseWithoutCharging = () =>
    settleBudget(
      env.USER_BUDGET!,
      {
        userId: principal.userId,
        reservationId: reservation.id,
        reservationKey: reserved.layers.userReservationKey,
        accountReservationId: reserved.layers.account.id,
        worstCaseMicroUsd: worstCase,
        prices,
      },
      undefined,
      false,
    ).catch((error) => {
      // The reclaim is still the backstop, as it is for a Worker that dies
      // here. Over-charging a caller who left is the wrong direction, but
      // it is the safe one, and refusing to answer would not improve it.
      console.error('failed to release a reservation for a gone caller', error);
    });

  /**
   * Noticed before anything durable exists, and kept noticing across the
   * call that makes something durable (internal PR 189 review).
   *
   * The previous round added the check below, which asks once whether the
   * caller has already left. The round after it found what one check cannot
   * cover: `create()` is an awaited RPC, so a Cancel arriving while it is
   * in flight passes the check and is only seen afterwards. By then there
   * is a Workflow, terminating one lands at its next step boundary so the
   * model step may already be running, and a termination before
   * `settle-budget` leaves the reservation to the abandoned-run reclaim,
   * which closes it at the full worst case. The caller is billed for a
   * generation they cancelled.
   *
   * A flag set by a listener registered here covers the whole of that
   * window, because a listener does not care when the answer arrives.
   */
  let clientGone = false;
  whenClientGone(request.signal, () => {
    clientGone = true;
  });

  // Nothing durable exists yet, so there is nothing to terminate and
  // nothing to reclaim: the cheap case, and the common one.
  if (clientGone) {
    await releaseWithoutCharging();
    return new Response(null, { status: 499 });
  }

  // Where Stop will find this reservation (D60). Stop has only the run's
  // id, and it terminates the Workflow before the step that would settle
  // this, so the rows it has to close are recorded against that id before
  // the Workflow exists. A write that fails costs only the timing: a Stop
  // then leaves the reservation to the reclaim, as every Stop did before.
  if (env.RUN_PROGRESS) {
    try {
      await env.RUN_PROGRESS.getByName(runId).hold({
        ...(reservation.id !== undefined
          ? { reservationId: reservation.id }
          : {}),
        topup:
          reserved.layers.userReservationKey === topupKeyFor(principal.userId),
        ...(reserved.layers.account.id !== undefined
          ? { accountReservationId: reserved.layers.account.id }
          : {}),
        // Every run made here is a bounded build, whose model steps record
        // what they spend beside this (D65), so a Stop can charge that.
        metered: true,
      });
    } catch (error) {
      console.error('failed to record where a run is reserved', error);
    }
  }

  // The run's row, before the run exists rather than from the moment its
  // model steps finish (`openStage`). Until then a bounded build has no
  // row at all, and a builder reopening the project could not see that it
  // was still going. Written before the Workflow is created, and required:
  // a restore from History (D152) moves the accepted revision only while no
  // run has a row, so a run without one could be overtaken by a restore and
  // spend its budget on code that is no longer the project's, only to be
  // refused as a conflict (Codex review of internal PR 360).
  const runRows = new D1GenerationStore(env.DB!, env.PROJECT_CONTENT!);
  try {
    await runRows.openStage({
      runId,
      projectId,
      baseRevision: parsed.value.baseRevision ?? null,
    });
  } catch (error) {
    console.error('failed to record a new run', error);
    await releaseWithoutCharging();
    return json(
      { error: 'Generation could not be started. Try again shortly.' },
      503,
    );
  }
  // A row for a run that never came to be, or was stopped before it could
  // say so, is closed here rather than read as a build for half an hour.
  const closeStage = (state: 'failed' | 'cancelled') =>
    runRows.settleRun(runId, state).catch((error: unknown) => {
      console.error(
        'failed to close the row of a run that did not start',
        error,
      );
    });

  let instance;
  try {
    instance = await env.GENERATION_WORKFLOW!.create({
      id: runId,
      params: {
        projectId,
        runId,
        prompt: parsed.value.prompt,
        ...(parsed.value.baseRevision
          ? { baseRevision: parsed.value.baseRevision }
          : {}),
        ...(style.value ? { style: style.value } : {}),
        ...(Object.keys(styleDna.value).length > 0
          ? { styleDna: styleDna.value }
          : {}),
        ...(gallery?.ok
          ? { styleTokens: gallery.tokens, galleryGuidance: gallery.guidance }
          : {}),
        ...(knowledge.value ? { knowledge: knowledge.value } : {}),
        ...(chosenMockup.value ? { chosenMockup: chosenMockup.value } : {}),
        ...(referenceContext ? { referenceContext } : {}),
        ...(media ? { media } : {}),
        ...(referencePaletteSource ? { referencePaletteSource } : {}),
        ...(referencePaletteMode ? { referencePaletteMode } : {}),
        model: effectiveModel,
        userId: principal.userId,
        ...(principal.email ? { email: principal.email } : {}),
        reservationId: reservation.id,
        reservationKey: reserved.layers.userReservationKey,
        accountReservationId: reserved.layers.account.id,
        worstCaseMicroUsd: worstCase,
        prices,
        maxTokens,
        // The input the reservation above was priced for, across every
        // call of the bounded build: the full figure, or the smaller one a
        // caller with less left was fitted to.
        maxInputChars: inputChars,
        // The figures this run was admitted on, carried so a repair turn
        // can hold its own reservation without reconstructing a Principal
        // inside the Workflow (internal issue 194).
        monthlyAllowance,
        topupCeiling,
        ...(freePool ? { freePool: true as const } : {}),
      },
    });
  } catch (error) {
    console.error('failed to start generation workflow', error);
    await closeStage('failed');
    return json(
      { error: 'Generation could not be started. Try again shortly.' },
      503,
    );
  }

  // The other side of the window the flag above exists for (internal PR 189 review).
  // The abort landed while `create()` was in flight, so there is now a
  // Workflow to stop, and stopping it here rather than several statements
  // later is the difference between the next step boundary and the one
  // after the model call.
  //
  // Settled at zero rather than left to the reclaim, and that is a choice
  // worth stating rather than burying. The reclaim closes an abandoned
  // reservation at its full worst case, so leaving it there bills a caller
  // a whole generation for cancelling before one could start. Against that,
  // this settles at zero while the run has a narrow chance of having
  // reached the provider in the milliseconds before the termination lands,
  // which would mean Vibld pays for a call it does not bill on. The
  // asymmetry is deliberate: the over-charge is certain and visible to the
  // person it happens to, the under-charge is rare and ours. And it
  // corrects itself where it matters, because a run that does get as far as
  // `settle-budget` overwrites this row with what it really cost.
  //
  // Both wait for the termination to land (Codex review of internal PR 360). Closing
  // the stage row makes the run invisible to a restore from another tab,
  // which would then move the project under a Workflow still running; and a
  // termination that failed leaves a run that settles its own reservation.
  // So when it fails, the row stays open and the reservation held, and
  // `buildInFlight` settles the row once the engine reports the run ended.
  if (clientGone) {
    const terminated = await instance.terminate().then(
      () => true,
      (error: unknown) => {
        console.error('failed to terminate an abandoned workflow', error);
        return false;
      },
    );
    if (terminated) {
      await Promise.all([releaseWithoutCharging(), closeStage('cancelled')]);
    }
    return new Response(null, { status: 499 });
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

  // A caller who leaves stops the relay, and only the relay. The build goes
  // on without them and saves to the project, where reopening it picks the
  // result up (docs/decisions.md, "Resolved 2026-09-29", keep building).
  // Only Stop cancels a build, through `DELETE /api/runs/:id`
  // (`run-control.ts`).
  //
  // This used to terminate the Workflow instead, on the reasoning that a run
  // nobody is waiting for should not run to completion unread. On a phone
  // that meant a locked screen or a switched app was a cancel: run 553ea6c7
  // was terminated three and a half minutes in when its page went away, its
  // stage left at `planning`, and the model call in flight was paid for
  // anyway, since termination lands at the next step boundary.
  let gone = false;
  const stopRelay = () => {
    if (gone) return;
    gone = true;
    stopKeepalive();
  };

  // Two independent notices that the client is gone. The runtime aborts
  // `request.signal` on disconnect; a failed write catches the same thing at
  // the next keepalive, which is the backstop if the signal is unavailable.
  //
  // Through `whenClientGone`, because a caller who left during the identity
  // check or the reservation above has already aborted by the time this
  // runs, and an abort is not replayed to a listener added afterwards
  // (internal PR 189 review).
  //
  // The second registration in this route, and the two now do different
  // things. The first, above `create()`, still keeps a caller who left
  // before the run existed from starting one. This one only stops relaying
  // to somebody who is no longer there.
  whenClientGone(request.signal, stopRelay);

  const write = (chunk: string) =>
    writer.write(encoder.encode(chunk)).catch(stopRelay);

  // First bytes immediately, so the connection is never idle from the start.
  void write(KEEPALIVE_COMMENT);
  keepalive = setInterval(() => void write(KEEPALIVE_COMMENT), keepaliveMs);

  // Then the run's own id, before anything else: it is what the builder's
  // Stop names, and what it asks after if this connection drops before the
  // result arrives.
  void write(encodeEvent('run', { runId }));

  // Written down as well as shown, for a run whose instance ended without
  // writing its own end (`settleRun`): the one a person is watching reads as
  // it ended here rather than as `planning` until somebody opens the project.
  const settleStages = (state: 'failed' | 'cancelled') =>
    new D1GenerationStore(env.DB!, env.PROJECT_CONTENT!)
      .settleRun(runId, state)
      .catch((error: unknown) => {
        console.error('failed to settle a run that ended', error);
      });

  // The run's stage rows, which say when its revision has been promoted
  // and is being checked (D69), and what it ended at.
  const stages = () =>
    new ProjectStore(env.DB!, env.PROJECT_CONTENT!).runStages(
      principal.userId,
      runId,
    );
  // The revision whose files this stream has already sent, so a build
  // being checked is sent its code once, and again only when a repair
  // replaces it.
  let shownRevision: string | undefined;

  const run = (async () => {
    try {
      for (;;) {
        if (gone) return;

        let status;
        try {
          status = await instance.status();
        } catch (error) {
          console.error('workflow status unavailable', error);
          if (!gone) {
            await write(
              encodeEvent('error', {
                error: 'Generation failed unexpectedly.',
              }),
            );
          }
          return;
        }

        if (status.status === 'complete') {
          // Nothing of a finished instance is still running, so any stage it
          // left open ended with it: a refusal before any model step, which
          // stages nothing past the row `openStage` wrote, or a repair turn
          // cut off by its own deadline.
          await settleStages('failed');
          const result = status.output as {
            state: string;
            accepted?: { revision: string; files: unknown[] };
            errors: string[];
            summary?: string;
            check?: unknown;
          };
          if (result.state === 'accepted' && result.accepted) {
            await write(
              encodeEvent('plan', {
                providerId: effectiveModel,
                plan: {
                  summary: result.summary ?? '',
                  files: result.accepted.files,
                },
                // The revision it ended at, and what its check found
                // (D69), for a builder that was shown the code before the
                // check ended and badged it.
                revision: result.accepted.revision,
                ...(isCheckVerdict(result.check)
                  ? { check: result.check }
                  : {}),
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
          // Recorded, not just shown (internal PR 201). A run that dies inside the
          // Workflow engine leaves nothing this service wrote: the step's
          // own output is null and the instance API reports one generic
          // sentence. That sentence is the only evidence there is, and
          // until it was written down the same failure had to be
          // reproduced to be read at all.
          //
          // A log line rather than a row: `GenerationStageRecord` carries a
          // state and no free text, and the run's own row already says
          // `failed`. What was missing is why, and that is what this
          // carries. The instance API holds the engine's side of the same
          // story, keyed by the same run id.
          console.error('workflow ended without a result', {
            runId,
            status: status.status,
            error: status.error?.message,
          });
          await settleStages(
            status.status === 'terminated' ? 'cancelled' : 'failed',
          );
          // A run stopped or broken after it promoted its revision has
          // still moved the project there (D69): the builder is handed
          // that code, marked as not checked, rather than told the build
          // failed while the project holds what it built.
          const ended = await endedWith(
            stages,
            new D1GenerationStore(env.DB!, env.PROJECT_CONTENT!),
            runId,
          ).catch(() => undefined);
          if (!gone) {
            await write(
              ended
                ? encodeEvent('plan', {
                    providerId: effectiveModel,
                    plan: { summary: '', files: ended.snapshot.files },
                    revision: ended.snapshot.revision,
                    ...(ended.check ? { check: ended.check } : {}),
                  })
                : encodeEvent('error', {
                    error:
                      status.error?.message ??
                      'Generation failed unexpectedly.',
                  }),
            );
          }
          return;
        }

        // Still going. The generate step reports what it has produced
        // through a named Durable Object (internal issue 183, `run-progress.ts`), which
        // is read here and nowhere else. A read that fails, or a run that
        // has not reported yet, leaves the count absent rather than zero:
        // "unknown" and "none written" are different, and the client's
        // wording already distinguishes them.
        //
        // The rest of what this loop knows is unchanged and still real: how
        // long the caller has been waiting, and -- for the states that have
        // an honest name -- what the run is doing. `stageFor` returns
        // nothing for the rest rather than guessing, and the line carries
        // the clock alone.
        const progress = await env.RUN_PROGRESS?.getByName(runId)
          .read()
          .catch(() => undefined);
        const stage = stageFor(status.status, progress);
        const characters = progress?.report?.characters ?? 0;
        // Which step of the bounded build is running ("Writing 3 of 7:
        // services page"), where one is and the model steps have not all
        // finished. `stepFor` says nothing otherwise, and the stage word
        // carries the line as it did before.
        const step = stepFor(status.status, progress);
        // Which part of its work the run is doing, as a word the builder
        // acts on: its lifecycle bar moves on from "Plan" by it
        // (`run-phase.ts`), where the builder's own status cannot.
        let phase = phaseFor(status.status, progress);
        // Show early, badge it (D69). Once the model steps are over, or
        // where the channel has nothing to say (before the first report,
        // and after an eviction, which forgets that the steps finished),
        // the stage rows are asked whether the run has promoted its
        // revision and is checking it: if so, the builder is sent that
        // revision's code, once, and shows it with a badge until the
        // result below says what the check found. Never a reason to end
        // the relay: without it the builder waits for the end, as it did
        // before.
        const checking =
          status.status === 'running' &&
          (progress?.finished !== false || progress.report === undefined)
            ? await checkingUpdate(
                stages,
                new D1GenerationStore(env.DB!, env.PROJECT_CONTENT!),
                runId,
                shownRevision,
              ).catch(() => undefined)
            : undefined;
        phase ??= checking?.phase;
        const early = checking?.snapshot;
        if (!gone) {
          await write(
            encodeEvent('progress', {
              elapsedMs: Date.now() - waitingSince,
              ...(stage ? { stage } : {}),
              ...(characters > 0 ? { characters } : {}),
              ...(step ? { step } : {}),
              ...(phase ? { phase } : {}),
              ...(early
                ? {
                    early: { revision: early.revision, files: early.files },
                  }
                : {}),
            }),
          );
          if (early) shownRevision = early.revision;
        }

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
 * Three directions to choose between, before a build is attempted (internal issue 185).
 *
 * The same shape as `handlePlan` and deliberately not the same code. It
 * calls the same shared functions for every number that decides money --
 * `runCeilingFor`, `worstCaseMicroUsd`, `spendableFor`, `reserveBudget`,
 * `settleBudget` -- so nothing here re-derives a figure the build route
 * derives elsewhere. What differs is only what this run is for.
 *
 * In the request rather than in a Workflow, which is the one structural
 * choice worth arguing with. A build went durable because it takes fifteen
 * minutes and a Worker request has no guarantee of outliving the client's
 * connection (`generation-workflow.ts`). Three sketches take about a
 * minute. The durable machinery costs a run id, a persisted payload and a
 * poll loop, and buys back the ability to survive an eviction that is far
 * less likely and far cheaper to repeat: two cents and a minute, against
 * thirty cents and a quarter of an hour.
 *
 * Streamed anyway, for the reason `handlePlan` records: a buffered response
 * sends nothing for the whole run, and the client gives up first. Being in
 * the request has one payoff the build lost -- the model client streams, so
 * `onProgress` reports a real character count here. `progress.characters`
 * has a producer again, on this route only.
 *
 * It also serves the draft a build shows while it runs (`"draft": true`,
 * docs/decisions.md, 2026-09-28, the draft preview): one direction instead
 * of three, through every line below unchanged. Same rate-limit bucket,
 * same reservation and ceiling, same settlement. The one thing to know
 * about running it beside a build is concurrency: it holds one of the
 * caller's `VIBLD_MAX_IN_FLIGHT` slots while it runs, which is why the
 * builder only asks for it once the build's own request has been admitted.
 */
async function handleMockups(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Use POST.' }, 405);
  }

  // Read at the top, for the reason `handlePlan`'s is: everything between
  // here and the first progress event is wait the person sits through.
  const waitingSince = Date.now();

  if (!isConfigured(env)) {
    return json({ error: 'Generation is not configured.' }, 503);
  }

  const origin = checkRequestOrigin(
    request.headers,
    new URL(request.url).origin,
  );
  if (!origin.ok) {
    return refuse('request-invalid', origin.error, origin.status);
  }

  const size = checkBodySize(request.headers);
  if (!size.ok) return refuse('request-invalid', size.error, size.status);

  const resolved = await resolvePrincipal(request, env);
  if (resolved.denied) return resolved.denied;
  const { principal } = resolved;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse('request-invalid', 'Body must be valid JSON.', 400);
  }

  const parsed = parseMockupRequest(body);
  if (!parsed.ok) {
    return refuse('request-invalid', parsed.error, parsed.status);
  }

  const style = parseStylePreset(body);
  if (!style.ok) {
    return refuse('request-invalid', style.error, style.status);
  }

  // A gallery style's direction (D146), in place of a preset's, so the
  // three directions and the draft are drawn in the style the build uses.
  const galleryStyle = parseGalleryStyle(body);
  if (!galleryStyle.ok) {
    return refuse('request-invalid', galleryStyle.error, galleryStyle.status);
  }
  const galleryColors = parseGalleryColors(body);
  if (!galleryColors.ok) {
    return refuse('request-invalid', galleryColors.error, galleryColors.status);
  }
  const gallery = galleryStyle.value
    ? await readGalleryStyle(
        env,
        new URL(request.url).origin,
        galleryStyle.value,
        galleryColors.value,
      )
    : null;
  if (galleryStyle.value && gallery === null) {
    return refuse(
      'request-invalid',
      'This style is no longer in the gallery. Choose another in Gallery, or clear it.',
      400,
    );
  }
  if (gallery && !gallery.ok) {
    return refuse(
      'request-invalid',
      `These color edits fail the style's contrast checks: ${gallery.problems.join('; ')}.`,
      400,
    );
  }

  const chosenModel = parseModel(body, configuredProviders(env));
  if (!chosenModel.ok) {
    return refuse('request-invalid', chosenModel.error, chosenModel.status);
  }

  // A build's draft is always drawn by DRAFT_MODEL, whatever the build runs
  // on (Chris, 2026-09-28): it is a placeholder shown for a minute, paid
  // from the same credit as the build, and on the deployment's default
  // model it would cost ten times as much for nothing the person keeps.
  // Only where this person may use it; otherwise the draft falls back to
  // the model they chose, as any look does. A Free account is not granted
  // Flash (D66), so its draft is drawn on GPT-6 Luna, the one model it has.
  const caller = await tierOrRefusal(env, principal);
  if ('refusal' in caller) return caller.refusal;
  const draftModel = parsed.value.draft
    ? draftModelFor(env, principal.policyIdentity, caller.tier, caller.access)
    : null;
  const decision = decideModel(
    env,
    principal.policyIdentity,
    caller.tier,
    draftModel ?? chosenModel.value,
    resolveModel(env),
    caller.access,
  );
  if (!decision.ok) {
    return refuse('model-not-allowed', decision.error, decision.status);
  }
  const effectiveModel = decision.model;

  // Its own bucket, not the build's. A look before building is not a build,
  // and sharing the counter would mean three sketches cost somebody the
  // generation they were about to run.
  try {
    const key = `mockups:${principal.userId}`;
    const gates = [env.PLAN_BURST, env.PLAN_SUSTAINED].filter(
      (gate): gate is RateLimit => gate !== undefined,
    );
    const results = await Promise.all(gates.map((gate) => gate.limit({ key })));
    if (results.some((result) => !result.success)) {
      return refuse(
        'rate-limited',
        'Too many requests. Try again shortly.',
        429,
      );
    }
  } catch (error) {
    console.error('rate limiter unavailable', error);
  }

  const { prices, maxTokens } = runCeilingFor(env, effectiveModel, 'mockups');
  // The prompt, plus the one style direction that may go with it. No base
  // project, no standing instructions, no reference page: a mockup run is
  // asked before there is a project, so none of them exists to send.
  //
  // Named rather than inlined because the settlement of a cancelled run
  // needs the same figure (internal PR 189 review), and a second spelling of it is a
  // second chance for the two to disagree about what was reserved.
  const inputChars = MOCKUP_INPUT_CHARS;
  const worstCase = worstCaseMicroUsd(prices, maxTokens, inputChars);

  let reserved;
  // Read again by the empty-reply retry's hold (D158).
  let freePool = false;
  try {
    const now = Date.now();
    const spendable = await spendableFor(env, principal);
    if (spendable.suspended) {
      return refuse('account-suspended', SUSPENDED_MESSAGE, 403);
    }
    const { monthlyAllowance, topupCeiling } = spendable;
    freePool = spendable.freePool === true;
    reserved = await reserveBudget(
      env,
      principal.userId,
      worstCase,
      monthlyAllowance,
      topupCeiling,
      now,
      undefined,
      undefined,
      { freePool },
    );
  } catch (error) {
    console.error('budget unavailable', error);
    return new Response(
      JSON.stringify({
        error: 'Usage accounting is unavailable; generation is paused.',
        reason: 'accounting-unavailable' satisfies RunRefusal,
      }),
      { status: 503, headers: { ...JSON_HEADERS, 'retry-after': '30' } },
    );
  }

  if (!reserved.ok) {
    const refusal = refusalFor(
      reserved,
      'Three directions on this model',
      worstCase,
    );
    return refuse(refusal.reason, refusal.error, 429);
  }

  const settleParams = {
    userId: principal.userId,
    ...(principal.email ? { email: principal.email } : {}),
    reservationId: reserved.layers.user.id,
    reservationKey: reserved.layers.userReservationKey,
    accountReservationId: reserved.layers.account.id,
    worstCaseMicroUsd: worstCase,
    prices,
  };

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const keepaliveMs = parseKeepaliveMs(env.VIBLD_STREAM_KEEPALIVE_MS);

  const abort = new AbortController();
  let cancelled = false;
  let keepalive: ReturnType<typeof setInterval> | undefined;
  const stopKeepalive = () => {
    if (keepalive !== undefined) {
      clearInterval(keepalive);
      keepalive = undefined;
    }
  };
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    stopKeepalive();
    // Aborting really does stop the spending here, unlike a Workflow whose
    // termination lands at the next step boundary: the model call is in
    // this scope, so the signal reaches it.
    //
    // Stopping the provider is only half of it, which is what the first
    // version of this got wrong (internal PR 189 review). The abort makes the call
    // reject, so no usage is ever reported, and settlement's unknown-cost
    // case charges the full reservation -- Cancel cost more than waiting.
    // The `finally` below settles a stopped run from what was streamed.
    abort.abort();
  };
  // Same reason as `handlePlan`'s: everything above this line is real work
  // a caller can disconnect during, and an abort that landed then is not
  // replayed to a listener added now (internal PR 189 review).
  whenClientGone(request.signal, cancel);

  const write = (chunk: string) =>
    writer.write(encoder.encode(chunk)).catch(cancel);

  void write(KEEPALIVE_COMMENT);
  keepalive = setInterval(() => void write(KEEPALIVE_COMMENT), keepaliveMs);

  // What this run really sends, reported by the client that sends it.
  //
  // Reconstructed here at first, from the system prompt and
  // `mockupUserPrompt` (internal PR 189 review). That was right for two of the three
  // clients and wrong for DeepSeek, which appends the output instruction to
  // the system message -- so the figure was short by about 430 characters
  // on the one provider production actually runs. The assembly is
  // provider-specific, so no amount of care here could have kept up with
  // it; the client is the only thing that knows.
  //
  // Zero until the client says otherwise, which is the honest starting
  // value: nothing has been sent yet. A run cancelled before the request
  // goes out settles at nothing anyway, because `providerRan` stays false.
  let sentChars = 0;

  const run = (async () => {
    let usage: PlanUsage | undefined;
    let providerRan = false;
    // What the model had streamed when the reader stopped it. The only
    // measurement of a cancelled run there is, and without it settlement
    // falls back to the full reservation (internal PR 189 review).
    let streamedCharacters = 0;
    // Counted beside it rather than added into it (internal PR 190). A reasoning model
    // thinks before it writes, so a run stopped in its first seconds has
    // streamed nothing but this, and settling on the answer alone priced a
    // minute of billed thinking at zero.
    let reasoningCharacters = 0;
    /*
     * What the retry spent that this reader is not being charged for
     * (internal PR 191 review).
     *
     * The provider absorbs one empty reply on the reader's behalf, and
     * the first version of that let the money vanish: settlement saw only
     * the second attempt, so the account-wide daily ceiling never learned
     * that the first had happened. One admitted request could spend twice
     * what it reserved, and every empty reply moved the ledger further
     * from what the day had really cost.
     */
    /*
     * Undefined until an attempt is absorbed, and a number after, even
     * when that number is zero (internal PR 191 review).
     *
     * Not a count that starts at zero, because zero and "there was no
     * discarded attempt" then look identical, and they settle
     * differently: one says this reservation covered an attempt that cost
     * nothing, the other says it covered the run the reader is being
     * charged for. Collapsing them charged the retry to both
     * reservations.
     *
     * Which is the falsy trap `settleBudget` was just taught to avoid,
     * moved to its call site. Keeping the presence of the attempt and its
     * price in one variable is what makes it unrepresentable rather than
     * merely avoided.
     */
    let absorbedMicroUsd: number | undefined;
    // The hold taken for the second attempt, so the ceiling is enforced
    // before it is sent rather than only reported after.
    let retryHold: Reservation | undefined;
    // Whether that hold was refused, which decides what the reader owes:
    // the run then consists of one attempt, and that attempt is the one
    // being absorbed (internal PR 191 review).
    let retryRefused = false;
    try {
      const provider = new MockupProvider(
        createPlanClient(env, effectiveModel),
        {
          model: effectiveModel,
          maxTokens,
          signal: abort.signal,
          onUsage: (reported) => {
            usage = reported;
          },
          // Forwarded as SSE, which is what makes the character count real
          // on this route (internal PR 189 review). The build cannot do this: its
          // model call happens inside a Workflow step with no live channel
          // back to the Worker polling it (internal issue 183). Here the call is in this
          // scope, so the count the client streams is the count the reader
          // sees.
          onProgress: ({ characters, reasoningCharacters: reasoning }) => {
            // Recorded before the cancelled check, not after: the last
            // count is exactly the one a cancelled run has to be settled
            // from, and returning early would throw it away.
            streamedCharacters = characters;
            if (reasoning !== undefined) reasoningCharacters = reasoning;
            if (cancelled) return;
            void write(
              encodeEvent('progress', {
                characters,
                elapsedMs: Date.now() - waitingSince,
                stage: 'running',
              }),
            );
          },
          onPromptChars: (characters) => {
            sentChars = characters;
          },
          /*
           * The absorbed attempt, recorded and then permitted or refused
           * (internal PR 191 review).
           *
           * Recorded first, because it has already happened: the money is
           * spent whatever is decided next, and the account ledger is
           * where this deployment's day is counted.
           *
           * Then the ceiling is asked about the second attempt before it
           * goes out. Refusing costs this reader only the free retry --
           * they were going to be told the run failed either way, since
           * the first attempt came back empty. Spending past the ceiling
           * because nobody was being billed would cost the deployment
           * money it had decided not to spend.
           *
           * A ledger that throws refuses too. This path exists to bound
           * spend, and "the ceiling cannot be read" is not a reason to
           * spend again.
           */
          onDiscarded: async (spent) => {
            absorbedMicroUsd =
              (absorbedMicroUsd ?? 0) + microUsdOf(spent, prices);
            try {
              /*
               * Reconcile the attempt that is over before asking to
               * hold for the next one (internal PR 191 review).
               *
               * An unsettled reservation counts at its worst case, so
               * without this the day sees two whole worst cases for a
               * run that will spend one and a bit: a 100 ceiling, a 60
               * worst case and a first attempt that really cost 10
               * refuses a retry whose true maximum is 70. That refusal
               * is safe in the direction of money and wrong in the
               * direction of the reader, who is failed for a provider
               * defect while their deployment had room.
               *
               * The figure is not a guess. This attempt is finished and
               * priced, which is exactly the condition `settle` exists
               * for, and settling it again at the end with the same
               * figure is a no-op: `UserBudget.settle` writes whatever
               * the row's state, and the two writes carry the same
               * value.
               */
              if (settleParams.accountReservationId !== undefined) {
                await env
                  .USER_BUDGET!.getByName(ACCOUNT_BUDGET_KEY)
                  .settle(settleParams.accountReservationId, absorbedMicroUsd);
              }
              retryHold = await reserveAccount(env, worstCase, Date.now(), {
                // The run's own standing, not the plan's: a run paid from
                // top-up credit left the Free share, and so does its retry.
                freePool: reserved.layers.freePool === true,
              });
            } catch (error) {
              // Either half failing refuses the retry: an unreconciled
              // reservation and an unread ceiling are both "the ledger
              // did not answer", and neither is a reason to spend again.
              console.error('mockup retry hold failed', error);
              retryRefused = true;
              return false;
            }
            retryRefused = !retryHold.verdict.allow;
            return retryHold.verdict.allow;
          },
          ...(style.value ? { style: style.value } : {}),
          ...(gallery?.ok ? { direction: gallery.direction } : {}),
          // One direction, shown while a build runs (docs/decisions.md,
          // 2026-09-28, the draft preview). The same run in every other
          // respect: this route's reservation, ceiling, retry and
          // settlement, so a draft is metered exactly as a look is.
          ...(parsed.value.draft ? { draft: true } : {}),
        },
      );

      // Nothing has been asked for yet, so a caller who left before this
      // line costs nothing (internal PR 189 review). Without the check, two fixes from
      // earlier rounds met badly: `whenClientGone` aborts the controller for
      // a caller who had already gone, and then this marked the provider as
      // having run and called it with a pre-aborted signal -- so settlement
      // saw `cancelled && providerRan` and charged the full input estimate
      // for a request that never left the Worker.
      //
      // Returning leaves `providerRan` false, which is the case
      // `settleBudget` already has for "never asked": settle nothing.
      if (cancelled) return;

      providerRan = true;
      const set = await provider.generate({ prompt: parsed.value.prompt });
      if (!cancelled) {
        await write(
          encodeEvent('mockups', {
            providerId: effectiveModel,
            mockups: set.mockups,
          }),
        );
      }
    } catch (error) {
      if (!cancelled) {
        const visible = sanitizedProviderFailure(
          error,
          'mockup generation failed',
          parsed.value.draft
            ? 'Could not produce a draft.'
            : 'Could not produce mockups. Try again shortly.',
        );
        await write(encodeEvent('error', { error: visible.message }));
      }
    } finally {
      stopKeepalive();
      try {
        // A run the reader stopped is not a run whose cost is unknown: the
        // streamed count is a measurement of it, and settling it as
        // unknown charges the whole reservation for pressing Cancel
        // (internal PR 189 review). Only when the provider was actually asked --
        // stopping before that still costs nothing.
        // Ahead of the cancelled branch on purpose (internal PR 191 review). A
        // refused retry never reaches the progress reset, so the streamed
        // counts still belong to the absorbed attempt, and settling from
        // them would bill the reader for it by the other door.
        const settled = usage
          ? usage
          : retryRefused
            ? NOTHING_TO_BILL
            : cancelled && providerRan
              ? cancelledUsage(
                  streamedCharacters,
                  maxTokens,
                  sentChars,
                  reasoningCharacters,
                )
              : undefined;
        const actual = await settleBudget(
          env.USER_BUDGET!,
          settleParams,
          settled,
          providerRan,
          // Each account reservation carries the attempt it admitted
          // (internal PR 191 review). The first one covers the first attempt, so
          // when that attempt was absorbed, its cost is what this
          // reservation settles at rather than the reader's charge.
          // Undefined when nothing was absorbed, which is every ordinary
          // run: the two layers then settle at the same figure, as they
          // always have. Passed straight through, zero included, because
          // the variable already says which case this is.
          absorbedMicroUsd,
        );
        // And the hold taken for the retry carries the retry, which is
        // exactly what the reader was charged for.
        //
        // Settling it at nothing and adding both attempts to the first
        // reservation was the earlier shape, and it broke at midnight: a
        // run whose retry crosses into the next day holds that day's
        // ceiling, so a zero there forgets a real request while the day
        // before is pushed past a ceiling it never spent. Each
        // reservation is settled on the day it was taken.
        if (retryHold?.id !== undefined) {
          await env
            .USER_BUDGET!.getByName(ACCOUNT_BUDGET_KEY)
            .settle(retryHold.id, actual);
        }
        console.log(
          JSON.stringify({
            event: 'mockups.settled',
            // So a draft's spend can be told apart from a look's.
            ...(parsed.value.draft ? { draft: true } : {}),
            ...(usage
              ? {}
              : {
                  cancelled,
                  retryRefused,
                  streamedCharacters,
                  reasoningCharacters,
                }),
            userId: principal.userId,
            ...(principal.email ? { email: principal.email } : {}),
            model: effectiveModel,
            // `settled`, not `usage`: a cancelled run's figures are an
            // estimate, and a log that reported zero tokens beside a real
            // charge would make the settlement look like the unknown-cost
            // case it exists to stop being. `cancelled` above says which
            // it is, so the numbers do not have to be read as measured.
            inputTokens: settled?.inputTokens ?? 0,
            outputTokens: settled?.outputTokens ?? 0,
            microUsd: actual,
            // Only when there was one, so the ordinary line stays the
            // ordinary line and a discarded attempt is findable -- which
            // includes one that priced at nothing, since how often the
            // defect fires is the reason this field exists.
            ...(absorbedMicroUsd !== undefined ? { absorbedMicroUsd } : {}),
            elapsedMs: Date.now() - waitingSince,
          }),
        );
      } catch (error) {
        // The reservation is not lost: `budget.ts`'s abandoned-reservation
        // reclaim closes it at its worst case, which over-charges rather
        // than under-charges and is the safe direction for a failure whose
        // cause is unknown.
        console.error('mockup settlement failed', error);
      }
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
    // A status the service's reply could not be read into is a 502, not a
    // synthesised failure: the browser reads any refusal as "ask again"
    // and a failed status as "the sandbox is not running", and only one of
    // those is established by an unreadable body.
    const status = await previewStatus(env, principal.userId);
    return status
      ? json(status)
      : json({ error: UNREADABLE_PREVIEW.error }, 502);
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
    const revision = parsePreviewRevision(body, false);
    if (!revision.ok) return json({ error: revision.error }, revision.status);
    return json(
      await startPreview(
        env,
        principal.userId,
        files.value,
        undefined,
        revision.value ?? undefined,
      ),
    );
  }

  // A new revision into the preview that is already running (D74): the
  // same files a start takes, checked by the same rules, and the revision
  // they are. What the service answers is passed through; a refusal it
  // gave, or an answer it could not give, is a 502 the builder treats as
  // "restart instead".
  if (request.method === 'PATCH') {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Body must be valid JSON.' }, 400);
    }
    const files = parsePreviewRequest(body);
    if (!files.ok) return json({ error: files.error }, files.status);
    const revision = parsePreviewRevision(body, true);
    if (!revision.ok) return json({ error: revision.error }, revision.status);
    const result = await updatePreview(
      env,
      principal.userId,
      files.value,
      revision.value as string,
    );
    return result.ok ? json(result.update) : json({ error: result.error }, 502);
  }

  if (request.method === 'DELETE') {
    return outcomeResponse(await stopPreview(env, principal.userId));
  }

  return json({ error: 'Use GET, POST, PATCH or DELETE.' }, 405);
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
    return outcomeResponse(await revokeShare(env, principal.userId, shareId));
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

  // Which project's site this is (docs/decisions.md, "Resolved 2026-09-28",
  // one site per project). Settled before anything is built, so a request
  // for a project that is not the caller's costs no build.
  const site = await siteProjectFor(env, principal.userId, body, {
    allowArchived: false,
  });
  if (!site.ok) return json({ error: site.error }, site.status);

  // Asked again while the workspace is busy, on the same budget the
  // repair's rebuild uses (internal PR 196 review). A verification build returns as
  // soon as it has an answer and tears its container down afterwards, on
  // `ctx.waitUntil`, holding that user's build lock for as long as the
  // destroy takes. Publishing straight after a generation therefore met a
  // `busy` refusal from a build that was already finished, and this route
  // turned it into a 422 that reads as "your project does not build".
  //
  // Bounded per call as well as in total, because a sequence of bounded
  // calls is not a bounded sequence: `buildWithin` gives each attempt what
  // is left of the budget rather than its own full thirteen minutes.
  const built = await askWhileBusy(
    (within) =>
      buildWithin(
        () => buildProject(env, principal.userId, parsed.value),
        within,
      ),
    (answer) => Boolean(answer && !answer.ok && answer.reason === 'busy'),
    { wait: sleep, now: Date.now },
  );
  // A build service that never answered says nothing about the project, so
  // it is not a 422. Same reading the repair step takes of the same fact.
  if (!built) {
    return json(
      { error: 'The build service is unavailable. Try again shortly.' },
      503,
    );
  }
  if (!built.ok) return json({ error: built.error }, 422);

  // One site per project. The publish service keys a site's slug on this id
  // (`published_projects.project_id`, UNIQUE), so publishing one project can
  // only ever claim or replace that project's own site, never another's,
  // and a slug is still unique across every site there is. Every site
  // published before this was keyed by its owner's user id, which is the id
  // of the project 0033 made from that owner's work, so that project finds
  // its site at the same slug (`0035_site_per_project.sql`). The files are
  // the builder's, from the project it names.
  const published = await publishProject(
    env,
    principal.userId,
    site.projectId,
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

/**
 * Take one of the caller's published sites off the web (ADR-0013).
 *
 * The other half of publishing. There is no build: what comes down is the
 * site of the project named, which has to be the caller's
 * (`resolveSiteProject`), and the publish service checks again that the
 * site is theirs. The builder names the project in a JSON body; a builder
 * older than one site per project sends none and means the site it always
 * meant, the account's first project's.
 *
 * Two callers inside this Worker, both with the owner present and asking,
 * and neither able to name anybody else's site: deleting a project takes
 * that project's site down first (`project-handlers.ts`), and deleting the
 * account takes every site it has down. Both come through here rather than
 * calling the service themselves, so this stays the one place a takedown
 * is made (`publish-authorisation.test.ts`).
 *
 * `PUBLISH_BURST` again rather than a gate of its own. It is the same
 * caller, the same service, and a takedown is cheaper than the publish that
 * preceded it. Once per request, not once per site: an account deletion
 * taking five sites down is one person asking once.
 */
async function handleUnpublish(
  request: Request,
  env: Env,
  options: {
    /**
     * Set only by the account deletion route, for the account that is
     * asking to be deleted: every site it has comes down as part of the
     * request, and by then the request is recorded, so the ordinary refusal
     * of such an account (`principal.ts`) would stop its own takedown.
     * Nothing a caller sends can set it.
     */
    forDeletion?: boolean;
    /**
     * Set only by the project deletion route, for the project being
     * deleted, which that route has already found to be the caller's.
     */
    projectId?: string;
  } = {},
): Promise<Response> {
  // Not `autoPublishConfigured`: that also wants the build service, which a
  // takedown never calls. Requiring it would answer 503 to the one control
  // that removes a live site, on a deployment where removing it still works.
  if (!publishServiceConfigured(env)) {
    return json(
      { error: 'Publishing is not configured for this deployment.' },
      503,
    );
  }

  const resolved = await resolvePrincipal(request, env, {
    allowPendingDeletion: options.forDeletion === true,
  });
  if (resolved.denied) return resolved.denied;
  const { principal } = resolved;

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

  // Which sites. For the account's deletion, every one it has serving,
  // read the way the deletion's own check reads it, so the step that asks
  // "is anything still up" and this list cannot disagree. A site that is
  // held or already down is not on it: it is not serving, and a takedown
  // under a hold is refused anyway.
  let targets: string[];
  if (options.forDeletion) {
    targets = env.DB
      ? await liveSiteProjects(env.DB, principal.userId)
      : [principal.userId];
  } else if (options.projectId !== undefined) {
    targets = [options.projectId];
  } else {
    // An older builder sends no body at all, which is not an error here.
    const body: unknown = await request.json().catch(() => null);
    const site = await siteProjectFor(env, principal.userId, body, {
      allowArchived: true,
    });
    if (!site.ok) return json({ error: site.error }, site.status);
    targets = [site.projectId];
  }

  const slugs: string[] = [];
  const errors: string[] = [];
  for (const projectId of targets) {
    const removed = await unpublishProject(env, principal.userId, projectId);
    if (!removed.ok) {
      // One site the caller asked about: its answer is the answer.
      if (targets.length === 1 && !options.forDeletion) {
        return json({ error: removed.error }, removed.status);
      }
      // Several: the rest are still taken down. The deletion's own check
      // is what decides whether that was all of them.
      errors.push(removed.error);
      continue;
    }
    slugs.push(removed.slug);
  }
  return options.forDeletion
    ? json({ slugs, errors })
    : json({ slug: slugs[0] });
}

/**
 * The project a publish or takedown request names, checked against the
 * caller (`resolveSiteProject`).
 */
function siteProjectFor(
  env: Env,
  userId: string,
  body: unknown,
  options: { allowArchived: boolean },
): Promise<SiteProject> {
  const store =
    env.DB && env.PROJECT_CONTENT
      ? new ProjectStore(env.DB, env.PROJECT_CONTENT)
      : null;
  const { projectId } = (body ?? {}) as { projectId?: unknown };
  return resolveSiteProject(store, userId, projectId, options);
}

/**
 * Take somebody else's published site off the web, or put the decision back
 * (internal issue 172).
 *
 * The one control an abuse report has an answer through. Until it existed
 * the only lever was editing D1 and R2 by hand, which is not a lever to
 * reach for under time pressure and is easy to do half of.
 *
 * Named by slug rather than by project or account, because that is what a
 * report carries: somebody sends an address. A project's share link is
 * held the same way, named by the link (`share` in place of `slug`), since
 * that is the address a report about one carries. `requireAdmin` is the
 * whole of the authorisation, and it is stricter than the ownership check
 * the owner's own takedown makes -- which is the point, since this route
 * exists to act on sites the caller does not own.
 *
 * Only the publish service is required, not the build one, for the reason
 * `handleUnpublish` gives: a fail-closed check has to fail closed on its own
 * subject, and losing the preview secret must not disarm the control that
 * stops a live site.
 */
async function handleAdminHold(
  request: Request,
  env: Env,
  release: boolean,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Use POST.' }, 405);
  }
  const guard = await requireAdmin(request, env);
  if (guard.denied) return guard.denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }
  const { slug, reason, share } = (body ?? {}) as {
    slug?: unknown;
    reason?: unknown;
    share?: unknown;
  };

  // A project's share link, named by the link a report carried, instead of
  // a site by its slug. The same lever for the same kind of report: what a
  // stranger was sent is reachable, and it should not be. It needs the
  // database rather than the publish service, which is why it is decided
  // before the publish service is asked for.
  if (share !== undefined) {
    const response = await handleShareHold(env, {
      link: share,
      reason,
      by: guard.adminEmail,
      release,
      now: new Date().toISOString(),
      stopPreview: previewConfigured(env)
        ? async (token) => {
            const stopped = await stopPreview(
              env,
              await sharePreviewKey(token),
            );
            if (!stopped.ok) throw new Error(stopped.error);
          }
        : null,
    });
    // The project and its owner, never the token: the token is the link,
    // and the audit log is not a list of working links (D73).
    return withAudit(env.DB!, response, async () => {
      const token =
        typeof share === 'string' ? shareTokenFromLink(share) : null;
      const owner = token
        ? await new AdminStore(env.DB!).shareOwner(token)
        : null;
      return {
        at: new Date().toISOString(),
        adminEmail: guard.adminEmail,
        action: release ? 'share-release' : 'share-hold',
        targetUserId: owner?.userId ?? null,
        target: owner ? `project:${owner.projectId}` : 'share link',
        reason: typeof reason === 'string' ? reason.trim() || null : null,
        detail: null,
      };
    });
  }

  if (!publishServiceConfigured(env)) {
    return json(
      { error: 'Publishing is not configured for this deployment.' },
      503,
    );
  }
  if (typeof slug !== 'string' || slug.trim().length === 0) {
    return json({ error: '"slug" is required.' }, 400);
  }

  // Each hold and release is listed in the admin audit log (D73), under
  // the account the slug belongs to, once the publish service has done it.
  const audit = (response: Response, action: 'site-hold' | 'site-release') =>
    withAudit(env.DB!, response, async (body) => ({
      at: new Date().toISOString(),
      adminEmail: guard.adminEmail,
      action,
      targetUserId: await new AdminStore(env.DB!).siteOwner(slug.trim()),
      target: typeof body.slug === 'string' ? body.slug : slug.trim(),
      reason:
        action === 'site-hold' && typeof reason === 'string'
          ? reason.trim()
          : null,
      detail: typeof body.state === 'string' ? { state: body.state } : null,
    }));

  if (release) {
    const lifted = await releaseProject(env, slug.trim(), guard.adminEmail);
    return audit(
      lifted.ok
        ? json({ slug: lifted.slug, state: lifted.state })
        : json({ error: lifted.error }, lifted.status),
      'site-release',
    );
  }

  // Refused here as well as in the publish service, so the reason is asked
  // for by the surface a person is actually using rather than only by the
  // one behind it.
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return json({ error: 'Say why this site is being taken down.' }, 400);
  }

  const result = await operatorHold(
    env,
    slug.trim(),
    guard.adminEmail,
    reason.trim(),
  );
  return audit(
    result.ok
      ? json({ slug: result.slug, state: result.state })
      : json({ error: result.error }, result.status),
    'site-hold',
  );
}

/**
 * The operator hold, called from here and nowhere else
 * (`publish-authorisation.test.ts`). Used by the admin takedown route above,
 * and by a ban or an admin's deletion of an account (`admin-users.ts`),
 * which take every site the account has down by the same hold, for the
 * reason the takedown route exists. None of them reaches the owner's own
 * takedown.
 */
function operatorHold(
  env: Env,
  slug: string,
  by: string,
  reason: string,
): ReturnType<typeof holdProject> {
  return holdProject(env, slug, by, reason);
}

/**
 * What the Workflow engine offers for stopping a build: its status, its
 * termination, and closing the reservation of a run that was stopped.
 * Shared by `/api/runs/:id` and a ban, which stops builds by the same
 * steps (`stopBuild` in `run-control.ts`).
 */
function stopDeps(env: Env) {
  return {
    ...(env.GENERATION_WORKFLOW
      ? {
          instanceStatus: async (runId: string) =>
            (await env.GENERATION_WORKFLOW!.get(runId))
              .status()
              .then((status) => status.status as string),
          terminate: async (runId: string) => {
            await (await env.GENERATION_WORKFLOW!.get(runId)).terminate();
          },
        }
      : {}),
    ...(env.RUN_PROGRESS && env.USER_BUDGET
      ? {
          settleStopped: async (runId: string, userId: string) => {
            await settleStopped(
              env.RUN_PROGRESS!.getByName(runId),
              env.USER_BUDGET!,
              userId,
              runId,
            );
          },
        }
      : {}),
  };
}

/**
 * What the admin controls over one account act through (D73,
 * `admin-users.ts`): the platform-admin check every `/api/admin/*` route
 * makes, Clerk, the ledger, and the same stop, preview and hold paths the
 * rest of the Worker uses. Each is null where the deployment lacks it.
 */
function adminUsersDeps(env: Env): AdminUsersDeps {
  return {
    authorize: (req) => requireAdmin(req, env),
    // Clerk under Clerk; the owner, or the invite list under Access (D123).
    lookupByEmail: (email) => accountDirectoryFor(env).lookupByEmail(email),
    clerkUser: (userId) => accountDirectoryFor(env).user(userId),
    setClerkBan: (userId, banned) =>
      accountDirectoryFor(env).setBan(userId, banned),
    usage: env.USER_BUDGET
      ? async (userId, now) => {
          const [month, topup] = await Promise.all([
            env
              .USER_BUDGET!.getByName(userId)
              .usageFor(allowancePeriodKey(now.getTime())),
            env
              .USER_BUDGET!.getByName(topupKeyFor(userId))
              .usageFor('lifetime'),
          ]);
          return {
            monthMicroUsd: month.spentMicroUsd,
            topupMicroUsd: topup.spentMicroUsd,
          };
        }
      : null,
    stopBuilds:
      env.DB && env.PROJECT_CONTENT && env.GENERATION_WORKFLOW
        ? (userId) =>
            stopAccountBuilds(
              new ProjectStore(env.DB!, env.PROJECT_CONTENT!),
              new D1GenerationStore(env.DB!, env.PROJECT_CONTENT!),
              userId,
              new Date(),
              stopDeps(env),
            )
        : null,
    // The account's own sandbox, then the one each of its share links may
    // have started: the same two the account deletion's preview step stops.
    stopPreviews: previewConfigured(env)
      ? async (userId) => {
          const own = await stopPreview(env, userId);
          if (!own.ok) return own;
          const tokens = await new AccountDeletionStore(env.DB!).shareTokens(
            userId,
          );
          for (const token of tokens) {
            const shared = await stopPreview(env, await sharePreviewKey(token));
            if (!shared.ok) return shared;
          }
          return { ok: true };
        }
      : null,
    holdSite: publishServiceConfigured(env)
      ? (slug, by, reason) => operatorHold(env, slug, by, reason)
      : null,
    requestDeletion: (userId, takeDown) =>
      requestAccountDeletion(deletionDepsFor(env), userId, { takeDown }),
  };
}

/**
 * Identify the caller, then hand off to a GitHub handler.
 *
 * The handlers in `github-handlers.ts` take a principal rather than resolving
 * one, so they stay testable without a Clerk session and the identity rules
 * stay here with every other route's.
 */
async function handleGitHub(
  request: Request,
  env: Env,
  handler: (principal: Principal) => Promise<Response>,
): Promise<Response> {
  const resolved = await resolvePrincipal(request, env);
  if (resolved.denied) return resolved.denied;
  return handler(resolved.principal);
}

/** The slice of Cloudflare's ExecutionContext this Worker uses. */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  /**
   * One exit, so a route added later cannot forget the headers.
   *
   * `secured` is applied here rather than inside each handler because that
   * is exactly how this Worker came to send none of them: the headers were
   * nobody's job at any particular `return`. The shell gets the same set
   * from `public/_headers`, which Cloudflare applies to the asset store's
   * responses and never to this script's (`run_worker_first` is `/api/*`
   * here, so the two halves answer separately and both have to be covered).
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    return securedApp(await route(request, env, ctx));
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
    /*
     * D1 stops a Worker invocation at its query limit by throwing, and the
     * limit depends on the plan: 1000 on Workers Paid, 50 on Workers Free.
     * Nothing in the runtime reports which one this deployment is on, so
     * the default is the one that is safe on either and a Paid deployment
     * says so here.
     *
     * Raising it past the real limit is worse than leaving it low. The
     * replay would throw partway through a page, which leaves its cursor
     * where it was, so every following night would die in the same place.
     *
     * One allowance for the whole invocation, which the account deletion
     * pass shares with the billing pass: D1 counts the invocation, not the
     * pass.
     */
    const queryBudget = Number(env.VIBLD_REPLAY_QUERY_BUDGET);
    // Less the read of the panel's provider keys for the balance check
    // below, which spends from the same invocation's allowance.
    const allowance = Math.max(
      0,
      (Number.isFinite(queryBudget) && queryBudget > 0
        ? queryBudget
        : DEFAULT_QUERY_BUDGET) - panelKeyQueries(env),
    );

    /*
     * Account deletion (docs/decisions.md L32): retrying immediate steps
     * that did not finish, the purge once the 30 days are up, and
     * forgetting audit records after 12 months. Found first, with one query,
     * so the billing pass is planned on what that leaves and on whether
     * there is anything to share with.
     *
     * It needs D1 and nothing else, so it runs on a deployment without
     * Stripe as well. It never takes a site down: that happens while the
     * person is asking (`account-deletion.ts`, ADR-0013).
     */
    const deletions = accountDeletionConfigured(env)
      ? deletionDepsFor(env)
      : null;
    const findDeletions = async (): Promise<DeletionLookup> =>
      deletions
        ? findDeletionWork(deletions)
        : { records: [], expired: [], need: 0 };
    // The billing pass is planned on the allowance less the lookup, which
    // moves its thresholds (the parked floor from 39, the split from 92)
    // up by one. The deployed 500 is near neither. The default of 40 sits
    // exactly on the floor once the lookup is paid for, so a handler that
    // grows another query moves that default into the four-way rotation.
    const afterLookup = deletions
      ? Math.max(0, allowance - QUERIES_TO_FIND_DELETIONS)
      : allowance;
    const deleteAccounts = async (lookup: DeletionLookup, share: number) => {
      if (!deletions || share <= 0) return;
      await runDeletionNight(deletions, lookup, share).then(
        (result) =>
          console.log(
            JSON.stringify({
              event: 'account_deletion.night',
              share,
              ...result,
            }),
          ),
        (error: unknown) =>
          console.error('account deletion pass failed', error),
      );
    };

    if (!billingConfigured(env)) {
      // No billing pass to share with: the deletion pass may have what it
      // needs of the whole allowance.
      ctx.waitUntil(
        findDeletions().then((lookup) =>
          deleteAccounts(lookup, Math.min(lookup.need, afterLookup)),
        ),
      );
    } else {
      const billing = new BillingStore(env.DB!);
      const referrals = new ReferralStore(env.DB!);
      const payout = { referrals, billing };

      const stripe = createStripeClient(env);
      const cleared = (userId: string) =>
        payReferralIfEarned(payout, userId).then(() => undefined);
      /**
       * Deliberately not swallowed, which is the opposite of what an earlier
       * version did and said.
       *
       * That version caught the failure and resolved, so `applyStripeEvent`
       * returned `applied`, the replay marked the event processed, and the
       * next run skipped it: the comment claiming it would be retried
       * described something that could not happen. A transient D1 failure
       * left the credit in place for ever.
       *
       * Letting it reject is safe here because `applyChargeReversed` catches
       * it and answers `unresolved`, which parks the event for the retry
       * sweep rather than throwing into the replay and holding the floor.
       */
      // A dispute names its charge by id and the customer is only on the
      // charge, so the replay needs the same lookup the webhook path has.
      const readCharge = (chargeId: string) =>
        stripe.charges.retrieve(chargeId);
      // A card saved for the welcome credit, for the same reason: a missed
      // delivery is only recovered if the replay can find the card's
      // fingerprint the way the webhook does.
      const readCard = readSetupIntent(stripe);
      // What a missed refund or lost dispute bought comes off when the
      // replay or the parked retry applies it, exactly as it would have on
      // delivery: the same Stripe client, and the same spend ledger for the
      // floor that keeps a refund from leaving anybody owing.
      const clawback = clawbackDepsFor(stripe, env.USER_BUDGET);
      const reversed = (
        userId: string,
        reason: string,
        refundedIds: string[],
      ) =>
        clawBackReferral(payout, userId, reason, refundedIds).then(
          () => undefined,
        );
      // Every phase, each from its own share of the allowance. What every
      // night did before internal issue 176, and still what a night does whenever the
      // split buys every phase at least one item, which the deployed 500
      // does.
      const everyPhase = (budget: number) =>
        // The replay first, and the reconcile after it rather than beside
        // it. The replay applies events in the order Stripe created them
        // within a page, but a descent covers older ground on each run, so
        // across runs an older subscription update can land after a newer
        // one. `reconcileSubscriptions` re-reads each subscription from
        // Stripe, so running it afterwards settles the mirror whatever order
        // the replay left it in. The money the replay recovers does not
        // depend on order: a top-up and a payment are recorded against the
        // Stripe object's own id, once.
        replayStripeEvents(
          stripe,
          billing,
          undefined,
          undefined,
          replayBudgetFor(budget),
          reversed,
          readCharge,
          readCard,
          clawback,
        )
          .then(
            (result) => {
              console.log(
                JSON.stringify({ event: 'billing.replayed', ...result }),
              );
              return result.queriesReserved;
            },
            (error: unknown) => {
              console.error('billing replay failed', error);
              // What it reserved before throwing is unknown, so assume it
              // reserved everything it was entitled to. Not the whole
              // allowance: the parked queue's share was never the replay's
              // to spend, and a throw here must not be what stops parked
              // payments being retried.
              return replayBudgetFor(budget);
            },
          )
          // Then the events parked because nobody could be attributed to
          // them. No Stripe requests: the payloads were kept, so this keeps
          // working long after Stripe has forgotten the events existed.
          //
          // Sized from what the replay left rather than from `budget`. Both
          // phases run in this one invocation and D1 counts the invocation,
          // so scaling each from the whole allowance spends it twice: the
          // replay can reserve most of it and a full-size batch then pushes
          // the invocation past the limit, with every phase believing it
          // stayed inside one.
          .then((reserved) =>
            retryUnattributedEvents(
              billing,
              retryBatchFor(
                budget -
                  payoutReserveFor(budget) -
                  reconcileReserveFor(budget) -
                  reserved,
              ),
              undefined,
              reversed,
              readCharge,
              readCard,
              clawback,
            ),
          )
          .then(
            (result) =>
              console.log(
                JSON.stringify({ event: 'billing.unattributed', ...result }),
              ),
            (error: unknown) =>
              console.error('unattributed retry failed', error),
          )
          // Then every referral payout that is owed and has not happened.
          // Stripe's redelivery gives up after a few days and a delivery that
          // was never made is retried by nobody, so without this the reward
          // stays owed and nothing revisits it. After the replay rather than
          // beside it, so a payment the replay has just recovered is paid out
          // tonight instead of tomorrow.
          .then(() =>
            resumeStrandedPayouts(
              payout,
              payoutBatchFor(payoutReserveFor(budget)),
            ),
          )
          .then(
            (result) =>
              console.log(
                JSON.stringify({ event: 'referral.resumed', ...result }),
              ),
            (error: unknown) =>
              console.error('referral payout resume failed', error),
          )
          // Last, and bounded like the rest of the pass (internal PR 47). It used to
          // take whatever the allowance had left and then keep going, which
          // past about a hundred subscriptions meant D1 threw, the handler
          // below caught it, and the reconcile stopped happening with
          // nothing but a log line to say so. Its share is reserved off the
          // top like the other two, and the walk resumes where the last run
          // stopped rather than starting again at the same place every
          // night.
          .then(() =>
            reconcileSubscriptions(
              stripe,
              billing,
              cleared,
              reconcileBatchFor(reconcileReserveFor(budget)),
            ),
          )
          .then(
            (result) =>
              console.log(
                JSON.stringify({ event: 'billing.reconciled', ...result }),
              ),
            (error: unknown) =>
              console.error('billing reconcile failed', error),
          );

      // A rotating night (internal issue 176). A quarter of the Workers Free default buys
      // no payout, no subscription and no page of events, and the split
      // recurred every night, so those phases never ran. Here each phase
      // spends exactly what `nightSharesFor` gave it, and a phase given
      // nothing tonight is not called: the parked queue on its floor every
      // night, and one of the other three with the rest.
      //
      // The same order as `everyPhase`, replay first, so a payment the
      // replay parks tonight is retried tonight. The same calls and the same
      // log lines too, so what a night did reads the same whichever way it
      // ran; `billing.rotated` says which way that was. Each share is fixed
      // before anything runs, so a phase that throws cannot hand the next
      // one more than it was given.
      const rotatedNight = async ({
        turn,
        shares,
      }: {
        turn: NightTurn;
        shares: NightPlan['shares'];
      }) => {
        console.log(
          JSON.stringify({
            event: 'billing.rotated',
            turn,
            shares,
            budget: allowance,
          }),
        );
        if (shares.replay > 0) {
          await replayStripeEvents(
            stripe,
            billing,
            undefined,
            undefined,
            shares.replay,
            reversed,
            readCharge,
            readCard,
            clawback,
          ).then(
            (result) =>
              console.log(
                JSON.stringify({ event: 'billing.replayed', ...result }),
              ),
            (error: unknown) => console.error('billing replay failed', error),
          );
        }
        if (shares.parked > 0) {
          await retryUnattributedEvents(
            billing,
            retryBatchFor(shares.parked),
            undefined,
            reversed,
            readCharge,
            readCard,
            clawback,
          ).then(
            (result) =>
              console.log(
                JSON.stringify({ event: 'billing.unattributed', ...result }),
              ),
            (error: unknown) =>
              console.error('unattributed retry failed', error),
          );
        }
        if (shares.payout > 0) {
          await resumeStrandedPayouts(
            payout,
            payoutBatchFor(shares.payout),
          ).then(
            (result) =>
              console.log(
                JSON.stringify({ event: 'referral.resumed', ...result }),
              ),
            (error: unknown) =>
              console.error('referral payout resume failed', error),
          );
        }
        if (shares.reconcile > 0) {
          await reconcileSubscriptions(
            stripe,
            billing,
            cleared,
            reconcileBatchFor(shares.reconcile),
          ).then(
            (result) =>
              console.log(
                JSON.stringify({ event: 'billing.reconciled', ...result }),
              ),
            (error: unknown) =>
              console.error('billing reconcile failed', error),
          );
        }
      };

      ctx.waitUntil(
        findDeletions().then(async (lookup) => {
          const plan = await planNight(billing, afterLookup, lookup.need).catch(
            (error: unknown): NightWithDeletion => {
              // Only reachable on an allowance that rotates, since one that
              // splits never asks. Most likely 0028_nightly_rotation.sql has
              // not been applied. The parked queue rather than nothing: it
              // is first in the order of precedence and the one phase that
              // runs every night anyway, it is handed no more than the
              // allowance less the query that just failed, so the night
              // stays inside the budget, and a pass that did nothing until
              // somebody read this line is the failure internal issue 176 was about.
              // Deletion waits for a night that can plan: its retries and
              // its purge keep, and parked money does not.
              console.error('nightly rotation unavailable', error);
              return {
                deletion: 0,
                billing: {
                  kind: 'rotate',
                  turn: 'parked',
                  shares: {
                    parked: Math.max(0, afterLookup - QUERIES_PER_TURN),
                    payout: 0,
                    reconcile: 0,
                    replay: 0,
                  },
                },
              };
            },
          );
          // Each share is fixed before either pass runs, so one that throws
          // cannot hand the other more than it was given.
          await deleteAccounts(lookup, plan.deletion);
          await (plan.billing.kind === 'split'
            ? everyPhase(plan.billing.budget)
            : rotatedNight(plan.billing));
        }),
      );
    }

    ctx.waitUntil(
      // With the panel's keys (D131): a key set there is the one in use,
      // so it is the balance worth checking.
      withPanelKeys(env)
        .then(checkProviderBalances)
        .then(
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

async function route(
  incoming: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // Behind a server's proxy, the address every limit below is keyed on.
  const request = withClientAddress(incoming, env);
  // A project's routes carry its id, so they are named by pattern
  // (`/api/projects/:id`) before anything compares against them. Every
  // other path is its own name and comes through unchanged.
  const pathname = routeKeyFor(new URL(request.url).pathname);

  // The panel's provider keys (D127) are managed against the Worker's own
  // environment, so "the secret" there means the secret. Every other route
  // sees the panel's keys laid over it (D131).
  if (isKeyRoute(pathname)) {
    const guard = await requireAdmin(request, env);
    if (guard.denied) return guard.denied;
    return handleProviderKeys(request, env, {
      adminEmail: guard.adminEmail,
      audit: (entry) => appendAudit(env.DB!, entry),
    });
  }
  env = await withPanelKeys(env);

  /*
   * The invite gate, before dispatch rather than inside each handler.
   *
   * Scattered checks fail silently: a new endpoint that spends money and
   * forgets the call is open, and nothing says so. Here the route table
   * (access-gate.ts) has to classify every path, and a test reads this
   * file's own route literals and fails on any it does not cover.
   *
   * It runs after identity, never instead of it: an uninvited caller and an
   * unauthenticated one get different answers, because they are different
   * problems and only one of them is the caller's to fix.
   */
  if (isGated(pathname, request.method)) {
    const resolved = await resolvePrincipal(request, env);
    if (resolved.denied) return resolved.denied;
    const decision = await decideAccessFor(env, resolved.principal);
    if (!decision.allowed) return refusal();
  }

  // Signing in with the owner's password (D123). Not behind the gate, and
  // resolving no principal: it is how a principal comes to exist. Counted
  // per address, since a wrong password is the one thing it can be asked
  // for over and over.
  if (pathname === '/api/owner/session') {
    if (signInMode(env) !== 'owner') {
      return json({ error: 'Not found.' }, 404);
    }
    const limiter = env.IP_BURST;
    return handleOwnerSession(request, env, {
      ...(limiter
        ? { limit: async (key) => (await limiter.limit({ key })).success }
        : {}),
    });
  }

  if (pathname === '/api/access/status') {
    const resolved = await resolvePrincipal(request, env);
    if (resolved.denied) return resolved.denied;
    return handleAccessStatus(request, env, resolved.principal);
  }

  // Lets the shell show which provider is actually in use instead of
  // implying AI when it is running the deterministic fake.
  if (pathname === '/api/config') {
    // Identified before answered: the picker is per-person now, so this
    // cannot be served to an anonymous caller without telling them what
    // somebody else may use.
    const resolved = await resolvePrincipal(request, env);
    if (resolved.denied) return resolved.denied;
    const { principal } = resolved;

    // A deployment with no model generation is reported, not refused.
    // This used to answer 403, and the shell reads any refusal as "nothing
    // configured, and you are not an admin", which hid the invite panel on
    // a deployment whose invite routes work perfectly: they need the admin
    // list and D1, and neither is what generation is missing. This
    // endpoint's job is to say what the deployment can do, and "it cannot
    // generate" is an answer to that question rather than a reason to
    // withhold one.
    const configured = isConfigured(env);

    // Three filters, in order. What the deployment can serve at all --
    // offering a model whose provider has no key produces a run that fails
    // after the user has waited for it. Then what this person is granted
    // (by email, per L4 -- see the same note in handlePlan). Then what
    // their plan includes (D66).
    //
    // A tier that cannot be read is answered as Free here, where the runs
    // refuse instead. This only fills the picker, and a failed probe is
    // worse than a short one: the shell takes it for a deployment with no
    // model and would run the deterministic fake. The run itself reads the
    // tier again and is the boundary.
    //
    // The panel's model access the same way (D133): unreadable, the
    // picker is filled as if nothing were saved there.
    let tier: Tier | null = 'free';
    let access: ModelGrantSource = NO_PANEL;
    if (configured) {
      try {
        tier = await tierOf(env, principal);
      } catch (error) {
        console.error('tier unavailable', error);
      }
      try {
        // `configured` already means D1 is bound; checked here as well so
        // the read never depends on that staying true (Codex review of internal PR 344).
        access = env.DB
          ? await modelGrantSource(env.DB, principal.userId)
          : NO_PANEL;
      } catch (error) {
        console.error('model access unavailable', error);
      }
    }
    const models = configured
      ? grantedFor(env, principal.policyIdentity, tier, access)
      : [];
    // The deployment default is only offered if this person may use it.
    const decided = configured
      ? decideModel(
          env,
          principal.policyIdentity,
          tier,
          null,
          resolveModel(env),
          access,
        )
      : { ok: false as const, error: 'not configured' };
    return json({
      generation: configured ? 'model' : 'fake',
      models: pickerEntries(env, models),
      defaultModel: decided.ok ? decided.model : null,
      // Said where the picker would be, when the plan is what keeps the
      // other models out of it; null otherwise, including for a Free
      // account the policy already holds to Luna.
      modelsNote: configured
        ? planModelsNote(env, principal.policyIdentity, tier, access)
        : null,
      // So the shell knows whether to offer the admin credit tool at all --
      // `/api/admin/*` itself re-checks this independently either way
      // (ADR-0006), the same as every other grant this endpoint reports.
      isAdmin: isPlatformAdmin(
        { email: principal.email, emailVerified: principal.emailVerified },
        platformAdminsFor(env),
      ),
      // Where the Preview pane runs a project: in a sandbox container where
      // this deployment has one, and otherwise in the viewer's own browser
      // (D125).
      preview: previewMode(env),
    });
  }

  if (pathname === '/api/plan') {
    return handlePlan(request, env, ctx);
  }

  if (pathname === '/api/mockups') {
    return handleMockups(request, env, ctx);
  }

  // One turn of the builder's conversation: a reply, or a brief the client
  // then builds through `/api/plan` (docs/decisions.md, 2026-09-28).
  if (pathname === '/api/chat') {
    return handleChat(request, env, {
      configured: isConfigured(env),
      resolvePrincipal: (req) => resolvePrincipal(req, env),
      createClient: (model) => createPlanClient(env, model),
      waitUntil: (promise) => ctx.waitUntil(promise),
    });
  }

  if (pathname === '/api/preview') {
    return handlePreview(request, env);
  }

  if (pathname === '/api/preview/share') {
    return handlePreviewShare(request, env);
  }

  if (pathname === '/api/publish') {
    // Two verbs on one path, deliberately: POST puts a checkpoint on the
    // web, DELETE takes it off. Both are the same resource, and DELETE is
    // the method a link or a form cannot reach by accident (ADR-0013).
    return request.method === 'DELETE'
      ? handleUnpublish(request, env)
      : handlePublish(request, env);
  }

  if (pathname === '/api/media') {
    return handleMedia(request, env, (req) => resolvePrincipal(req, env));
  }
  // The style gallery's picker cards (D142, D144).
  if (pathname === '/api/style-gallery') {
    return handleStyleGallery(request, env, (req) =>
      resolvePrincipal(req, env),
    );
  }
  // One design template's brief, for the builder's Templates option (D148).
  if (pathname === '/api/templates/brief') {
    return handleTemplateBrief(request, env, (req) =>
      resolvePrincipal(req, env),
    );
  }
  if (pathname === '/api/media/file') {
    return handleMediaFile(request, env, (req) => resolvePrincipal(req, env));
  }

  if (pathname === '/api/runs') {
    return handleRuns(request, env);
  }

  // A build's Workflow instance, for the two routes that need to know
  // whether it is still running: asking after a build and opening its
  // project. `status()` on an instance that does not exist throws, which
  // reads as "cannot tell".
  const instanceStatus = env.GENERATION_WORKFLOW
    ? async (runId: string) =>
        (await env.GENERATION_WORKFLOW!.get(runId))
          .status()
          .then((status) => status.status as string)
    : undefined;

  // One of the caller's builds: what became of it, and Stop
  // (`run-control.ts`, docs/decisions.md, "Resolved 2026-09-29", keep
  // building).
  if (pathname === '/api/runs/:id') {
    return handleRun(request, env, {
      resolvePrincipal: (req) => resolvePrincipal(req, env),
      // Terminating, the instance's status and settling a stopped run:
      // the same three a ban stops an account's builds with.
      ...stopDeps(env),
      ...(env.GENERATION_WORKFLOW
        ? {
            instanceOutput: async (runId: string) =>
              (await (await env.GENERATION_WORKFLOW!.get(runId)).status())
                .output,
          }
        : {}),
      ...(env.IP_BURST ? { ipLimit: env.IP_BURST } : {}),
      ...(env.RUN_PROGRESS
        ? {
            progressOf: (runId: string) =>
              env.RUN_PROGRESS!.getByName(runId).read(),
          }
        : {}),
    });
  }

  // The caller's projects (`project-handlers.ts`). Six literal routes,
  // one handler: the handler reads the id from the request's own path.
  const links: ProjectLinks = {
    origin: new URL(request.url).origin,
    publishHostname: env.PUBLISH_HOSTNAME ?? DEFAULT_PUBLISH_HOSTNAME,
  };
  const stopSharePreview = previewConfigured(env)
    ? async (token: string) => {
        const stopped = await stopPreview(env, await sharePreviewKey(token));
        if (!stopped.ok) throw new Error(stopped.error);
      }
    : undefined;
  const projectDeps = {
    resolvePrincipal: (req: Request) => resolvePrincipal(req, env),
    links,
    // Deleting a project takes its site down through the owner's own
    // takedown, the one path allowed to (ADR-0013), with the person present
    // and asking. Only where publishing exists: without it there is no
    // site, and D1 says so.
    ...(publishServiceConfigured(env)
      ? {
          takeDownSite: async (projectId: string) => {
            await handleUnpublish(request, env, { projectId });
          },
        }
      : {}),
    ...(stopSharePreview ? { stopSharePreview } : {}),
    ...(instanceStatus ? { instanceStatus } : {}),
  };
  if (pathname === '/api/projects') {
    return handleProjects(request, env, projectDeps);
  }
  if (pathname === '/api/projects/:id') {
    return handleProjects(request, env, projectDeps);
  }
  if (pathname === '/api/projects/:id/duplicate') {
    return handleProjects(request, env, projectDeps);
  }
  if (pathname === '/api/projects/:id/share') {
    return handleProjects(request, env, projectDeps);
  }
  if (pathname === '/api/projects/:id/checkpoints') {
    return handleProjects(request, env, projectDeps);
  }
  if (pathname === '/api/projects/:id/checkpoints/restore') {
    return handleProjects(request, env, projectDeps);
  }

  // A project's share link, from the side of whoever holds it
  // (`share-handlers.ts`). The view and the preview identify nobody: the
  // token is the grant (`access-gate.ts`). The remix is behind the gate.
  const shareDeps = {
    resolvePrincipal: (req: Request) => resolvePrincipal(req, env),
    links,
    preview: previewConfigured(env)
      ? {
          start: (
            key: string,
            files: { path: string; content: string }[],
            mediaOwner: string,
          ) => startPreview(env, key, files, mediaOwner),
          status: (key: string) => previewStatus(env, key),
        }
      : null,
  };
  if (pathname === '/api/share/:token') {
    return handleShare(request, env, shareDeps);
  }
  if (pathname === '/api/share/:token/preview') {
    return handleShare(request, env, shareDeps);
  }
  if (pathname === '/api/share/:token/remix') {
    return handleShare(request, env, shareDeps);
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

  // Cancelling through vibld rather than the portal's own page, so that a
  // monthly plan can be offered the retention coupon and an annual one is
  // not (docs/decisions.md, 2026-09-28).
  if (pathname === '/api/billing/cancel') {
    return handleBillingCancel(request, env, new URL(request.url).origin);
  }

  if (pathname === '/api/billing/card') {
    return handleBillingCard(request, env, new URL(request.url).origin);
  }

  if (pathname === '/api/stripe/webhook') {
    return handleStripeWebhook(request, env);
  }

  if (pathname === '/api/github/connect') {
    return handleGitHub(request, env, (principal) =>
      handleGitHubConnect(request, env, principal),
    );
  }

  // Deliberately outside `handleGitHub`. GitHub returns here through a
  // top-level browser navigation, which carries no Authorization header,
  // so resolving a principal would reject every real callback with a 401.
  // It does no work and holds no authority: it hands the code and state to
  // the app, which completes the exchange on a request that can be
  // authenticated.
  if (pathname === '/api/github/callback') {
    return handleGitHubCallback(request);
  }

  if (pathname === '/api/github/complete') {
    return handleGitHub(request, env, (principal) =>
      handleGitHubComplete(request, env, principal),
    );
  }

  if (pathname === '/api/github/bind') {
    return handleGitHub(request, env, (principal) =>
      handleGitHubBind(request, env, principal),
    );
  }

  if (pathname === '/api/github/disconnect') {
    return handleGitHub(request, env, (principal) =>
      handleGitHubDisconnect(request, env, principal),
    );
  }

  // The account-wide disconnect (D72): the sign-in and every project's
  // repository. `/api/github/disconnect` above ends one project's.
  if (pathname === '/api/github/disconnect-account') {
    return handleGitHub(request, env, (principal) =>
      handleGitHubDisconnectAccount(request, env, principal),
    );
  }

  if (pathname === '/api/github/status') {
    return handleGitHub(request, env, (principal) =>
      handleGitHubStatus(request, env, principal),
    );
  }

  if (pathname === '/api/github/webhook') {
    return handleGitHubWebhook(request, env);
  }

  if (pathname === '/api/github/diff') {
    return handleGitHub(request, env, (principal) =>
      handleGitHubDiff(request, env, principal),
    );
  }

  if (pathname === '/api/github/push') {
    return handleGitHub(request, env, (principal) =>
      handleGitHubPush(request, env, principal),
    );
  }

  if (pathname === '/api/referral/status') {
    const resolved = await resolvePrincipal(request, env);
    if (resolved.denied) return resolved.denied;
    return handleReferralStatus(request, env, resolved.principal);
  }

  if (pathname === '/api/referral/claim') {
    const resolved = await resolvePrincipal(request, env);
    if (resolved.denied) return resolved.denied;
    return handleReferralClaim(request, env, resolved.principal);
  }

  // Self-serve account deletion (docs/decisions.md L32). Ungated
  // (access-gate.ts): an account that was never invited, or whose invite
  // was withdrawn, can still leave.
  if (pathname === '/api/account/delete') {
    return handleAccountDelete(request, env, {
      // Every site the account has, one per project it published, comes
      // down through the owner's own takedown, the one path allowed to do
      // that (ADR-0013), with the person present and asking. Only when
      // publishing exists here: without it there is no site, and the step
      // is settled by D1 saying so.
      takeDown: async () => {
        if (publishServiceConfigured(env)) {
          await handleUnpublish(request, env, { forDeletion: true });
        }
      },
    });
  }

  if (pathname === '/api/account/delete/cancel') {
    return handleAccountDeleteCancel(request, env);
  }

  if (pathname === '/api/admin/deletions') {
    const guard = await requireAdmin(request, env);
    if (guard.denied) return guard.denied;
    return handleAdminDeletions(request, env);
  }

  if (pathname === '/api/admin/user') {
    return handleAdminUser(request, env);
  }

  // The account list, its Clerk import, and who the admins are (D128,
  // D129). Behind the platform-admin check like every /api/admin route.
  if (
    pathname === '/api/admin/accounts' ||
    pathname === '/api/admin/accounts/import' ||
    pathname === '/api/admin/admins'
  ) {
    // Who the admins are needs no database: it is read from the secret,
    // and only the account links come from D1 where there is one.
    const guard = await requireAdmin(request, env, {
      needsDatabase: pathname !== '/api/admin/admins',
    });
    if (guard.denied) return guard.denied;
    if (pathname === '/api/admin/admins') {
      return handleAdminList(
        request,
        env,
        signInMode(env),
        signInMode(env) === 'owner' ? ownerIdentity(env) : null,
      );
    }
    if (!env.DB) {
      return json({ error: 'Accounts are not configured here.' }, 503);
    }
    const deps = {
      db: env.DB,
      importPage:
        signInMode(env) === 'clerk' && env.CLERK_SECRET_KEY
          ? (query: {
              after: number | null;
              before?: number;
              limit: number;
              offset?: number;
            }) => listClerkUsers(env, query)
          : null,
      audit: (entry: AuditEntry) => appendAudit(env.DB!, entry),
      adminEmail: guard.adminEmail,
    };
    return pathname === '/api/admin/accounts'
      ? handleAccountList(request, deps)
      : handleAccountImport(request, deps);
  }

  // Plan limits (D134): what each plan allows, set in the panel.
  if (isPlanRoute(pathname)) {
    const guard = await requireAdmin(request, env);
    if (guard.denied) return guard.denied;
    return handlePlanLimits(request, env.DB!, {
      adminEmail: guard.adminEmail,
      audit: (entry) => appendAudit(env.DB!, entry),
      freeAllowanceMicroUsd: freeAllowanceOf(env),
    });
  }

  // Model access (D133): which models each plan includes, set in the
  // panel. Against the environment with the panel's keys, so "can be
  // served" means what a run would find.
  if (isModelRoute(pathname)) {
    const guard = await requireAdmin(request, env);
    if (guard.denied) return guard.denied;
    return handleModelAccess(request, env.DB!, {
      adminEmail: guard.adminEmail,
      audit: (entry) => appendAudit(env.DB!, entry),
      deployable: availableModels(configuredProviders(env)),
      policySet: Boolean(env.VIBLD_MODEL_POLICY?.trim()),
    });
  }

  // The platform overview (D128): reads only, from tables already written.
  if (pathname === '/api/admin/overview') {
    const guard = await requireAdmin(request, env);
    if (guard.denied) return guard.denied;
    return handleOverview(request, env.DB!, () => readBalances(env));
  }

  if (pathname === '/api/admin/invites') {
    const guard = await requireAdmin(request, env);
    if (guard.denied) return guard.denied;
    return handleInviteList(request, env);
  }

  if (pathname === '/api/admin/invite') {
    const guard = await requireAdmin(request, env);
    if (guard.denied) return guard.denied;
    return handleInvite(request, env, guard.adminEmail);
  }

  if (pathname === '/api/admin/invite/revoke') {
    const guard = await requireAdmin(request, env);
    if (guard.denied) return guard.denied;
    return handleInviteRevoke(request, env);
  }

  if (pathname === '/api/admin/unattributed') {
    const guard = await requireAdmin(request, env);
    if (guard.denied) return guard.denied;
    return handleUnattributedQueue(request, env);
  }

  if (pathname === '/api/admin/topup') {
    return handleAdminTopup(request, env);
  }

  if (pathname === '/api/admin/suspension/lift') {
    return handleAdminLiftSuspension(request, env);
  }

  if (pathname === '/api/admin/publish/hold') {
    return handleAdminHold(request, env, false);
  }

  if (pathname === '/api/admin/publish/release') {
    return handleAdminHold(request, env, true);
  }

  // One account (D73): its page, a gifted plan, overrides, a ban, a
  // deletion, stopping its builds, and the audit log. `handleAdminUsers`
  // asks `requireAdmin` before it reads anything, the same check as every
  // route above.
  if (isAdminUserRoute(pathname)) {
    return handleAdminUsers(request, env, adminUsersDeps(env));
  }

  return json({ error: 'Not found.' }, 404);
}
