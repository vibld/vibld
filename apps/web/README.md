# @vibld/web

The Vibld builder shell: a React + TypeScript + Vite single-page application
(ADR-0005, ADR-0008) that drives a full generation lifecycle in the browser.

```bash
pnpm install
pnpm --filter @vibld/web dev        # http://localhost:5173
pnpm --filter @vibld/web build
pnpm --filter @vibld/web typecheck
pnpm --filter @vibld/web test
```

## What this slice does

`prompt → planning → staged files → validation → accepted checkpoint → preview`

The orchestration is `@vibld/core`'s, not a reimplementation: the shell wires a
`ModelProvider` into a `DurableGenerationRunner` over an
`InMemoryGenerationStore`, validates the staged snapshot, promotes the
checkpoint by compare-and-set and meters the run with `RunBudgetLedger`. To show
lifecycle progress without adding an event bus to core, `src/generation/observers.ts`
decorates the `GenerationStore` and `ModelProvider` contracts the runner already
depends on. This runs the same way for both providers -- the deterministic
fake and, since it implements the same `ModelProvider` contract, the real one
too (see "Durable generation" below for what a real `generate()` call does on
the other end of that fetch).

`BuilderSession` (`src/generation/session.ts`) is a framework-free controller;
React binds to it with `useSyncExternalStore`. An epoch guard means a run
abandoned by "Start over" or by a repeated submission can never write its result
into newer state.

## What this slice does not do

- **The default preview pane content is still a local mock.** It is static
  HTML assembled from the accepted plan and the generated stylesheet,
  rendered in a fully restricted iframe (`sandbox=""`); nothing installs
  dependencies and no generated code runs there. The Preview tab's "Run in
  sandbox" button (see "Sandbox previews" below) starts the real thing --
  the mock is what shows before that button is pressed, and for a
  model-generated project, which has no mock to build in the first place.
- **There is no model provider.** Plans come from a deterministic local
  function so CI needs no credentials (ADR-0007).
- **Console and Problems are placeholders** beyond the lifecycle log and
  validation findings. `@vibld/preview` reports install/start success or
  failure as a whole (see "Sandbox previews" below), but nothing pipes a
  running preview's live process output or build diagnostics into these
  panels yet.
- **No Git export or deployment beyond the sandbox preview.** A real
  generation (see "Durable generation" below) is now persisted server-side in
  D1/R2, one project per Clerk user, but there is still no UI for browsing
  history, renaming a project, or starting a second one -- "the project" is
  still exactly one thing per account, the same as when it lived only in the
  browser tab's memory.

## Hosted preview (optional)

The shell can be deployed to Cloudflare Workers static assets (ADR-0005) for a
shareable URL. It is a client-side SPA with no backend, no credentials and no
stored data, so nothing deployed here belongs to the trusted control plane.

