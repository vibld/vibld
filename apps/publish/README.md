# @vibld/publish

Serves the primary, Vibld-subdomain path of Cloudflare auto-publish
(ADR-0010: [`docs/adr/0010-cloudflare-auto-publish.md`](../../docs/adr/0010-cloudflare-auto-publish.md);
docs/decisions.md L40). A published project gets a working
`<slug>.published.vibld-preview.dev` URL with no Cloudflare credential of
the user's involved at all -- this Worker runs entirely on infrastructure
Vibld already controls.

```bash
pnpm install
pnpm --filter @vibld/publish typecheck
pnpm --filter @vibld/publish test
```

## What this is

- **`worker/publish-store.ts`** -- `PublishStore`: a slug → `{projectId,
userId}` mapping in D1, and a project's built file content in R2, keyed
  `published/{slug}/{path}`. Both the D1 database and the R2 bucket are the
  _same_ `vibld-control-plane` ones apps/web already binds (see
  `wrangler.jsonc`'s comment) -- one more table and one more key prefix, not
  a second database or bucket to provision.
- **`worker/index.ts`** -- routes two kinds of traffic on one Worker: an
  internal API (`/internal/publish`, gated by a shared secret --
  `internal-auth.ts`, the same shape apps/preview's own internal API uses)
  that apps/web calls once it has a project's _already-built_ static output
  ready to publish; and public, unauthenticated traffic for
  `*.published.vibld-preview.dev`, resolved by slug and served straight out
  of R2 with static-hosting fallback semantics.
- **`worker/slug.ts`** -- slug validation: a published slug becomes a DNS
  label, so it is checked as one (RFC 1035 shape, lowercase, a short
  reserved list) rather than accepted as free text.
- **`worker/resolve-path.ts`** -- the fallback order a request path is
  tried in: the literal path, then `path.html`, then `path/index.html` --
  the same "deep links and missing routes" concern ADR-0008 already raises
  for the generated template, applied here at serve time.
- **`worker/content-type.ts`** -- Content-Type by file extension. R2 holds
  no metadata of its own in this Worker's usage, so this is recovered from
  the path alone, same as any conventional static file server.

## Why a separate package, not a folder in apps/web

Same first reason apps/preview gives for the same question: a published
site needs the isolated origin `vibld-preview.dev` already provides (ADR-0010
extends its existing cookie-isolation argument from ephemeral previews to
durable published output), which means a separate Worker regardless of
anything else. This package needs no container/Sandbox SDK, unlike
apps/preview, so it has no Docker build step at deploy time.

## What this does not do yet

**This ships the serving half only.** `/internal/publish` accepts a
project's already-built static files (`ProjectFile[]`, the same shape
apps/preview's `/internal/preview/start` already takes) and stores/serves
them -- it does not itself run a production build. Nothing in this
codebase currently turns a generated project's source into built static
output outside of a live dev server (`apps/preview`'s `PreviewSandbox` runs
`npm run dev`, not `npm run build`); wiring an actual "Publish" action in
apps/web means deciding how and where that build step runs, which is a
separate piece of work, not assumed here.

Also not built here, per ADR-0010's own scoping:

- The opt-in custom-domain step (the user's own pasted Cloudflare token).
- Rate limiting / storage quota on `/internal/publish` (ADR-0010's
  Consequences section flags this as needed before this is reachable from
  a real user action -- follow the `PLAN_BURST`/`IP_BURST` pattern
  `apps/web/worker/index.ts`'s `handlePlan` already uses, once there is a
  caller to gate).
- Slug release/reclaim rules after a project is deleted.

## Deploying

**No new Cloudflare resources to create.** This Worker binds the exact
`database_id`/`bucket_name` apps/web's `wrangler.jsonc` already uses;
Cloudflare allows the same D1 database and R2 bucket to be bound into more
than one Worker. Before the first deploy, apply the new table's migration
against that database the same way `migrations/0001` and `0002` were
applied (`vibld-control-plane`, from a workstation with the real
`CLOUDFLARE_API_TOKEN` -- this environment has no such credential, so this
one step has to happen from wherever those two were run):

```bash
pnpm dlx wrangler@4.129.1 d1 migrations apply vibld-control-plane --remote
```

One-time: add a **`PUBLISH_INTERNAL_SECRET`** secret (a long random value,
distinct from `PREVIEW_INTERNAL_SECRET` -- a leak of one must not
compromise the other) to the **`preview`** environment under **Settings →
Environments**, the same one `apps/web` and `apps/preview` already use.

The Cloudflare API token needs **Workers Scripts: Edit** (already covers
this account) plus **DNS: Edit** on the `vibld-preview.dev` zone, for the
wildcard route -- the same permissions apps/preview's own token already
has, since it is the same zone.

There is no `deploy-publish.yml` workflow yet -- add one mirroring
`deploy-web-preview.yml`'s Cloudflare-credential-check and secret-sync
steps once `/internal/publish` has a real caller in apps/web. Until then,
deploy from a workstation:

```bash
pnpm --filter @vibld/publish deploy
```
