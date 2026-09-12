# Plan: push to GitHub, and rebuild on a host

Status: proposal. Nothing here is built. Its three open questions are
answered below (2026-09-09) -- phase 4's answer changes what phase 4 is; see
that section before implementing it.

Covers issue #13 (GitHub branches and PRs, already specified and accepted)
and the deployment half, which has no issue and is new scope.

## The finding that shapes the whole design

Pushing to GitHub and triggering a rebuild are not two features of similar
size. **On every platform with a Git integration, the push is the trigger.**

Verified September 2026:

| Platform                   | Redeploys on push?          | Explicit trigger                                                                         | Credential Vibld would hold             |
| -------------------------- | --------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------- |
| Cloudflare Workers / Pages | Yes, Git integration        | Deploy Hook URL (POST), added April 2026                                                 | none, unless using the hook             |
| Vercel                     | Yes, Git integration        | Deploy Hook URL (GET/POST)                                                               | none, unless using the hook             |
| Netlify                    | Yes, Git integration        | Build hook URL                                                                           | none, unless using the hook             |
| DigitalOcean App Platform  | Yes, Git integration        | `POST /v2/apps/{id}/deployments`, or its GitHub Action                                   | API token, if using the API             |
| Render, Railway, Fly       | Yes, Git integration        | Deploy hook URL                                                                          | none, unless using the hook             |
| **Vultr**                  | **No first-party Git PaaS** | Coolify or Dokploy webhook, GitHub Actions to Vultr Kubernetes or the container registry | **none -- the trigger lives on GitHub** |

Vultr is the row that settles the architecture. There is no Vercel-style
"connect a repo" product; every documented path deploys _from GitHub_ --
a repository webhook into a self-hosted PaaS, or a GitHub Actions workflow.
The generic answer to "and other common hosting platforms" is therefore not
an adapter per platform. It is: **get the code into GitHub correctly, and let
the platform's own integration do the rest.**

So the plan is one substantial piece of work and two small ones.

## Two credential classes, and only one is blocked

ADR-0006's credential table already separates these, which decides the
sequencing:

**GitHub App private key -- "Vibld infrastructure ... trusted service bindings
only".** A Worker secret. Installation access tokens are minted per request
from the App key plus a non-secret installation id, expire in an hour, and
are never stored. Nothing user-secret is persisted.

→ **#13 is not blocked on #15's user-secret store.** That is worth stating
plainly, because #13 currently reads as though it were.

**Deploy hook URLs and platform API tokens -- user secrets.** Vercel's own
documentation is explicit: _"anyone with the URL to deploy your project, so
treat it with the same security as you would any other token or password."_
ADR-0006 requires choosing "a user-secret store with separate encryption keys
or a dedicated secret service **before** storing user keys."

→ **Anything where Vibld holds a deploy credential is blocked on #15.**

## The third option, which dodges the block entirely

ADR-0006 says production application secrets belong in **the target's** secret
store, not Vibld's. Taken literally, that points at an approach that needs no
Vibld secret store at all:

**Generate a `.github/workflows/deploy.yml` into the project itself.** The
user puts their platform token in their own repository's Actions secrets.
Vibld never sees it, never stores it, never transmits it.

This is worth more than a workaround. It:

- works for **every** platform including Vultr, because GitHub Actions can
  reach anything;
- satisfies ADR-0006's rule as written rather than by exception;
- keeps ADR-0002's promise, because the exported project deploys itself with
  no Vibld account, service or involvement -- a Vibld-hosted deploy trigger
  would be the first thing in the output that needed Vibld;
- costs one template file per target instead of an integration per platform.

It is also the honest version of "trigger a rebuild in Vultr": the trigger is
a workflow the user owns, not a call from us.

## What exists today, and what this needs

