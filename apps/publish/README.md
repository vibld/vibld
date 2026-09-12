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

`/internal/publish` itself only ever accepted already-built static files
(`ProjectFile[]`, the same shape apps/preview's `/internal/preview/start`
already takes) -- it has never run a build itself, by design (this
Worker's job is storing and serving, not building). `apps/web`'s
`POST /api/publish` now supplies that missing piece: it calls
apps/preview's `buildProject` first, then hands this Worker the result --
see `apps/web/README.md`'s "Cloudflare auto-publish" section for the full
path. `apps/web/worker/index.ts`'s `handlePublish` also gates that
endpoint with its own `PUBLISH_BURST` rate limit, the same shape
`PLAN_BURST` uses -- so the "no real caller yet to gate" reasoning this
section used to give is resolved.

Still not built, per ADR-0010's own scoping:

- The opt-in custom-domain step (the user's own pasted Cloudflare token).
- Storage quota per user/plan tier (only a request-rate limit exists so
  far, not a cap on how much R2 storage one account may occupy).
- Slug release/reclaim rules after a project is deleted.
- Binary assets (images, fonts): `apps/preview`'s `buildProject` skips
  them rather than mis-serve them, since this Worker's own R2 usage is
  text-only today (see `publish-store.ts`'s module comment). A build that
  emits any reports which paths were skipped in its response.

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

Run the **Deploy publish service** workflow from the Actions tab
(`workflow_dispatch` only) -- deploy this, and apply the migration above,
before apps/web calls `/api/publish` for the first time.

To deploy from a workstation instead:

```bash
pnpm --filter @vibld/publish deploy
```
