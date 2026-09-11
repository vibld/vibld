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
`FakeModelProvider` into a `DurableGenerationRunner` over an
`InMemoryGenerationStore`, validates the staged snapshot, promotes the
checkpoint by compare-and-set and meters the run with `RunBudgetLedger`. To show
lifecycle progress without adding an event bus to core, `src/generation/observers.ts`
decorates the `GenerationStore` and `ModelProvider` contracts the runner already
depends on.

`BuilderSession` (`src/generation/session.ts`) is a framework-free controller;
React binds to it with `useSyncExternalStore`. An epoch guard means a run
abandoned by "Start over" or by a repeated submission can never write its result
into newer state.

## What this slice does not do

- **The built-in preview pane is still a local mock.** It is static HTML
  assembled from the accepted plan and the generated stylesheet, rendered in
  a fully restricted iframe (`sandbox=""`); nothing installs dependencies and
  no generated code runs there. Real sandbox execution now exists
  (`@vibld/preview`, ADR-0004, "Sandbox previews" below) and `/api/preview`
  can run and expose a live, installed copy of the same project -- the shell
  does not call it from this pane yet, so a running preview today means
  calling `/api/preview` directly, not clicking a button here.
- **There is no model provider.** Plans come from a deterministic local
  function so CI needs no credentials (ADR-0007).
- **Console and Problems are placeholders** beyond the lifecycle log and
  validation findings. `@vibld/preview` reports install/start success or
  failure as a whole (see "Sandbox previews" below), but nothing pipes a
  running preview's live process output or build diagnostics into these
  panels yet.
- **No project persistence, Git export or deployment.** A D1/R2-backed
  `GenerationStore` exists (`worker/generation-store.ts`) and is tested
  against the same contract `InMemoryGenerationStore` satisfies, but nothing
  in this slice calls it yet. Clerk sign-in is live now (see "Clerk
  authentication" below), so there is an authenticated principal to own a
  project against, but wiring `generation-store.ts` in is separate work that
  has not started; every generation here still runs in the browser against
  in-memory state that a reload discards.

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

`/api/plan` and `/api/config` serve a generation only when **all three** of
a provider key (`ANTHROPIC_API_KEY` or `DEEPSEEK_API_KEY`), `USER_BUDGET` and
`CLERK_FRONTEND_API_URL` are present. Missing configuration means refused,
never open: an unauthenticated endpoint on a public URL would let anyone
spend the account's model budget.

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

### Setup

1. Deploy `@vibld/preview` first (see its own README) -- apps/web's service
   binding only routes successfully once `vibld-preview` exists.
2. Add `PREVIEW_INTERNAL_SECRET` (a long random value) to the `preview`
   environment here, the same value used when deploying `@vibld/preview`.
   The **Deploy web preview** workflow syncs it to this Worker.

## Generated output

Generated projects are conventional and portable (ADR-0002): React, TypeScript
and Vite with ordinary `dev`, `build`, `lint` and `typecheck` scripts, and no
Vibld runtime dependency.