Current Worker: one SQLite Durable Object (`UserBudget`), two rate limits,
Cloudflare Access for identity, no database, no KV, no R2, no secret store.
Project state lives in the browser (`InMemoryGenerationStore`); export is a
client-side `.zip` (#57).

Three things this plan does **not** need, which is the reason it can start:

- **No #11 (durable storage).** The browser holds the accepted snapshot and
  posts it to the Worker, exactly as `/api/plan` already receives a base
  project. The same guard and size caps apply.
- **No #14 (accounts).** Access already yields a stable identity, and the
  budget object is already keyed on it (`env.USER_BUDGET.getByName(email)`).
  The repository binding keys the same way.
- **No #15 (secret store)** -- for the GitHub half. See above.

What it does need: one new Durable Object holding **non-secret** binding
metadata.

```
ProjectRepo (SQLite DO, keyed by Access identity)
  installationId    number     GitHub App installation, not a secret
  owner, repo       string     approved destination
  defaultBranch     string
  grantedAt         number     ADR-0006 grant: when, and by whom
  expiresAt         number     grants expire
  revokedAt         number?    revocation blocks new work
  lastPush          { revision, branch, commitSha, treeSha, at }
```

`lastPush` is what makes retries safe; see below.

## Pushing, without git

Workers cannot run `git`. The Git Data API does the whole thing in four calls,
and for a project of this size the file contents go inline in the tree, so
there is no separate blob upload:

1. `GET /repos/{o}/{r}/git/ref/heads/{base}` → base commit sha
2. `POST /repos/{o}/{r}/git/trees` → tree, `base_tree` omitted so the tree is
   exactly the accepted snapshot and a file Vibld dropped is a file deleted
   (the same semantics the generation machine already has)
3. `POST /repos/{o}/{r}/git/commits` → commit, parent = base
4. `POST /repos/{o}/{r}/git/refs` → create `refs/heads/vibld/<revision>`

Then `POST /repos/{o}/{r}/pulls` for the pull request.

Minting the installation token needs an RS256 JWT signed with the App key.
Workers' WebCrypto does `RSASSA-PKCS1-v1_5` with SHA-256 directly -- no
dependency, and no vendor SDK crossing the ADR-0003 boundary.

### Exactly-once, which ADR-0007 requires by name

> Use stable operation identifiers and recorded results for external side
> effects. After an ambiguous GitHub response, inspect remote state before
> retrying. Workflows retries alone do not provide exactly-once commits, PR
> creation or deployment.

Three properties make a retry safe:

- **The branch name is derived from the revision**, not from a clock or a
  counter: `vibld/<revision>`. Two attempts at the same checkpoint target the
  same ref.
- **Trees are content-addressed.** Building the same file set twice yields the
  same tree sha, so an ambiguous "did step 2 land?" is answered by comparing,
  not by guessing.
- **`lastPush` is recorded in the DO before the call and reconciled after.**
  On an ambiguous failure the next attempt reads the remote ref first: if it
  already points at a commit whose tree matches, the push succeeded and the
  retry reports success rather than creating a second commit.

The pull request is deduplicated the same way -- query open PRs for the head
branch before opening one.

### Conflicts are reported, never resolved

ADR-0007: "Do not silently force-push, merge, publish a repository or change
its visibility." So:

- ref creation is create-only; an existing ref that points elsewhere is a
  conflict, surfaced with both shas;
- no `force`, ever, on any ref;
- the base branch is never written;
- the repository is never created, renamed, or made public by this path.

## Where the danger actually is

Counter-intuitively, the GitHub half is the safe half. The dangerous feature
is the innocuous-looking one: a text box where someone pastes a deploy hook
URL that the Worker then POSTs to.

That is a server-side request forgery primitive, and ADR-0006 already forbids
its general form: _"A broker authorizes operations, not arbitrary
authenticated forwarding. Bind allowed methods, destinations and paths;
validate redirects and block private-network/metadata destinations. Restrict
response content and size. Never expose a generic proxy backed by broad
credentials."_

If a stored-hook feature is ever built (phase 4 below), it must:

- accept **https only**, and only hosts matching a per-platform allowlist
  (`api.vercel.com`, `api.cloudflare.com`, `api.digitalocean.com`,
  `api.netlify.com`, …) -- chosen by the user picking a platform, not by
  parsing whatever they pasted;
- resolve the host and refuse private, loopback, link-local and
  metadata-service addresses, re-checking after any redirect -- or simply
  refuse redirects, which is what these endpoints need anyway;
- send `POST` with no body and no Vibld credential;
- cap and discard the response body rather than returning it to the browser,
  which would make the Worker a readable proxy;
- be rate limited per user, like `/api/plan` already is.

The phase ordering below exists partly so this is the last thing built, not
the first.

## Phases

**Phase 1 -- Push to GitHub (#13).** GitHub App, installation binding, push an
accepted checkpoint to `vibld/<revision>`, open a PR. Unblocked today. This is
the substantial piece: roughly a Worker route, a DO, a GitHub client, the JWT
signing, and the reconciliation logic.

**Phase 2 -- Deploy: build nothing.** Document connecting the repository to
Cloudflare, Vercel, Netlify or DigitalOcean once, in their dashboard. From
then on every Vibld push redeploys. Zero code, zero credentials, and it covers
most of the platforms in the table. Shipping phase 1 without saying this out
loud would be the mistake -- people would ask for an integration they already
have.

**Phase 3 -- "Add a deploy workflow".** A `.github/workflows/deploy.yml`
generated into the project, one small template per target (Cloudflare via
`wrangler`, Vercel CLI, DigitalOcean's `app_action`, Vultr via its registry or
Kubernetes). The user adds their token to their own repo's secrets. This is
what makes "and other common hosting platforms" true, including the ones with
no Git integration at all. Still zero Vibld secrets.

**Phase 4 -- Stored deploy hooks (optional, blocked on #15).** Only if phases
2 and 3 prove insufficient. Needs the encrypted secret store, the allowlisted
broker above, and its own security review. My recommendation is to not build
it: it buys a button that saves one dashboard visit, in exchange for holding
a credential that redeploys production.

## Failure modes worth designing for

| Situation                               | What the user sees                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| App uninstalled or access revoked       | "Vibld no longer has access to owner/repo" and a re-connect link -- not a 401 |
| Grant expired                           | Same shape; re-approval, not a silent re-auth                                 |
| Branch already exists, different commit | Both shas, and a choice: new branch, or stop                                  |
| Ambiguous push (timeout after step 3)   | Nothing on retry -- the reconciliation finds the commit and reports success   |
| Repo empty (no base ref)                | Handled: first commit has no parent                                           |
| Project over the size cap               | Refused before the API call, like the prompt guard already does               |
| GitHub rate limit / 5xx                 | Retry with backoff **only** after reconciling remote state                    |

## Testing

The GitHub client goes behind a Vibld-owned interface, as the model provider
already is (ADR-0003), so the push path is testable with a fake and no
network. Specifically worth asserting:

- a repeated push of one checkpoint creates one commit and one PR;
- an ambiguous response followed by a retry creates one commit;
- a diverged branch produces a conflict, and no force-push is attempted;
- a revoked or expired grant is refused before any GitHub call;
- the tree sent equals the accepted snapshot exactly, with the same path rules
  the zip writer already enforces (no absolute paths, no `..`, no duplicates);
- for phase 4 if it happens: metadata-service, loopback, private-range and
  redirect-to-private URLs are all refused.

## What I would deliberately not build

- Arbitrary repository import -- ADR-0007 defers it, and it is a different
  security problem.
- Pushing to `main`, merging, or anything that publishes.
- A platform adapter per host. The table above shows it would be almost
  entirely redundant with Git integration.
- Vibld-held production credentials, unless phase 4 clears a security review.

## Answered by the decision owner (2026-09-09)

Recorded as L42a-c in [`decisions.md`](decisions.md#launch-decisions-accepted-2026-09-09); full context in [`launch-decisions.md`](launch-decisions.md).

1. **GitHub App name, ownership and permission set -- accepted as proposed
   (L42a).** Contents, Pull requests, Metadata only. No Actions, no admin.
2. **Phase 3's target list -- no Vultr template (L42b).** Cloudflare, Vercel
   and DigitalOcean, as this plan already lays out.
3. **Phase 4, Vibld-held deploy credentials -- wanted, reversing this plan's
   recommendation (L42c).** Chris wants a lights-out flow: the user pastes a
   scoped Cloudflare API Token into Vibld, Vibld holds it and drives the
   Worker + DNS publish automatically, rather than the git-connected pattern
   phases 1-3 describe. This is a different mechanism from everything above
   phase 4 in this document -- a held, usable third-party credential rather
   than a one-way GitHub push -- and needs its own credential-vault design
   before it can be scoped as a phase. The open qualifying questions (token
   vs. OAuth, where the token is stored, which platform first, custom-domain
   handling) are recorded under "Reopened" in `decisions.md`. Phase 4 in this
   document should be read as superseded by that design once it lands, not
   as the plan to build.

## References

- [Cloudflare Workers Builds -- Deploy Hooks](https://developers.cloudflare.com/workers/ci-cd/builds/deploy-hooks/)
- [Cloudflare Workers Builds -- Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/)
- [Vercel -- Creating and triggering Deploy Hooks](https://vercel.com/docs/deploy-hooks)
- [DigitalOcean App Platform -- deploy from GitHub Actions](https://docs.digitalocean.com/products/app-platform/how-to/deploy-from-github-actions/)
- [Vultr -- deploying a Git project with Dokploy](https://docs.vultr.com/how-to-deploy-jetbrains-junie-projects-on-vultr-using-dokploy)
- [GitHub -- installation access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
