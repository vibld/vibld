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
- No authentication, durable persistence, Git export or deployment.

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

| Secret                  | Value                                                   |
| ----------------------- | ------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | A token with **Workers Scripts: Edit** and nothing more |
| `CLOUDFLARE_ACCOUNT_ID` | The target Cloudflare account                           |

Environment secrets are reachable only from a job that names the environment,
and any protection rule on it gates the run before a single step executes. Add
yourself as a **required reviewer** if the deploy should need approval each
time. Repository-level secrets of the same name still work as a fallback.

`Workers Scripts: Edit` cannot be scoped to one script, so the token can write
to every Worker on the account it is issued for. Issue it against a Cloudflare
account used only for Vibld to keep the blast radius to this preview.

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

## Generated output

Generated projects are conventional and portable (ADR-0002): React, TypeScript
and Vite with ordinary `dev`, `build`, `lint` and `typecheck` scripts, and no
Vibld runtime dependency.
