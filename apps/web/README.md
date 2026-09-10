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

- **The preview is a local mock.** It is static HTML assembled from the accepted
  plan and the generated stylesheet, rendered in a fully restricted iframe
  (`sandbox=""`). Nothing installs dependencies and no generated code runs.
  Sandbox execution (ADR-0004) is not implemented.
- **There is no model provider.** Plans come from a deterministic local
  function so CI needs no credentials (ADR-0007).
- **Console and Problems are placeholders** beyond the lifecycle log and
  validation findings. Process output and build diagnostics arrive with sandbox
  execution.
- **No authentication, Git export or deployment.** A D1/R2-backed
  `GenerationStore` exists (`worker/generation-store.ts`) and is tested
  against the same contract `InMemoryGenerationStore` satisfies, but nothing
  in this slice calls it yet: there is no authenticated principal to own a
  project until Clerk lands (docs/decisions.md L1), and every generation
  here still runs in the browser against in-memory state that a reload
  discards.

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

The deployed URL is public on `workers.dev`. Put it behind Cloudflare Access if
the work in progress should stay internal.

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

`/api/plan` serves a generation only when **all three** of `ANTHROPIC_API_KEY`,
`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are present. Missing configuration means
refused, never open: an unauthenticated endpoint on a public URL would let
anyone spend the account's model budget.

The Worker verifies the Cloudflare Access JWT itself rather than trusting the
`Cf-Access-Jwt-Assertion` header. Access already checks at the edge, but a
header is forgeable by anyone reaching the origin directly, and ADR-0006
requires proving a raw URL cannot bypass access control. Verification pins
RS256 (rejecting the `alg: none` downgrade), matches the application audience
and team issuer, and honours expiry with a small skew allowance.

### Setup

1. Enable Access on the Worker: **Workers & Pages → the Worker → Settings →
   Domains & Routes**, then **Enable Cloudflare Access** for the `workers.dev`
   URL. This works on `workers.dev` directly — no custom domain needed.
2. In **Zero Trust → Access → Applications**, open the generated application
   and copy its **Application Audience (AUD) tag**.
3. Set `ACCESS_TEAM_DOMAIN` (e.g. `yourteam.cloudflareaccess.com`) and
   `ACCESS_AUD` in `wrangler.jsonc`, then redeploy.
4. Add the key as a Worker secret — it must never be committed:
   `wrangler secret put ANTHROPIC_API_KEY`

Until all of that is in place the deployed shell keeps running the fake, which
is the intended safe default.

### Trying generation without a terminal

The **Try a generation** workflow in the Actions tab runs one real generation
from a prompt you type in the UI, prints the result to the run summary, and
optionally installs and builds the generated project as the ADR-0002
portability check. It needs `ANTHROPIC_API_KEY` on the `preview` environment
and spends model tokens on each run.

## Clerk authentication (sign-in live; not yet gating anything)

The Clerk instance exists and is live: Frontend API at
`https://clerk.vibld.com` (a custom domain -- its DNS record must stay
**DNS only**, not proxied, or Cloudflare intercepts it with its own "DNS
points to prohibited IP" error before Clerk ever sees the request), with
`CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` set on the `preview`
environment.

Two independent pieces exist so far:

- **Verification** (`worker/clerk-auth.ts`, `worker/platform-admins.ts`):
  verifies Clerk session tokens (RS256, JWKS-pinned, the same shape as the
  Access verification above) and decides platform-admin status from a
  verified, allow-listed email. Built and tested against the real JWKS
  endpoint; not called from request handling yet.
- **Sign-in** (`src/auth/clerk.tsx`): `ClerkRoot` wraps the app in
  `ClerkProvider` and the header shows a working sign-in button / user menu,
  using `VITE_CLERK_PUBLISHABLE_KEY` at build time (`CLERK_PUBLISHABLE_KEY`
  on the `preview` environment, synced by the deploy workflow's Build step).
  A visitor can sign in for real right now -- it just doesn't unlock
  anything yet.

Neither is wired to `requireAccess` in `worker/index.ts`. Access stays
authoritative until Clerk sign-in and the abuse controls in
docs/decisions.md L29 are both ready to land in the same deploy
(docs/decisions.md L5) -- this exists so that deploy is a cutover, not a
rewrite. Both pieces above gracefully no-op if their key is ever unset
(`ClerkRoot` renders its children unwrapped; `AuthStatus` renders nothing),
so an incomplete deployment never breaks the app that already works.

**Still needed before the cutover:**

1. A custom session token claim, from **Configure → Sessions → Edit** →
   **Customize session token** in the Clerk dashboard, so verified requests
   carry an email at all:
   ```json
   { "email": "{{user.primary_email_address}}" }
   ```
   `clerk-auth.ts` also reads `email_verified` as a boolean off the token; if
   Clerk's shortcut for the primary address's verification status differs
   from what's above once you're in the live claims editor, add it there
   rather than guessing it here -- an unconfirmed shortcode in an auth claim
   is worse than one left out, since `platform-admins.ts` treats an absent
   `email_verified` as unverified, not as granted.
2. `VIBLD_PLATFORM_ADMINS` on the `preview` environment: comma-separated
   verified emails to grant platform-admin access.
3. The L29 abuse controls (Turnstile, a WAF rate limit on `/api/*`,
   disposable-email blocking, an account-wide daily ceiling).
4. The switch itself: `requireAccess` replaced by Clerk verification in
   `worker/index.ts`, in the same deploy as #3.

## Generated output

Generated projects are conventional and portable (ADR-0002): React, TypeScript
and Vite with ordinary `dev`, `build`, `lint` and `typecheck` scripts, and no
Vibld runtime dependency.