This deploys the **builder UI**. It is _not_ the private, origin-isolated
preview ADR-0006 requires for running untrusted generated applications; that
arrives with sandbox execution ([#6](https://github.com/vibld/vibld/issues/6)).

### One-time setup

Create a **`preview`** environment under **Settings → Environments**, then add
both secrets _to that environment_ rather than to the repository:

| Secret                  | Value                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | A token with **Workers Scripts: Edit**, **D1: Edit** and **Workers R2 Storage: Edit**, nothing else |
| `CLOUDFLARE_ACCOUNT_ID` | The target Cloudflare account                                                                       |

Environment secrets are reachable only from a job that names the environment,
and any protection rule on it gates the run before a single step executes. Add
yourself as a **required reviewer** if the deploy should need approval each
time. Repository-level secrets of the same name still work as a fallback.

`Workers Scripts: Edit` cannot be scoped to one script, so the token can write
to every Worker on the account it is issued for. Issue it against a Cloudflare
account used only for Vibld to keep the blast radius to this preview.

**D1: Edit** and **Workers R2 Storage: Edit** were added alongside
`generation-store.ts`: `wrangler.jsonc` now declares `d1_databases` and
`r2_buckets` bindings, and a token that only had `Workers Scripts: Edit`
will fail the next deploy at the binding-verification step, not at runtime
-- if the existing token predates this change, it needs those two scopes
added (or reissuing) before the next deploy runs.

### Deploying

Run the **Deploy web preview** workflow from the Actions tab. It is
`workflow_dispatch` only, so it never runs on its own. The workflow fails fast
with a clear message if either secret is missing, and on success records the
deployed URL on the environment and in the run summary — so the current preview
URL is always visible on the repository's Environments page.

To deploy from a workstation instead, authenticate wrangler yourself and run:

```bash
pnpm --filter @vibld/web build
pnpm --filter @vibld/web deploy:preview
```

The deployed URL is public on `workers.dev`. The SPA shell itself carries no
gate (only `/api/plan` and `/api/config` require a Clerk sign-in, per the
"Clerk authentication" section below) -- put the whole route behind
Cloudflare Access instead if the work in progress should stay internal.

## Model generation (optional)

The shell asks `/api/config` on load and uses whichever provider the
deployment offers: the hosted Worker when it is fully configured, the
deterministic fake otherwise. The footer names the provider that actually ran,
so the UI never implies AI when it is running the stub.

**The browser never holds a provider credential.** The key is a Worker secret,
and `@vibld/ai` is imported only from `worker/`, never from `src/` — a build
check confirms the model SDK stays out of the client bundle (ADR-0006).

### Streaming

`/api/plan` returns a server-sent event stream, not a buffered JSON body. A
generation runs for a minute or more with no model output to forward, and a
buffered response sends nothing until it finishes — long enough that browsers,
mobile networks and intermediate proxies abandon the connection. The failure
then surfaces as an opaque network error (Safari reports `Load failed`) rather
than anything about the generation.

The transport therefore emits keepalive comments on its own timer, independent
of model activity, starting with the first byte. The interval is configuration,
not a literal: set `VIBLD_STREAM_KEEPALIVE_MS` to override the documented
10-second default. Values outside 1–60 seconds fall back to the default.

The keepalive is cleared on success, failure and client disconnect, so a timer
cannot outlive its request.

### Fail closed

`/api/plan` and `/api/config` serve a generation only when a provider key
(`ANTHROPIC_API_KEY` or `DEEPSEEK_API_KEY`), `USER_BUDGET`,
`CLERK_FRONTEND_API_URL`, `GENERATION_WORKFLOW`, `DB` and `PROJECT_CONTENT`
are **all** present. Missing configuration means refused, never open: an
unauthenticated endpoint on a public URL would let anyone spend the account's
model budget.

The Worker verifies the Clerk session JWT itself (`worker/principal.ts`,
`worker/clerk-auth.ts`) rather than trusting the browser's session cookie --
which never arrives here anyway, since the cookie is scoped to Clerk's own
Frontend API domain, not this Worker's origin. The client sends the token as
`Authorization: Bearer <token>` instead (`src/auth/clerk-token.ts`,
`src/generation/remote-provider.ts`), and ADR-0006 requires the Worker to
verify it itself regardless. Verification pins RS256 (rejecting the
`alg: none` downgrade), matches the Clerk instance's issuer, and honours
expiry with a small skew allowance.

**Cloudflare Access is off** (docs/decisions.md L5): Clerk is the only gate.

### Durable generation (docs/decisions.md L26)

A real generation's model call, staging, validation and promotion now run
inside `GenerationWorkflow` (`worker/generation-workflow.ts`), a Cloudflare
Workflow instance, against the D1/R2-backed `GenerationStore`
(`worker/generation-store.ts`) rather than in `handlePlan`'s own request
scope. `handlePlan` creates one instance per run (its id doubling as the
Workflow instance id) and polls `WorkflowInstance.status()` over the same SSE
connection it already holds open, so `remote-provider.ts`'s client contract
(`event: plan` / `event: error`) is unchanged. One project per Clerk user for
now: there is no multi-project UI, so the D1 project id is just the user's own
id (`worker/generation-run.ts`'s `WorkflowParams.projectId` comment).

Two things this costs, both accepted rather than solved here:

- **No live character progress for a real generation.** There is no channel
  between a Workflow step and the Worker polling it -- only the step's return
  value once it finishes. The stream still emits keepalives, so a long run
  reads as "still going", not as "how far along". The old in-request
  `onProgress` callback only ever existed for exactly this endpoint, so the
  fake provider (which never streamed live progress either) is unaffected.
- **Cancelling stops the _next_ step, not the current one.** `handlePlan`
  calls `WorkflowInstance.terminate()` on disconnect, but termination lands
  at a step boundary; a cancel that arrives mid-model-call cannot stop that
  one call from finishing (or being billed for). `budget.ts`'s existing
  abandoned-reservation reclaim is the backstop either way -- the same one a
  Worker dying mid-request already relied on before this change.
- **The browser still keeps its own working copy.** `BuilderSession` sends
  its whole `base` snapshot with every request rather than asking the server
  to look one up, so `D1GenerationStore.loadAccepted` is never actually
  reached in this path yet -- the client remains the thing every other part
  of the shell (preview, zip export, the next turn's `base`) reads from. What
  changed is that D1/R2 also durably record every run alongside it, and a
  Workflow, not a request handler, is what drives the model call and the
  promotion. Making the server copy authoritative -- so a reload could resume
  a project the browser tab never saw start -- is a real next step, not this
  one.

### Setup

1. Create a Clerk application and note its **Frontend API URL** (**Configure
   → API Keys**, e.g. `https://clerk.vibld.com`).
2. Set `CLERK_FRONTEND_API_URL` in `wrangler.jsonc`'s `vars` -- a public
   identifier, not a secret -- then redeploy.
3. Add the provider key as a Worker secret — it must never be committed:
   `wrangler secret put ANTHROPIC_API_KEY`
4. Add `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to the `preview`
   environment (the deploy workflow's Build step inlines the publishable key
   as `VITE_CLERK_PUBLISHABLE_KEY`; `CLERK_SECRET_KEY` is currently unused by
   any Worker code -- JWKS verification needs no secret -- and is kept only
   because Clerk issues both together).

Until all of that is in place the deployed shell keeps running the fake, which
is the intended safe default.

### Trying generation without a terminal

The **Try a generation** workflow in the Actions tab runs one real generation
from a prompt you type in the UI, prints the result to the run summary, and
optionally installs and builds the generated project as the ADR-0002
portability check. It needs `ANTHROPIC_API_KEY` on the `preview` environment
and spends model tokens on each run.

## Clerk authentication (the cutover -- docs/decisions.md L5)

Clerk is the only thing that gates `/api/plan` and `/api/config` now.
Cloudflare Access is off. The Clerk instance is live: Frontend API at
`https://clerk.vibld.com` (a custom domain -- its DNS record must stay
**DNS only**, not proxied, or Cloudflare intercepts it with its own "DNS
points to prohibited IP" error before Clerk ever sees the request), with
`CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` set on the `preview`
environment, the custom session claim configured, and **Waitlist** sign-up
mode enabled (L6) so sign-in stays restricted to people Chris approves.

Two pieces, wired together:

- **Verification** (`worker/principal.ts`, `worker/clerk-auth.ts`):
  `resolvePrincipal` reads the `Authorization: Bearer` header, verifies it
  (RS256, JWKS-pinned) against `CLERK_FRONTEND_API_URL`, and returns a
  `Principal` with two identities that are **not interchangeable**:
  - `userId` -- the Clerk user id (`sub`). What `handlePlan`'s spend ledger
    and rate limiting key on (docs/decisions.md L3: "the budget ledger and
    every ownership row key on the Clerk user id. Email is display only.").
  - `policyIdentity` -- the verified email, or the shared `'unknown'` bucket
    when the email claim is missing or unverified. What `VIBLD_MODEL_POLICY`
    and `VIBLD_PLATFORM_ADMINS` (L4) are checked against instead: both
    predate Clerk, are human-edited by email address, and are not ownership
    rows.

  An email claim with no verification status attached is never treated as
  verified by default (`platform-admins.ts`'s `isPlatformAdmin` and
  `principal.ts`'s `policyIdentity` both require `emailVerified === true`) --
  that would turn a missing dashboard setting into an open grant.

- **Sign-in** (`src/auth/clerk.tsx`, `src/auth/clerk-token.ts`): `ClerkRoot`
  wraps the app in `ClerkProvider`; the header's `AuthStatus` shows a sign-in
  button or the user menu. `clerk-token.ts` is the JSX-free half --
  `getClerkToken()` (read via `window.Clerk`, since the session cookie is
  scoped to Clerk's own domain and never reaches this Worker's origin on its
  own) and `onClerkSessionChange()` (so `useBuilderSession.ts` re-probes
  `/api/config` the moment someone signs in through the modal, rather than
  requiring a reload) -- kept apart from `clerk.tsx`'s JSX specifically so
  `node --test --experimental-strip-types` (which strips types but not JSX)
  can still import it.

Both gracefully no-op if `VITE_CLERK_PUBLISHABLE_KEY` is ever unset
(`ClerkRoot` renders its children unwrapped; `AuthStatus` renders nothing;
`getClerkToken()` returns `null`) -- but since Access is off, an unset key on
a live deployment now means generation is unreachable, not merely
unauthenticated, which is the fail-closed behaviour `isConfigured` in
`worker/index.ts` requires.

**What only Chris can do (one-time, dashboard-only):**

- **Remove the Cloudflare Access application** that used to gate this
  Worker's route: <https://one.dash.cloudflare.com/> → **Access →
  Applications** → find the one protecting `vibld-web-preview` (or wherever
  the builder is routed) → delete it. Leaving it in place means Access still
  intercepts every request before Clerk is ever reached, regardless of what
  the Worker's own code does -- Access was always a second, independent gate
  at the edge, not something this repository's deploy can remove on its own.
- **Waitlist mode**: `https://dashboard.clerk.com/~/user-authentication/access-mode`
  → **Waitlist** → **Save** (done). Approve or deny requests at
  `https://dashboard.clerk.com/~/users/waitlist`.
- `VIBLD_PLATFORM_ADMINS` (comma-separated verified emails) is set on the
  deployment, but nothing reads it yet -- `platform-admins.ts`'s
  `isPlatformAdmin` exists and is tested, but no endpoint calls it. There is
  no admin-only surface to gate until one exists; wiring it in ahead of that
  would be guessing at a shape nothing has tested yet.

## Sandbox previews (docs/decisions.md L7-L11)

`/api/preview` runs the caller's own project for real -- `npm install`, then
a live dev server -- in a genuinely untrusted, time-boxed container, and
returns a URL to view it. All of the actual work (the container, egress
lockdown, concurrency, lifetime) lives in `@vibld/preview`, a separate
Worker; see that package's README for why, and for what it does and does
not do yet (sharing beyond default privacy is the open piece). This app's
own `worker/preview-client.ts` is a thin, authenticated forwarder: it
resolves the caller's Clerk principal, then calls `@vibld/preview` over a
service binding, trusting nothing the browser could have supplied itself.

- `POST /api/preview` -- body `{ "files": [{ "path", "content" }, ...] }`
  (the same shape `/api/plan`'s `base` already uses). Starts a preview, or
  reports queued/in-progress if the caller already has one running.
- `GET /api/preview` -- polls the current preview's status. Never starts or
  enqueues anything; safe to call as often as needed.
- `DELETE /api/preview` -- stops the caller's preview early. Idempotent.

Every response is one of: `{status: "queued", position}`,
`{status: "ready-to-start"}` (a slot freed while queued -- call `POST`
again with the files to actually start), `{status: "installing" | "starting"}`,
`{status: "ready", url, expiresAt}`, or `{status: "failed", error}`.

`/api/preview` answers `503` when `PREVIEW` or `PREVIEW_INTERNAL_SECRET` is
unset -- unavailable, never open, the same rule `isConfigured` already
applies to `/api/plan`.

### In the builder shell

The Preview tab's "Run in sandbox" button calls `/api/preview` with the
accepted checkpoint's files
(`src/generation/preview-client.ts`, the browser-side mirror of
`worker/preview-client.ts`'s `PreviewStatus` union and its defensive
parsing) and polls until the sandbox settles, then swaps the local mock for
a real `<iframe src>` pointed at the returned URL. "Stop" ends it early;
the tab shows a `live` badge while a sandbox is running, since it keeps
running even while another tab is in view.

The polling state lives in `Workspace.tsx` (`generation/use-preview-sandbox.ts`'s
`usePreviewSandbox`), one level above `PreviewPanel`, not inside
`PreviewPanel` itself: `Workspace` renders `PreviewPanel` only while the
Preview tab is active, so state scoped to `PreviewPanel` would be torn
down -- along with the poll loop -- every time the user switched to Code or
Console and back, silently orphaning a sandbox that was still running.

### Setup

1. Deploy `@vibld/preview` first (see its own README) -- apps/web's service
   binding only routes successfully once `vibld-preview` exists.
2. Add `PREVIEW_INTERNAL_SECRET` (a long random value) to the `preview`
   environment here, the same value used when deploying `@vibld/preview`.
   The **Deploy web preview** workflow syncs it to this Worker.

## Billing (docs/decisions.md L12-L15)

Stripe-hosted Checkout and Billing Portal (L12): card data never reaches
this Worker, only a redirect URL does. Stripe webhooks mirror subscription
state into D1 (L13); the app reads that copy, not Stripe, on every request
that needs it. Vibld owns the Clerk-user-id-to-Stripe-customer mapping
(L14) via `client_reference_id` and customer metadata -- not Clerk Billing.
Stripe Tax is on for every Checkout Session (L15).

The five prices this deployment sells (L36/L38: Build $29/mo or $290/yr,
Ship $99/mo or $990/yr, Top-up $20 one-time) already exist in the live
Stripe account, referenced here by `lookup_key` (`stripe-client.ts`'s
`PRICE_LOOKUP_KEYS`) rather than by id -- correcting a price in the Stripe
Dashboard needs no code change, only the amount to change.

- `GET /api/billing/status` -- authenticated, no body. Returns the caller's
  own tier, this period's spend against their allowance, remaining top-up
  credit, and whether a Stripe customer exists yet for them (see "Billing UI
  in the builder shell" below).
- `POST /api/billing/checkout` -- body `{ "tier": "build" | "ship", "interval": "monthly" | "annual" }`
  or `{ "topup": true }`. Authenticated the same way `/api/plan` is; returns
  `{ url }`, the Checkout Session to redirect the browser to.
- `POST /api/billing/portal` -- authenticated, no body. Returns `{ url }` for
  the Stripe-hosted Billing Portal, where a customer manages or cancels
  their own subscription.
- `POST /api/stripe/webhook` -- Stripe's own POST, not a browser's. No Clerk
  session exists to check; the `Stripe-Signature` header, verified against
  the raw body before anything is parsed (L30), is the entire
  authentication. Subscribed events: `checkout.session.completed`,
  `customer.subscription.created` / `.updated` / `.deleted`, `invoice.paid`,
  `invoice.payment_failed` (the last two are acknowledged but not yet
  separately mirrored -- `customer.subscription.updated` already carries
  the status change either one implies).
- A nightly Cron Trigger (`wrangler.jsonc`'s `triggers.crons`) re-reads every
  mirrored subscription from Stripe and corrects any drift a missed or
  failed webhook delivery left behind (L13).

### What a tier actually buys (docs/decisions.md L35-L39)

`/api/plan`'s own spend gate (`worker/index.ts`'s `reserveBudget`) reads the
caller's mirrored subscription (`worker/entitlement.ts`'s `tierFor`) and
ceilings each run against three layers, in order:

1. **The account-wide daily ceiling** (L29) -- unchanged, still a UTC day.
2. **The caller's own monthly tier allowance** (L36): Free $1/mo, Build
   $10/mo, Ship $40/mo, resetting on the UTC calendar month.
3. **Top-up credit** (L37), tried only once the monthly allowance is
   genuinely exhausted, not merely low. A top-up is not period-scoped --
   it persists until spent, tracked as its own `USER_BUDGET` instance keyed
   `"<userId>:topup"` rather than a separate table, so the ceiling for that
   instance (the caller's lifetime top-up total, from
   `BillingStore.totalTopupCreditMicroUsd`) less what has been spent from it
   _is_ the remaining balance -- the same mechanism that already enforces
   every other ceiling here, reused rather than reimplemented.

A caller with no active subscription is Free. A denied `SpendVerdict`'s own
reason is `period-ceiling` now, not `daily-ceiling` -- it covers both the
account's daily layer and a tier's monthly one, whichever fires.

Two deliberate simplifications, both documented at their own definitions
rather than repeated here: the monthly reset is the calendar month for
everyone, not each subscription's own billing-cycle anchor
(`entitlement.ts`'s `allowancePeriodKey`); and a top-up's 12-month expiry
(L36) is approximated by excluding old purchases from the running total
outright, not by tracking each purchase's own expiry against what was
actually drawn from it first (`BillingStore.totalTopupCreditMicroUsd`).

### Billing UI in the builder shell (L35)

The header now shows the caller's tier and this period's spend against their
allowance (`GET /api/billing/status`, `worker/index.ts`'s `handleBillingStatus`
-- a read-only mirror of exactly what `reserveBudget` above computes and
reserves against; nothing new is authoritative, `UserBudget` still is), plus:

- **A tier picker and "Upgrade" button**, shown only on the Free tier --
  starts a Checkout Session for the chosen tier at the monthly price
  (`src/billing/billing-client.ts`'s `startCheckout`).
- **"Buy top-up"** -- always offered; a top-up is a fallback layer regardless
  of tier (see above).
- **"Manage billing"**, opening the Stripe-hosted Billing Portal -- shown
  only once the status endpoint reports a Stripe customer exists
  (`hasStripeCustomer`), since the Portal 502s without one and a caller who
  has never checked out has nothing to manage yet.

Every button redirects the whole page to a Stripe-hosted URL and back
(`success_url`/`cancel_url`/the Portal's `return_url`), so there is no
in-app checkout state to keep in sync -- the next mount just fetches the
status again. `src/components/BillingStatus.tsx` is the JSX half; the fetch
wrapper and URL-shaped response parsing it calls are JSX-free
(`src/billing/billing-client.ts`) for the same testability reason
`remote-provider.ts` is (see that file's own doc comment).

### Setup

1. `wrangler secret put STRIPE_SECRET_KEY` -- the account's live secret key
   (https://dashboard.stripe.com/apikeys).
2. `wrangler secret put STRIPE_WEBHOOK_SECRET` -- the signing secret for
   this deployment's registered webhook endpoint
   (https://dashboard.stripe.com/workbench/webhooks). Relayed once, out of
   band, when the endpoint is created -- never committed here.
3. Once `app.vibld.com` (L20) is live, update that webhook endpoint's `url`
   to point at it (a Dashboard edit or one API call; the signing secret does
   not change). Until then, deliveries queue and retry against a domain
   that does not yet resolve to this Worker -- harmless, since nothing can
   subscribe before both the code and the domain exist.

## Generated output

Generated projects are conventional and portable (ADR-0002): React, TypeScript
and Vite with ordinary `dev`, `build`, `lint` and `typecheck` scripts, and no
Vibld runtime dependency.
