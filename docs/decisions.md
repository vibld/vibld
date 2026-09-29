# Accepted product and architecture decisions

Accepted: 2026-09-06.

This register records the choices approved during the Phase 0 review. Letters retain their conversation identifiers; the descriptions make each choice usable without that conversation. D16(d) was the additional hybrid recommendation. These are approved requirements, not claims of implemented capabilities.

The [charter](../VIBLD.md), [roadmap](../ROADMAP.md), and [ADRs](adr/README.md) apply these decisions. The [original blueprint](archive/README.md) is historical context. Later accepted decisions take precedence over its tentative technology choices and conflicting milestone sequences. Change accepted decisions through a new ADR and an explicit register update.

| ID  | Choice        | Accepted direction                                                                                                                                                                                                                                     |
| --- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | a, then b/c/d | Start with technical founders and small agencies. Expand to nontechnical business owners, developers working in existing repositories, designers and marketing users. Allow for other project types and audiences without implementing them all in M1. |
| D2  | b             | Generate marketing sites and landing pages first. Business applications and CRUD workflows follow.                                                                                                                                                     |
| D3  | a             | M1 combines generated files and working preview, with bounded initial repair, a saved checkpoint and export. M2 adds dependable conversational editing and recovery. M1 is a technical alpha; M1 plus M2 proves the usable build/edit loop.            |
| D4  | b             | Run an invitation-only hosted alpha. Identity, tenant authorization, quotas, private previews, secrets and basic operations are release requirements.                                                                                                  |
| D5  | b             | Use Cloudflare Sandbox SDK for the first execution adapter. Preserve an interface for other runtimes.                                                                                                                                                  |
| D6  | c             | Use a React/TypeScript/Vite builder UI, Hono on Workers, Workflows for long-running jobs, Sandbox for execution, PostgreSQL metadata via Hyperdrive, and R2 artifacts. Add Durable Objects for coordination/live connections where needed.             |
| D7  | b             | Keep metadata in PostgreSQL and durable project content outside disposable sandboxes. Git records accepted code history; remote GitHub is optional for project survival.                                                                               |
| D8  | c             | Include GitHub connection, branches and pull requests in M1. Prove this on Vibld-generated projects first; arbitrary existing-repository import/editing comes later.                                                                                   |
| D9  | a             | Use AI SDK behind a small Vibld-owned model contract. Configure providers deliberately and keep SDK types out of domain interfaces.                                                                                                                    |
| D10 | a             | Select initial models through a measured bakeoff. No provider winner or paid evaluation allowance is implied by this decision.                                                                                                                         |
| D11 | a             | Persist a controlled workflow with one active implementation agent, bounded repairs/retries and explicit cancellation and recovery. Logical prompt roles need not be autonomous agents.                                                                |
| D12 | a             | Stage edits against a known base revision, validate them, then promote an accepted revision. Enforce one writer per project and surface conflicts without overwriting user work.                                                                       |
| D13 | c             | Include repository indexing and semantic search early. Combine exact/symbol retrieval with semantic retrieval, scoped by tenant, project and revision.                                                                                                 |
| D14 | c             | Offer selectable autonomy modes through explicit project/action/destination/budget/time permissions. The service enforces permissions; the model cannot grant itself authority.                                                                        |
| D15 | a, then b/c   | Begin with curated dependencies, then approved additions, then a broader install mode. Keep isolation, network and resource restrictions in every mode.                                                                                                |
| D16 | d             | Use a hybrid, broker-first credential design. Keep provider and control-plane credentials in trusted services; allow narrow runtime injection only where an integration requires it.                                                                   |
| D17 | b             | Make hosted previews private by default, with explicit, revocable, time-limited sharing on an isolated origin.                                                                                                                                         |
| D18 | a             | Use a versioned evaluation set covering functionality, portability and failure recovery. Report initial success and success after repair separately.                                                                                                   |
| D19 | a             | Enforce run budgets and expose usage, elapsed time and cost, including failed attempts. Bound sandbox lifetime and concurrency as well as model usage.                                                                                                 |
| D20 | b             | Enable minimal operational telemetry by default with an easy opt-out. Exclude source code, prompts and secrets. Do not describe linkable identifiers as anonymous.                                                                                     |
| D21 | a             | Keep a complete single-user builder in OSS. Cloud sells managed operations and team capabilities. Saving, Git, BYOK and export are not artificial paid gates.                                                                                          |
| D22 | a             | After the build/edit loop, deliver publishing, then one full-stack integration, then advanced visual targeting.                                                                                                                                        |
| D23 | a             | Evaluate Supabase first for generated applications' database, auth and storage. Customer application services remain separate from Vibld's own platform.                                                                                               |
| D24 | a             | Keep core Apache-2.0; license reusable starter-template source MIT. Users choose their application license subject to upstream obligations.                                                                                                            |
| D25 | a             | Founder-led governance, human-reviewed PRs and DCO sign-off. No copyright assignment and no permanent dependence on one coding-agent vendor.                                                                                                           |
| D26 | a             | Enforce a small quality baseline before feature code. Use locked installs, formatting and meaningful lint/type/test/build checks as code appears.                                                                                                      |
| D27 | a             | Preserve the original blueprint, maintain this register, and keep ADRs, roadmap, issues and real GitHub milestones aligned.                                                                                                                            |
| D28 | c             | Keep the repository informal until the product works. Defer brand work and extensive community templates; keep essential ownership, quality and security controls.                                                                                     |
| D29 | a             | Use React Router framework mode with static prerendering for generated marketing sites, alongside TypeScript, Vite, Tailwind and selected UI components. The builder UI remains a separate Vite SPA.                                                   |
| D30 | a             | Use Supabase PostgreSQL and Supabase Auth for the hosted platform, with Hyperdrive for direct PostgreSQL access from Workers.                                                                                                                          |

## Launch decisions (accepted 2026-09-09)

Accepted 2026-09-09 (internal PR 70). L1 and L24 amend D30 -- D23 is untouched by both.

| ID   | Choice         | Accepted direction                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1   | a              | Clerk replaces Supabase Auth for the Vibld platform. D23 (Supabase for generated apps) is untouched. Amends D30.                                                                                                                                                                                                                                                                                                                             |
| L2   | a              | Verify the Clerk session JWT against a cached JWKS inside the Worker -- no network call per request.                                                                                                                                                                                                                                                                                                                                         |
| L3   | a              | The budget ledger and every ownership row key on the Clerk user id. Email is display only.                                                                                                                                                                                                                                                                                                                                                   |
| L4   | a              | Platform admins come from a `VIBLD_PLATFORM_ADMINS` GitHub Actions secret (comma-separated emails), synced to the Worker on deploy, honoured only for a Clerk-verified primary address.                                                                                                                                                                                                                                                      |
| L5   | a              | Cloudflare Access stays until Clerk sign-in and the L29 abuse controls are both live, then comes off in the same deploy that opens sign-up.                                                                                                                                                                                                                                                                                                  |
| L6   | a              | Clerk waitlist mode at launch -- anyone can request, only allowlisted emails sign in.                                                                                                                                                                                                                                                                                                                                                        |
| L7   | a              | Cloudflare Sandbox SDK / Containers for preview execution, as D5 already chose.                                                                                                                                                                                                                                                                                                                                                              |
| L8   | a              | Previews run on `vibld-preview.dev`, purchased and registered on Cloudflare, one subdomain per preview, so a preview never shares cookie scope with the control plane.                                                                                                                                                                                                                                                                       |
| L9   | a              | Preview idle timeout 10 min, hard lifetime 30 min, 1 concurrent preview per user, 25 concurrent previews across all users. The 26th request is queued with a visible position, not rejected.                                                                                                                                                                                                                                                 |
| L10  | a              | Preview sharing is a signed, revocable, time-limited URL. Private by default.                                                                                                                                                                                                                                                                                                                                                                |
| L11  | a              | Sandbox egress denies by default; only the package registry is allowed. No model-provider or control-plane credential reaches a sandbox.                                                                                                                                                                                                                                                                                                     |
| L12  | a              | Stripe-hosted Checkout and Billing Portal -- card data never touches our origin.                                                                                                                                                                                                                                                                                                                                                             |
| L13  | a              | Stripe webhooks mirror subscription state into our database; a nightly reconcile against Stripe corrects drift.                                                                                                                                                                                                                                                                                                                              |
| L14  | a              | Vibld owns the Clerk-user-id-to-Stripe-customer mapping via `client_reference_id` and customer metadata.                                                                                                                                                                                                                                                                                                                                     |
| L15  | **b**          | Stripe Tax stays off at launch; revisit at volume. _(moved off recommendation -- recommended turning it on from the first invoice)_                                                                                                                                                                                                                                                                                                          |
| L16  | --             | Entity and public mailing address recorded in the site's legal pages.                                                                                                                                                                                                                                                                                                                                                                        |
| L17  | a              | Two Resend sending domains -- `notifications.vibld.com` transactional, `mail.vibld.com` marketing -- kept on separate reputations.                                                                                                                                                                                                                                                                                                           |
| L18  | a              | Double opt-in on the waitlist and any marketing list.                                                                                                                                                                                                                                                                                                                                                                                        |
| L19  | a              | DMARC starts `p=none` with reporting, moves to `p=quarantine` after two clean weeks, then `p=reject`.                                                                                                                                                                                                                                                                                                                                        |
| L20  | a              | `vibld.com` + `www` serve marketing; `app.vibld.com` serves the builder.                                                                                                                                                                                                                                                                                                                                                                     |
| L21  | a              | The marketing site is its own Worker, built from the ADR-0008 template, with its own deploy workflow.                                                                                                                                                                                                                                                                                                                                        |
| L22  | --             | Coming-soon page scope recorded below. Tagline: "Vibe. Build. Ship."                                                                                                                                                                                                                                                                                                                                                                         |
| L23  | --             | Legal pages drafted per the list recorded below, governed by Georgia law, venue in Gwinnett County.                                                                                                                                                                                                                                                                                                                                          |
| L23a | a              | Register a DMCA agent with the US Copyright Office and publish the policy now.                                                                                                                                                                                                                                                                                                                                                               |
| L23b | a              | US-only at alpha, stated in the Terms. No EU/UK acceptance yet.                                                                                                                                                                                                                                                                                                                                                                              |
| L24  | a              | Cloudflare D1 for the control plane, R2 for project content. D23 (Supabase for generated apps) is untouched. Amends D30's database half.                                                                                                                                                                                                                                                                                                     |
| L25  | a              | R2 for project content, checkpoints and export archives.                                                                                                                                                                                                                                                                                                                                                                                     |
| L26  | a              | Cloudflare Workflows for durable generation, landing in the same change as sandboxes.                                                                                                                                                                                                                                                                                                                                                        |
| L27  | --             | Paid infrastructure approved per the list recorded below.                                                                                                                                                                                                                                                                                                                                                                                    |
| L28  | a              | No row-level security on the control plane; one enforced authorisation choke point plus a test that no query path bypasses it. RLS is mandatory in the generated-app Supabase template, and generation is refused when it is off there.                                                                                                                                                                                                      |
| L29  | --             | Turnstile, a per-IP WAF rate limit, disposable-domain blocking, the existing per-user ceiling, and a new account-wide daily ceiling all ship before Access comes off.                                                                                                                                                                                                                                                                        |
| L30  | a              | Stripe, Clerk (Svix) and the GitHub App webhooks are all signature-verified with a replay window, rejected before the body is parsed.                                                                                                                                                                                                                                                                                                        |
| L31  | a              | No BYOK storage in the hosted product until a credential vault exists. _(Deployment tokens for L40's auto-publish flow are a separate question, resolved under "Resolved 2026-09-09"; they are not covered by this line.)_                                                                                                                                                                                                                   |
| L32  | --             | Project content purged 30 days after account deletion; audit log kept 12 months with the user id tombstoned.                                                                                                                                                                                                                                                                                                                                 |
| L33  | **b**          | Security scanning is run directly, and a trust centre is stood up separately.                                                                                                                                                                                                                                                                                                                                                                |
| L34  | a              | Hosted model access runs on one shared platform key per provider, gated by our own credit ledger.                                                                                                                                                                                                                                                                                                                                            |
| L35  | a              | One credit = 1¢ of model spend; the user sees a plain "generations remaining" for the model they chose.                                                                                                                                                                                                                                                                                                                                      |
| L36  | --             | Free $0/$1 spend, Build $29/$10, Ship $99/$40, top-up $20/$8 expiring 12 months. Recorded in full below.                                                                                                                                                                                                                                                                                                                                     |
| L37  | a              | Hard stop at the allowance, with one-click top-up. No auto-charged overage.                                                                                                                                                                                                                                                                                                                                                                  |
| L38  | a              | Annual billing at two months free -- Build $290, Ship $990.                                                                                                                                                                                                                                                                                                                                                                                  |
| L39  | a              | Opus is available inside a paid tier, drawn from the same allowance. _(Extended under "Resolved 2026-09-09": more providers are to be added as they ship, and hosted BYOK stays off per L45.)_                                                                                                                                                                                                                                               |
| L40  | **b**          | Vibld deploys into the user's own Cloudflare account to auto-publish exported sites, reversing the recommendation against holding deploy credentials. Resolved: a scoped API Token the user pastes in (not OAuth), stored in Cloudflare Secrets Store, Cloudflare only for now, and the primary path is a Vibld-provided subdomain auto-configured on the user's behalf -- not merely a fallback. See "Resolved" below for the exact scheme. |
| L41  | a              | Cloudflare, Vercel and Netlify at launch; DigitalOcean and a container path after.                                                                                                                                                                                                                                                                                                                                                           |
| L42a | a              | The GitHub App requests Contents, Pull requests and Metadata permissions only.                                                                                                                                                                                                                                                                                                                                                               |
| L42b | a              | No Vultr Kubernetes/registry template.                                                                                                                                                                                                                                                                                                                                                                                                       |
| L42c | **b**          | Vibld may hold deploy hooks/credentials for users, specifically to run the L40 Cloudflare auto-publish flow. _(moved off recommendation -- recommended no)_                                                                                                                                                                                                                                                                                  |
| L43  | a              | One initial commit on first export, then one commit per accepted checkpoint.                                                                                                                                                                                                                                                                                                                                                                 |
| L44  | a              | A scheduled Worker reads both providers' balances daily and emails an alert through Resend on a threshold.                                                                                                                                                                                                                                                                                                                                   |
| L45  | a              | BYOK is the self-hosted story only. The hosted product sells credits and holds no user model-provider keys.                                                                                                                                                                                                                                                                                                                                  |
| L46  | a              | The self-hosted build has no auth by default; Clerk switches on when its environment variables are present.                                                                                                                                                                                                                                                                                                                                  |
| L47  | a              | The self-hosted build ships a local (Docker or child-process) sandbox adapter alongside the Cloudflare one.                                                                                                                                                                                                                                                                                                                                  |
| L48  | a              | Billing, entitlement and tenancy code ships in the same public repository as the core, inert without secrets.                                                                                                                                                                                                                                                                                                                                |
| L49  | a              | v0.1.0 is tagged once the hosted alpha is stable and a clean checkout is proven in CI to build, run and generate with only a provider key.                                                                                                                                                                                                                                                                                                   |
| L50  | a              | The generation pattern/style/SEO catalogue is retrieved on demand -- a handful of relevant patterns injected per request -- extending D13's retrieval work and ADR-0009's bounded-context design, not held permanently in the system prompt.                                                                                                                                                                                                 |
| L51  | a              | Catalogue v1 is small and real: about 10 marketing page types, 6 SaaS app screens, 5 style presets (glassmorphism, minimalist, brutalist, retro, editorial), built well enough to improve output before it grows.                                                                                                                                                                                                                            |
| L52  | both, weighted | citeunseen.io is both a contextual suggestion in generated SEO/content advice and a built-in integration wired into generated sites by default, weighted toward the built-in path for ease of use. The one open qualifier this raised, disclosure, is resolved under "Resolved 2026-09-17".                                                                                                                                                  |

### Values set

| Item                           | Value                                                    |
| ------------------------------ | -------------------------------------------------------- |
| Preview idle timeout           | 10 minutes                                               |
| Preview hard lifetime          | 30 minutes                                               |
| Concurrent previews per user   | 1                                                        |
| Concurrent previews, all users | 25, then queued (not rejected)                           |
| Preview domain                 | `vibld-preview.dev`                                      |
| Legal entity                   | Recorded in the site's legal pages                       |
| Public mailing address         | 285 W Wieuca Rd NE STE 62715, Atlanta, GA 30342          |
| Data retention after deletion  | project content 30 days; audit log 12 months, tombstoned |
| Free tier                      | $0 -- $1/mo model spend                                  |
| Build tier                     | $29/mo -- $10/mo model spend                             |
| Ship tier                      | $99/mo -- $40/mo model spend                             |
| Top-up                         | $20 -- $8 model spend, expires 12 months                 |
| GA4 measurement ID             | `G-JCWXRRM8R9` (wired into apps/marketing 2026-09-16)    |

`apps/marketing` now measures page views twice: with its own first-party,
cookieless counter (`apps/marketing/worker/analytics.ts`) and with GA4, loaded
site-wide from `app/root.tsx`. The Cookie Notice, the Privacy Policy and the
Subprocessors page were rewritten in the same change to say what GA4 does (sets
cookies, assigns a client identifier, sends the IP address to Google), because
the Cookie Notice had promised to be updated before anything of that kind
shipped.

GA4 counts client-side navigation through its own Enhanced Measurement ("page
changes based on browser history events", on by default for a web stream), not
through anything in our code. `RouteChangeBeacon` in `app/root.tsx` is for the
first-party counter only: an explicit GA4 `page_view` beside Enhanced
Measurement would record every internal link twice. If that stream setting is
ever turned off, GA4 silently counts only the first view of a visit. Check it
at https://analytics.google.com/analytics/web/#/a/p/admin/streams, under the
web stream's Enhanced measurement.

**Decided 2026-09-16:** a consent banner. GA4 is not loaded at all
until the visitor agrees: no script is requested from Google, so nothing about
a visit reaches them. Consent Mode v2 alone was the first attempt and was
wrong for this site, because under denied consent gtag.js is still fetched and
still sends cookieless pings, which would have made the Cookie Notice's "runs
only if you say yes" untrue. The banner asks on the first visit, and the footer's
"Cookie preferences" link on every page reopens it afterwards. The answer is
kept in `localStorage` (`vibld.consent.analytics`), not in a cookie, so it
never leaves the browser. The first-party counter in `worker/analytics.ts` is
deliberately outside all of it: no cookie, no identifier, no IP address, so
there is nothing to consent to and no reason to make anyone click before a
page works. Rules live in `app/consent.ts`; `app/root.tsx` renders the tag on a grant.
Consent is declared before `config`, because gtag applies the state in force
when a command runs, and the advertising signals are denied in every state.

A withdrawal mid-visit does four things, and each exists because the previous
one was not enough. It denies `analytics_storage`, which stops cookies but not
measurement. It sets `ga-disable-<id>`, Google's own switch, which stops the
loaded tag sending. It expires the `_ga*` cookies, because denying consent
does not remove the client identifier already written and the Cookie Notice
says nothing is stored when the answer is no. Then it reloads, which is the
only way a page can remove a script already in it: this is a single-page app,
internal links never create a new document, so a tag left in place would
otherwise outlive the answer.

**Consent is per origin, so the cookie is made per origin too.** This Worker
serves both `vibld.com` and `www.vibld.com`, and `localStorage` is scoped to
one origin. GA's default is to write `_ga` on `.vibld.com`, which both share,
so the two origins could hold opposite answers over one identifier: denying on
one deleted a cookie the other recreated on its next page view, and deletion
at the moment of denial could not hold. `config` therefore passes
`cookie_domain: 'none'`, which makes the cookie host-only and puts its scope
and the answer's scope in step. Every state that is not a grant also expires the
cookies, including the one where no tag loads at all, because a cookie can
predate the answer: a `_ga` written on `.vibld.com` before this change would
otherwise sit on a denied origin forever, waiting for a later grant to resume
the same identifier. Cleanup follows the answer, never whether a tag happens
to be running.

Two origins serving the same pages is the root of that, and the site already
names `vibld.com` as canonical in its metadata while answering on both. A
redirect would remove the class of problem rather than managing it, and is
a product decision rather than a change to make inside an analytics PR.

**Only production is measured.** `SITE.analyticsHosts` lists the two hostnames
that report to the property. The measurement id is a constant, so before this
the workers.dev preview and `pnpm dev` both fed the production numbers the
moment anyone clicked Allow, which breaks nothing visibly and would have gone
on quietly making the data wrong. Anywhere else loads no analytics and shows
no banner, because a question whose answer cannot change anything is noise.

**The reload is conditional, and the condition matters.** When the store
refuses both the write and the removal of the denial, an older grant survives
in it, and reloading would read that grant and load analytics again: the
withdrawal would turn it back on. In that case the document is kept, the
disable switch and the cookie expiry carry the withdrawal on their own, and
the banner says the setting could not be saved. Anything that removes the
`ga-disable` fallback on the grounds that "withdrawal reloads anyway" breaks
exactly this path.

### Lists confirmed

- **Mailboxes on vibld.com:** support@, privacy@, security@, abuse@, legal@, billing@, hello@
- **Coming-soon page:** wordmark, tagline, one paragraph, waitlist field to a Resend audience, legal footer links, a screenshot/demo clip. No pricing preview yet.
- **Legal pages to draft:** Terms of Service, Privacy Policy, Acceptable Use, Security & Vulnerability Disclosure + `security.txt`, Subprocessors, Cookie Notice, Refund Policy, Open-Source Notices.
- **Paid infrastructure approved:** Workers Paid, Containers, R2, D1, the preview domain, Clerk, Stripe, Resend, Sentry -- all nine lines from L27.
- **Abuse controls required before Access comes off:** Turnstile, per-IP WAF rate limit, disposable-domain blocking, the existing per-user ceiling, a new account-wide ceiling.

### Resolved 2026-09-29 (later)

**Two tabs on one project: the stale one is told and reloads.** Chris
decided on 2026-09-29 (D63). With a project open in two tabs, the last save
won, so the tab left open on an older copy erased the conversation the
other had saved since. Now every save of a project's settings or
conversation names the version it was made from, and one made from a
version that is no longer current is refused with 409 and
`code: "project-changed"`. The refused tab stops saving and shows "This
project changed in another tab" with a Reload button, so nothing is lost
without it being said. The version is a counter on the project's row
(`0036_project_version.sql`) rather than `updated_at`, because two saves can
land in one millisecond and a rename or an archive moves `updated_at` too;
the counter moves only on a save of the settings or the conversation, and a
build, which promotes its revision in `generation_projects`, never moves
it. The builder's own saves already go one at a time; a retry of one that
landed but whose answer was lost is accepted, because the row still names
that page as its last writer. A builder loaded before this sends no version
and wins as before until it reloads.

**Stop charges what the build actually used.** Chris decided on 2026-09-29
(D65), replacing D60's charge of the whole reservation. A stopped build is
charged what its finished model steps cost, plus the step that was running
when Stop landed at the most it could cost, and never more than was
reserved. Each model step records, inside its durable step and before its
call, that it has started and its worst case (its output ceiling and what
is left of the run's input budget, at the run's prices), and afterwards
what it cost, priced as the settle step prices it; the records sit in the
run's `RunProgress` object beside D60's record of where the reservation
is. Stop settles both ledger layers at the sum, each capped at its own
reservation (`UserBudget.reclaim`), and keeps D60's rule that whichever of
Stop and the settle step asks first closes it. Where the record cannot be
read, or a run never kept one, Stop charges the whole reservation, as
before. A repair turn's reservation is left as it was: the repair step
settles it itself at what it measured, and the reclaim is the backstop.

### Resolved 2026-09-29

**Builds are generated in bounded steps, and follow-ups as patches.** Every
build used to ask the model for the whole project in one response, so the
size of the project decided whether a run produced anything: the first full
company site asked of Claude Opus 5.5 wrote for nineteen minutes, stopped at
the model's 128,000-token ceiling as `model-truncated` and was thrown away at
$2.62 (trace `9eb10950`), and a follow-up re-emitted every file to change
one. Chris asked on 2026-09-29 for this to be fixed. A build is now an
outline call (the spec and a manifest of files, no content, at most 16,000
output tokens) and then one call per group of files (shared files first,
each group estimated at no more than 12,000 tokens and given at most 32,000,
seeing the request, the spec, the manifest and the files it depends on).
Each call is its own durable Workflow step, never retried because it is
paid, so a group written before an eviction is not written twice. A group
that runs out of room is split in two and asked again, down to one file; a
single file that still does not fit fails the run with its path named, and
the run is charged for what its calls spent. A follow-up, and a repair turn,
plans only the files to add or replace and the paths to delete, and every
other file carries over from the revision it edits. A first build may plan
up to six routes, which relaxes internal PR 289's "at most two further routes". The
run reserves once for all its calls: the output that the $3.20 reserve buys
(up to 256,000 tokens, where one response was held to the model's maximum)
and four single-call builds' worth of input, and it refuses any call that
would pass either. Every model step renews the reservation before it calls,
so a run longer than the reclaim window is not taken for abandoned. The
request, spec and manifest are marked for Anthropic's prompt cache; OpenAI
and DeepSeek cache the same prefix on their own. `apps/web/README.md`,
"Bounded steps", has the detail.

**A build keeps running when its page goes away, and only Stop cancels it.**
Chris decided on 2026-09-29 (D55): when the builder loses its connection in
the middle of a build, because the phone was locked, the app was switched,
the tab was closed or the page reloaded, the build goes on and saves to the
project, and reopening the project picks the result up. Until then a dropped
connection terminated the build: run 553ea6c7 on project 66163432 was
terminated three and a half minutes in when Chris's phone left the page, its
stage was left at `planning` for good, and the model call in flight was paid
for anyway, because termination lands at the next step boundary. Now a
disconnect stops only the stream. A caller who leaves before the build has
been created still does not start one. Stop calls `DELETE /api/runs/:id`,
which checks the build is the caller's, terminates it and marks it
`cancelled`; if that fails, the builder says so and shows the build as still
running. `GET /api/projects/:id` reports a build still running, and the
builder shows it, polls `GET /api/runs/:id` every 1.5 seconds until it ends,
then loads the new code and settles the turn the page left open as
accepted, failed or cancelled. A page whose stream drops does the same
instead of reporting a failure. A stage the engine left unended is settled
when the build is next asked after or its project opened.

**A build the caller cannot fully fund starts smaller instead of being
refused.** Taken overnight on 2026-09-29 on Chris's behalf, while he was
away, after an end-to-end test found that internal PR 292 had locked every Free account
out of the default model; Chris may reverse it (D59). A build on GPT-6 Sol
reserves about $3.20, the worst case of every call it may make, while a
normal one costs about $0.70, so a Free account's dollar was refused with
`period-ceiling` before anything was spent. Now, when the caller's own ledger
refuses the whole run, `handlePlan` reserves what they have left instead (the
larger of the month's allowance and their top-up credit, since one
reservation is drawn from one of them, never both) and tells the Workflow
the smaller output and input budgets, so the run still cannot spend past
what it holds and fails with the file it reached named if it runs out. The
floor is one outline call and one group call at the ceilings each call is
already held to (16,000 and 32,000 output tokens, clamped per model by
`callCeilingFor`) and two single-call builds' worth of input
(`BUILD_INPUT_CHARS` per call): about $0.80 on Sol. Below it the build is
refused. Between the floor and the full size, the output and input budgets
grow by the same share of the distance. A refusal by the deployment's daily
ceiling is never fitted to and stands as it is. Chat turns and mockups keep
their one reservation: a chat turn never builds, and the brief it returns is
built through `/api/plan`, which does the fitting.

**Stop closes the build's reservation at once, at what the reclaim would
have charged.** Taken overnight on 2026-09-29 on Chris's behalf; Chris may
reverse it (D60). Stop terminates the Workflow before its settle step, so a
stopped build's reservation stayed open until the ledger reclaimed it about
thirty-five minutes later, holding an in-flight slot all that time: with two
runs allowed in flight, two Stops refused the next build with "A generation
is already running". Stop now closes both layers itself, the caller's and
the deployment's, and charges each exactly what the reclaim charges, the
whole amount reserved (`UserBudget.reclaim`, the reclaim's own statement for
one row), so only the timing changes. Where the reservation is gets recorded
against the run id in the run's own `RunProgress` object, one small row and
no migration; whichever of Stop and the Workflow's settle step asks first
closes it, and the other leaves it alone. A stopped build is therefore still
charged its full reservation, as it was before this: charging only what its
finished steps measured would be cheaper for the caller, and is Chris's
decision to make.

**A money refusal says which ceiling refused, and how much is left.** Taken
overnight on 2026-09-29 on Chris's behalf; Chris may reverse it (D61). "This
month's generation budget is used up" was shown to callers whose allowance
was not used up, only smaller than one run's worst case, and for the
deployment's daily ceiling, which is not theirs at all. The caller's own
ceiling now says how much the allowance (and any top-up credit) has left,
how much the build, the three directions or the chat reply needs set aside,
and to choose a cheaper model or buy a top-up. The daily ceiling says
Vibld has reached its spending limit for today and that generations resume
after midnight UTC. Both keep the `account-ceiling` reason, because the
client does nothing with it but show the sentence; no code was added.

**A build settled by asking keeps its summary.** Taken overnight on
2026-09-29 on Chris's behalf; Chris may reverse it (D62). A turn the builder
settled by polling `GET /api/runs/:id`, after a dropped stream or a reopened
project, showed only its file count and revision, and the chat context told
the agent "Built it (9 files)", because the Worker never stored the build's
summary. The route now returns it for an accepted build, read from the
Workflow instance's own result where that result is the accepted revision,
and the builder puts it on the turn as the stream would have. Nothing new is
stored: once the engine no longer keeps the instance, a build asked after
has no summary, as before.

**Published sites send safe default headers, and nothing that restricts
what they load.** Chris decided on 2026-09-29 (D64): "Safe defaults". Sites
at `<slug>.vibld-preview.dev`, the examples among them, were served with no
security headers at all. Every response apps/publish gives, 404s and media
included, now carries `Strict-Transport-Security: max-age=31536000`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin` and a `Permissions-Policy` denying camera,
microphone, geolocation, payment, USB, serial, HID, Bluetooth, MIDI and
display capture (`PUBLISHED_SITE_HEADERS` in `@vibld/security-headers`, its
own set rather than the one vibld.com and app.vibld.com send). There is no
CSP and no `X-Frame-Options` or `frame-ancestors`, so a site's embeds,
fonts, iframes and third-party scripts keep working and anybody may frame
it; features embeds delegate to their frames (autoplay, fullscreen,
encrypted media, picture-in-picture, clipboard write, web share, motion
sensors, XR) are left alone. HSTS has no `includeSubDomains`: from a slug's
host it would cover only hosts two labels deep, which have no certificate
and serve nothing. A header a response already carries is kept rather than
replaced; nothing a site ships can set one today, since there is no
`_headers` convention for published sites. `payment=()` hides an in-page
wallet button (Apple Pay, Google Pay) in an embedded checkout; a link out
to a hosted checkout is unaffected.

**Free accounts build with GPT-6 Luna only.** Chris decided on 2026-09-29
(D66): a Free account builds, chats and mocks up with `gpt-6-luna` and
nothing else, and the paid tiers keep every model they had. The limit is
`TIER_MODELS` in `apps/web/worker/model-access.ts`, in code rather than in
`VIBLD_MODEL_POLICY`, applied after the policy, so the policy can narrow a
Free account but not widen it. `/api/plan`, `/api/mockups` and `/api/chat`
refuse a model the plan does not include with 403 `model-not-allowed` and
the sentence the builder shows, "Free builds use GPT-6 Luna. Paid plans
unlock the other models."; a Free request naming no model runs on Luna, not
on the deployment's `gpt-6-sol`. `/api/config` offers Luna alone, so a
choice the browser remembers, such as Sol, is neither shown nor sent, and
is kept for when the plan includes it again. A Free build's draft is drawn
on Luna: DeepSeek Flash is not the plan's to use, and the draft already
falls back to the build's model where Flash is withheld. On a deployment
with billing not configured nobody is held to a plan, since none can be
bought; that part was decided while implementing, and Chris may reverse it.

**The production end-to-end run makes its own account.** Chris decided on
2026-09-29 (D67): "Create it via Clerk API". The live Clerk instance had no
test account, and the journey must never run as a real person's. With no
`test_user`, `e2e-production.yml` creates a passwordless user through the
Backend API on an `e2e-throwaway-*@vibld.com` address nothing is sent to,
marked in private metadata (`vibldE2eThrowaway`), signs in as it with a
sign-in token, and deletes it from Clerk as its last step, after its
projects are deleted and its spend is read. Only a user carrying the mark
is ever deleted; one a run died before deleting is deleted by the next run
once it is two hours old. The account's usage rows in D1 stay, since they
record money that was spent. Naming an existing account with `test_user`
still works.

**A rate-limited read is waited out, and the edge rule is loosened.**
Chris decided on 2026-09-29 (D68): "Loosen it + client retry". The
production end-to-end run (36591020730) found a Cloudflare rate-limiting
rule on app.vibld.com, with a ten second window, that one builder load
from one address trips: access, config, billing and the project list are
asked for at once, Cloudflare answers 429 with its own HTML page, and the
builder showed "Could not reach your projects", the banner Chris saw on
the North Star project. Chris raises the rule to 120 requests per ten
seconds per address on `/api/*` in the dashboard. The builder wraps its
`fetch` once at start (`src/net/rate-limit-retry.ts`): a GET or HEAD to
this origin's `/api/` that answers 429 is retried up to three times,
waiting what `Retry-After` asks or a doubling second, never more than ten
seconds. Writes are never retried, since one that was refused could land
twice.

### Resolved 2026-09-28

**The legal pages carry Chris's decisions for the open paid beta.** Chris
decided on 2026-09-28: users must be 18, or the age of majority where they
live if higher; total liability is capped at the greater of what the user
paid in the 12 months before the claim and US$100; users indemnify Chris
Brock LLC against third-party claims arising from what they build, upload
or publish and from their breach of the Terms or the Acceptable Use Policy;
disputes go to the courts under Georgia law with Gwinnett County venue, with
no arbitration and no class-action waiver; a material change to the Terms
is emailed 14 days before it takes effect, and a price change applies from
the next renewal, never to a period already paid for; unused credit and
allowance, paid, free or referral, are forfeited without refund when an
account is closed or deleted; the remainder of a paid month is not refunded;
privacy requests are answered within 30 days. The Acceptable Use Policy adds
phishing and impersonation, malware, fraud and scams, selling illegal goods
or services, copyright and trademark infringement, and sexually explicit
material to what a published site may not contain, and it covers the hosted
service at vibld.com and app.vibld.com and the sites published through it,
not anyone running the open-source code themselves. Every legal page reads
one effective date, `SITE.legalEffectiveDate` in `apps/marketing/app/site.ts`,
which is set to the launch day in the launch deploy. The remaining
`[CHRIS: ...]` placeholders on those pages are still open.

**The legal pages carry Chris's second set of legal choices.** Chris decided
on 2026-09-28: anyone anywhere can sign up, and the access, correction and
deletion rights (answered within 30 days) are everyone's, with no
compliance certification claimed; there is no SLA, the beta is provided as
is with reasonable efforts to keep it up, and significant outages are posted
on the website; an account is suspended or closed for breach of the Terms or
the Acceptable Use Policy after an email and 14 days to export projects,
except that serious or illegal abuse is acted on at once, with no refund
when the Terms were broken and a prorated refund of the unused paid period
otherwise; appeals go to the abuse address, naming the site or account, and
a person replies within 14 days; annual plans can be cancelled at any time
for a prorated refund of the unused whole months, cancelling in the billing
portal takes effect at the end of the paid period (set in Stripe), and
top-ups are never refunded; a refund or a lost dispute removes the credit,
allowance or plan that payment bought, automatically, and a lost dispute
lets vibld suspend the account until it is resolved; the waitlist is kept
for occasional product news until the person unsubscribes, account holders
may get product news with an unsubscribe link, and service, billing and
security email is sent regardless; billing records are kept as long as tax
and accounting law requires; users keep ownership of their content and
license Chris Brock LLC only to host, store, process, build, preview and
publish it and send it to their chosen model provider, to run the Service
for them, until it is deleted; and the default model at launch is OpenAI's
GPT-6 Sol (the code change that makes it the default is pending). Chris
then decided: Google Analytics 4 stays, loaded only with consent, and he
turns off Google Signals, Google Ads links and GA data sharing in the GA
admin himself, so the Privacy Policy says vibld does not sell personal
information or share it for cross-context behavioural advertising;
DeepSeek stays, disclosed as it is with no opt-out (data stored in China,
de-identified inputs and outputs usable to improve its services, no
published API retention period); annual refunds are requested by email to
the billing address, and cancelling in the portal alone stops renewal with
no refund; and Resend sends both the waitlist email and product news to
account holders. Data is disclosed beyond the subprocessors only with the
person's consent or at their request, when the law requires it, to protect
people or the Service, or in a sale or reorganisation. Placeholders still
open: the DMCA agent registration number. Cloudflare Workflows keeps a
finished run for 30 days (Chris, from the account's Workflows settings).

**Referral links land on vibld.com.** Chris chose on 2026-09-28 that a
shared link is `https://vibld.com/?ref=<code>`, so a friend sees the site
before signing up; the site carries the code to sign-up and the builder
claims it. He also chose to keep every account that already had a Stripe
customer before the barrier fix counted as having started a purchase, so
no existing account's referral eligibility changes, and approved the Cookie
Notice paragraph about the referral code in session storage.

**The builder's composer is a message box and one row of options.** Chris
chose this on 2026-09-28, after finding the builder cluttered: every option
was on screen at once. The message and the send button stay put; style,
reference URL, media and preferences (project instructions and visual
preferences together) are each a button that opens its panel in place, with
one line on what it changes about the result, and a set option says so on
its button. The model is one dropdown beside the send button, grouped by
family, with no description under it. "Force a validation failure" is
offered only against the deterministic provider. The Preview pane's
"Run in sandbox" is now "Run live preview", in the middle of the pane.

**The agent decides whether to answer or build.** Chris decided on
2026-09-28: the builder has one chat box, and for each message the agent
either replies in words and changes nothing, or returns a self-contained
build brief that the client submits through `/api/plan` exactly as a typed
prompt. Before the first build it may ask one or two clarifying questions,
and an answer such as "yes" is turned into the full instruction agreed in
the conversation rather than sent on as the word. `POST /api/chat`
(`apps/web/worker/chat-handler.ts`) makes that decision, behind the same
invite gate, model policy, rate limiters and reservation as `/api/mockups`,
and is charged the same way.

**L32 is implemented: an account can delete itself, and is purged 30 days
later.** Chris decided on 2026-09-27 to build it before the open beta. The
builder's settings menu has "Delete account", confirmed in the page by
typing a phrase, and `POST /api/account/delete` is open to any signed-in
account, invited or not. From the request on, every other authenticated
request from the account is refused with `deletion-scheduled`; its
subscription is cancelled at once with no proration, its preview stopped,
its published site taken down by the owner's own takedown, its GitHub grant
revoked and its unpaid referral rewards reversed, each retried by the
person and by the nightly pass until it has happened. Thirty days later the
nightly pass, inside the same D1 allowance as the billing pass, deletes the
project content (L32's promise), the account's other rows, its stored
files, its spend ledgers and its Clerk user. Where this departs from the
brief, or reads L32 in a particular way: there was no audit log to keep, so
the deletion record itself is the audit record: it is re-keyed to a random
tombstone at the purge and deleted 12 months later. The billing, payment,
credit and referral rows are kept under the same tombstone rather than
deleted, because they are accounting records; none holds an email address,
and parked Stripe payloads lose theirs. The nightly pass never takes a site
down (ADR-0013), so a site still serving holds the purge until the owner or
an operator takes it down. The purge takes a turn in the nightly rotation
only on a night with deletion work waiting, so the billing phases keep
their lap of three otherwise, and from an allowance of 122 it has a quarter
of its own instead. Not purged: the preview sandbox's Durable Object keeps
its record of issued share links and the id of the account whose media it
last served, since apps/preview has no route to forget them. The account
can be kept, from the screen it sees on signing in, until the purge starts.
Chris confirmed on 2026-09-28 that a subscription is cancelled with no
refund of the paid period, and that a referrer's deletion also cancels the
referred account's unpaid reward, which an operator can grant back by hand.
See `apps/web/README.md`, "Account deletion".

**A refunded or disputed payment loses what it bought, automatically.**
Chris decided on 2026-09-28 to automate this before launch, and the refund
policy will say so. A refunded top-up loses the refunded share of its
credit, floored at what is still unspent, with the rest recorded as a
shortfall and never collected. A refunded subscription payment ends the
subscription at once, in D1 and in Stripe, with no further proration; a
partial refund is treated the same way, because it is how an operator
processes an annual plan's prorated cancellation. A lost dispute does the
same for whatever the payment bought and also suspends the account's paid
features, refused as `account-suspended`, until an operator lifts it from
the admin panel. A won or withdrawn dispute removes nothing. Every effect
is a row in `billing_clawbacks`, shown against the account in the admin
panel, and a reversal that cannot be tied to a recorded payment is parked
like an unattributed payment rather than guessed at. His other refund
decisions: monthly plans are not refunded; annual plans can be cancelled at
any time for a prorated refund of unused whole months, which an operator
issues as a partial refund in Stripe; top-ups are never refunded; and
cancelling from the billing portal takes effect at the end of the paid
period. See `apps/web/README.md`, "Refunds and disputes".

**Cancelling a monthly plan offers 50% off one month, once; an annual plan
is offered nothing.** Chris decided this on 2026-09-28. Stripe keeps each
tier's monthly and annual prices on the same product, so the coupon
(`vibld-retention-50-1mo`, 50% off, duration once) cannot be limited to
the monthly price by product and applies to any product. The offer is
instead made only through vibld's own cancel flow (the builder's "Cancel
plan" button and `POST /api/billing/cancel` behind it), which attaches it
only when the subscription's price is `vibld_build_monthly` or
`vibld_ship_monthly` and bills by the month. The Stripe portal's own
retention setting stays empty, since it would offer the coupon to annual
plans too. See `apps/web/README.md`, "Billing".

**An account has projects, and each one remembers everything.** Chris
decided on 2026-09-28, after a refresh of the builder lost what he was
building, that the first version of projects has autosave, a list of
projects, reopening one, renaming, archiving (hiding a paused project
without deleting it), deleting (permanent, after a confirmation) and
duplicating one into a new project; a version history screen is not part of
it, and every revision is still kept as before. A free account may have
three active projects and any number of archived ones, and the Build and
Ship plans have no limit; creating, duplicating or unarchiving past the
limit is refused with the reason and a way to upgrade. A project remembers
its code (the accepted snapshot), the whole conversation with the agent,
its style preset, reference page and model, and its media, and opening it
restores all of it. Sharing a project and copying one into another account
come separately and later. Each account's one existing project became its
first project, named "Untitled project". Where the implementation reads
this in a particular way, not yet confirmed by Chris: the media library,
the published site, the preview sandbox and the GitHub connection stay one
per account, so a project's media is the account's library and publishing
from any project replaces the account's one site; and a project also
remembers its standing instructions and visual preferences. See
`apps/web/README.md`, "Projects".

**A project can be shared by link and remixed, publishes to a site of its
own, and keeps using the account's one media library.** Chris decided on
2026-09-28 that an owner can turn on an unlisted link for a project and turn
it off again, which kills that link; anybody with the link sees the
project's live preview and its code, read-only; and somebody signed in can
remix it, copying its accepted code and settings into a new project in
their own account, held to the free tier's limit. The link carries an
unguessable token, never the project id, and reveals nothing about the
owner beyond what they chose to share. The public view is rate-limited, and
the operator's takedown and hold can stop a link as they stop a site;
deleting or archiving the project, deleting the account and a suspension
all stop it too. He also decided that each project publishes to its own
`<slug>.vibld-preview.dev` site: existing sites stay at their addresses as
the site of the project each account already had, deleting a project takes
its site down and deleting the account takes all of them down, publishing
one project never replaces another's site, and slugs stay unique across
every site. And the media library stays one per account: a remix into
another account copies the media its code uses into the remixer's library,
so it depends on nothing of the original owner's, and duplicating within an
account copies nothing. Chris then decided, the same day, that only a
signed-in viewer can start a link's live preview: anybody may still see
the project's name and code without signing in, and somebody signed out is
offered "Sign in to run the live preview" in place of the button, which
signs them in and then starts it; each start is counted against the
account as well as the address. Where the implementation reads this in a
particular way, not yet confirmed by Chris: the live preview runs in one
sandbox per link, started when a signed-in viewer asks and shown to every
viewer of that link, signed in or not, rather than a sandbox per viewer or
a static render (a generated project is a Vite and React app that shows
nothing until it runs); starting it needs an account but not an invite, and
is refused to an account that is suspended or leaving; a remix does not
copy the conversation, which the link never showed; a remix is named
"Remix of" the original; an archived project's link comes back when it is
unarchived; a media file whose name the remixer already uses for different
bytes is copied under a free name and the remix's code rewritten to match,
and a remix whose media does not fit is refused whole; a project whose site
is still serving is not deleted until the takedown succeeds; and a site that
had no project gets one, so its owner can reach it. See `apps/web/README.md`,
"Projects" and "Cloudflare auto-publish".

**While a build runs, the preview shows a draft of the page.** Chris decided
on 2026-09-28 that the preview pane shows a static draft of the page while a
build runs, instead of an empty or waiting state, labelled "Draft, building
the real site" with the build's stage and progress over it: the mockup
picked in Explore when there is one, and otherwise one quick mockup asked
for when the build starts, accepting roughly 20 seconds and a few cents a
build. The quick mockup is metered as mockups are, runs beside the build and
never delays or blocks it, and is skipped if it fails or the build finishes
first. The draft renders in a sandboxed frame, is never saved in the
project, and gives way to the live preview once the build is accepted and
the live preview is running. A follow-up on a project with an accepted
checkpoint keeps its current preview or code and asks for no mockup. Where
the implementation reads this in a particular way, not yet confirmed by
Chris: the quick mockup is a one-direction request to `/api/mockups`
(`"draft": true`) with the same ceiling, reservation, settlement and rate
limit bucket as a three-direction look, in the build's chosen style but
always on DeepSeek Flash where the policy allows it (Chris, 2026-09-28: a
draft is a placeholder, a cent or two there against ten times that on the
default model), falling back to the build's model otherwise; it is asked for once the Worker has admitted the build, not at the
moment of submitting, so it cannot take the in-flight slot the build
needed; between the build being accepted and the live preview running the
pane keeps the draft, relabelled "Draft, the real site is built", with
"Run live preview" or the sandbox's status over it, and does not return to
it once the live preview has run; a failed or cancelled build drops the
draft; "a follow-up" means any build once there is an accepted checkpoint,
so a project whose earlier builds all failed still gets a draft, and a
direction picked from Explore is not shown over an accepted project either;
a failed quick mockup is not reported anywhere; and a deployment without
model generation asks for none. See `apps/web/README.md`, "The draft
preview".

### Resolved 2026-09-27

**L15 stands: Stripe Tax is off, and the code now matches.** Chris confirmed
tax off on 2026-09-27. Checkout had been creating plan and top-up sessions
with `automatic_tax` on, contrary to L15. It no longer does, and no session
collects a tax id or a billing address for tax; the card-setup session never
did. `apps/web/test/billing-checkout.test.ts` holds every checkout path to
that.

**Referrals ship at launch, with a screen.** Chris decided on 2026-09-27 that
the referral program launches with the open beta rather than existing only
as an API. The builder's settings menu has **Refer a friend** under **Plan and
usage**: the link, a Copy button, what both sides get and progress, all from
`/api/referral/status`. A `?ref=` link to vibld.com or the builder is kept
through sign-up and claimed once the account exists, and every refusal is
silent. The terms are unchanged from 2026-09-16: $5 to each side on the
referred account's first cleared payment, 25 paid referrals per referrer,
no self-referral, first attribution fixed, and none once a purchase has
started. Saving a card for the welcome credit no longer counts as starting
a purchase (`0030_purchase_starts.sql`), since it would otherwise have
blocked every account that took the dollar. See `apps/web/README.md`,
"Referrals".

**Roadmap additions.** Chris added, on 2026-09-27: Figma import (out of the
deferred list), screenshot and image import, existing GitHub repository
import, a starter template gallery, custom domains for published sites,
authentication, forms and email capture, payments and editable content for
generated apps, a checkpoint history with one-step rollback, bring your own
model key, comments on shared previews, and a command-line sync.
`ROADMAP.md` places each one; none of them is scheduled.

**vibld launches as an open paid beta.** Chris decided on 2026-09-27:
anybody can sign up, with no invite. This replaces L6's Clerk waitlist mode
and the invite list as the launch shape once it is switched on, and nothing
in the repository switches it on. Opening is `VIBLD_ACCESS_MODE=open` on the
`preview` environment and Clerk's sign-up mode set to Public, then a deploy,
which Chris does himself after a live billing check. The steps are in
`apps/web/README.md`, "Opening the beta". Until then the gate stays
invite-only by default, and `apps/web/test/open-beta-gate.test.ts` fails if
the Worker config or the deploy workflow's default opens it. The invite list
and the admin panel stay, for a deployment that closes again.

**The welcome credit waits for a card.** Chris chose card first on
2026-09-27. The $1.00 a new account used to get on its first request is now
granted only once the account has a card on file, saved through a Stripe
Checkout Session in `setup` mode that charges nothing. It is paid on the
Stripe webhook (`checkout.session.completed` in setup mode, or
`setup_intent.succeeded`), once per account and once per card by the card's
Stripe `fingerprint`, enforced by unique indexes in
`0029_card_first_signup_credit.sql` and idempotent on the SetupIntent. The
cohort cutoff (`VIBLD_SIGNUP_CREDIT_FROM`) still decides who is new.
Accounts that already received their dollar keep it and are not paid again.
A deployment with no Stripe offers the credit to nobody.

**vibld.com says "Public beta" and links to sign-up.** Chris decided on
2026-09-27 that the site moves from invite-only and the waitlist to the open
beta. Every "Join the waitlist" call to action links to the builder's
sign-up form (`https://app.vibld.com/sign-up`), and the waitlist form is gone
from the site. The waitlist endpoint and the addresses in the Resend segment
stay, since they are who the one launch email (`docs/launch-email.md`) goes
to. The legal pages were not rewritten: the sentences the open beta makes
inaccurate were listed for Chris to decide on.

**The nightly billing pass rotates when its query budget is too small to
split (internal issue 176).** Chris chose option 1, rotate, on 2026-09-27, in this form:
the parked queue keeps its floor every night, and payout, reconcile and
replay take the rest in turn, in that order. It applies below the allowance
where a four-way split buys every phase an item (92). The turn is a counter
in D1 (`0028_nightly_rotation.sql`). Below 35 the floor would starve the
reconcile, so there all four phases rotate instead (below 24 nothing can buy
a subscription at all). The default stays 40,
safe on Workers Free. At 92 and above, including the deployed 500, the pass
is unchanged.

**The bakeoff counts a failed build as a rejection, and reports a figure
after one repair.** Chris decided on 2026-09-27, after a three-run bakeoff of
`vibld-marketing` scored models on "accepted" when accepted projects were never
required to build: GPT-6 Sol had 2/3 accepted and only one of them built, and
DeepSeek V4 Pro's one accepted run did not build. A project is now accepted
only if it passes the eval's checks and `npm install` and `npm run build`
succeed. Each model gets two figures: accepted as generated, and accepted after
one repair turn, the product's own repair (`repairPromptFor`, now shared from
`@vibld/ai`) sent the exact build error. Cost includes the repair. The same
bakeoff lost one run per model to the `portable` check on pages that made the
claim in other words, so that expectation now accepts any of a list of
wordings, and the prompt set is 1.8.0. The keyed and keyless jobs stay
separate: model-written code only runs in a job with no secrets. See
`packages/eval/README.md`.

**L9 -- previews and builds share the container budget (internal issue 197).** Since internal PR 196, builds run in the same container class as previews, whose `max_instances` is 25, and the budget was split statically: 20 for previews and 5 for builds, so the 21st preview queued even when nothing was building. Chris chose the shared budget: previews and builds count against one budget of 25, with builds bounded at 5 of it. Previews get all 25 whenever nothing is building, and a preview queues behind a build only when every container is taken. L9 holds again and its wording is unchanged; `max_instances` is unchanged. See `apps/preview/worker/capacity.ts`.

### Resolved 2026-09-19

**An invite also approves the account in Clerk.** One gate, not two: an
address the operator invites is admitted to Clerk in the same action, rather
than waiting on a second manual approval. Asked and settled because Clerk
runs in Waitlist mode (L5, L6), so an invite row alone lets somebody past
this deployment's access gate and still leaves them unable to create a
session, which made issuing an invite half an action.

Already the shipped behaviour, which is why this changed no code:
`handleInviteCreate` is the only path that creates or reinstates an invite
and it calls `admitToClerk` unconditionally, on every submission rather than
only when the row changed, so it doubles as the retry path for an address
whose first attempt ran with no key configured. Its outcome is carried in
the response rather than thrown, because a deployment with no
`CLERK_SECRET_KEY` is a supported shape and the invite is this deployment's
own record.

**citeunseen.io (L52) is deferred past launch.** Not part of the launch bar.
Unblocked since 2026-09-17 and still unbuilt; nothing else depends on it.

**The analysis in internal PR 157 is not merged.** The PR is closed. What it
recommended survives as internal issue 158 to internal issue 162, of which internal issue 162 shipped as ADR-0013;
recommendations 6 to 9 had no issue and are not carried forward.

**Two of six generated projects did not compile.** Measured against the
production provider on 2026-09-19, for two unrelated reasons, with the same
prompt passing on one run and failing on another. A preview now runs the
project's own `npm run typecheck` in the container it has already started
and reports what it printed. The remaining exits, export and a run nobody
previews, are covered by building the project before the plan is accepted
and giving the model one repair turn when that build fails -- accepted
deliberately as a container start and an install on every generation, plus a
second generation's tokens only on the runs that need them.

### Resolved 2026-09-18

**Security response headers on both hostnames.** Checked against the live
origins: `vibld.com` and `app.vibld.com` were sending none of HSTS,
`X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors` or
`Permissions-Policy`. Both now send one set, from `@vibld/security-headers`.

Two mechanisms, because Cloudflare gives no choice: a `_headers` file applies
only to responses the static asset store serves and never to a response a
Worker generated. `app.vibld.com` runs its Worker first on `/api/*` alone, so
its shell ships `apps/web/public/_headers` (generated from the same object,
with a test that fails on drift) and its Worker wraps its own responses.
`vibld.com` runs its Worker first on everything, for the www redirect
(L21), so the file would cover nothing there and the Worker wraps all of it.

Two deliberate omissions, each with a condition for revisiting:

- **No `includeSubDomains` or `preload` on HSTS.** Both are close to
  irreversible, and would be a promise made on behalf of subdomains nobody
  has created yet. The two hostnames that exist each send the header for
  themselves.
- **No script-restricting CSP.** The policy carries `frame-ancestors 'none'`
  and nothing more. The marketing build emits a per-page inline hydration
  script, so `script-src` there needs a nonce or a per-build hash set, and a
  wrong one is a blank site; the app shell loads Clerk, whose hosted
  components inject at sign-in, so nothing short of a live sign-in shows
  whether a policy holds. Shipping an unverified policy to the two production
  hostnames risks a white screen nobody can reproduce. Revisit when a
  browser that can drive a real sign-in is available to check it.

### Resolved 2026-09-17

**L52 -- citeunseen.io: on by default, and said out loud.** The framing
recommended on 2026-09-09 is accepted, which closes the last open qualifier on
the pattern catalogue and unblocks step 3 of its build order. Wire it into
generated sites by default, say so plainly at generation time ("this project
includes citeunseen.io for AEO, remove it any time"), and emit it as ordinary
removable code in the project. It must not become a Vibld-runtime dependency:
D21 and ADR-0002 require the generated app to keep working with nothing
Vibld-specific present, so a project with the integration deleted has to
install, build and run exactly as it did before.

The cost of this choice, recorded because it is the part that will be argued
later: a user who never reads the disclosure still ships a third-party script
they did not ask for by name. On-by-default was weighted for ease of use, and
the disclosure plus removability is what pays for it.

**ADR-0011, ADR-0012 and ADR-0013 accepted.** Capability manifests
(refines D14-D16), served agent instructions (refines ADR-0002 and ADR-0009),
and preview versus publish (refines ADR-0006 and ADR-0010, and sets the rules
D22's publishing milestone is built against). None of the three is
implemented. Accepting them is what the work gets built against, not a claim
that it exists: ADR-0011 has no enforcement point until a run takes a scoped
action, ADR-0012 should not be built until an instruction set exists to
serve, and ADR-0013's rules are free today and stop being free the first time
a run can be triggered by an event.

**Cache-read and cache-write ratios: live, and not yet verified.** The ledger
prices a cached read at a tenth of a model's input rate at all three
providers, an Anthropic five-minute cache write at 1.25 times it, and charges
no write premium for OpenAI or DeepSeek, which cache automatically. These are
the published ratios as I understood them and were not checkable from the
working environment. They decide what every run takes out of a user's
allowance, so they are recorded here as an open verification rather than as a
settled fact: confirm them against each provider's current pricing, and
correct `PROVIDER_CACHE_RATES` if any is wrong. `CATALOGUE_VERIFIED_ON` and
its test re-raise this in 180 days if nothing else does.

**Four outcomes a run can have: ask, retain, apply, discard.** One of them per
run, and the set is closed. A run that stopped because only the person can
answer something and a run that finished and wants review are different
objects: both end without applying anything, and before this they were the
same `state: 'failed'` with a sentence attached. Asking ends the invocation.
There is no paused run to resume: answering starts a continuation, a new run
carrying the work the first one held plus the answer, and answering is not by
itself an acceptance. Retaining work for review does not ask a question.

Built now rather than when M2's conversational editing needs it, which was a
deliberate call against the recommendation to wait: the cost is that the first
real consumer will reshape it, and the reason is that a vaguer model would be
load-bearing by then. The vocabulary lives in `packages/core`
(`run-disposition.ts`, `continuation.ts`) with no store, no route and no UI
behind it, because nothing can ask a question yet: the model returns a plan.
The one adapter, `settledOutcome`, refuses to infer an `ask` from a finished
run rather than inventing the question's text.

Two stops join the vocabulary with it: `awaiting-answer` and `retained`.
Neither is retryable, which is the point. The same prompt asks the same
question, so the move is to answer it, and retained work is finished and
sitting there, so re-running replaces it.

Refines D11 and sits beside D12. Internal issue 158.

### Resolved 2026-09-27

**Brand: "Signal" replaces "Offset", on both sites.** Chris chose the Live
Build direction for vibld.com and asked for its colours everywhere rather than
on the marketing site alone: vermilion (`#ff4a1c`) on graphite and chalk,
replacing coral and ultramarine on newsprint. The chevron and its
out-of-register second impression stay; only the inks change, so BRAND-01's
entity signal (one mark, one colour, on every surface) survives the change of
colour. `packages/brand` is still the one place a colour is decided, and
`docs/brand.md` carries the recomputed contrast figures.

**Fonts: self-hosted.** Bricolage Grotesque, Hanken Grotesk and JetBrains Mono
are served from vibld.com's own origin rather than from a font service, so the
Cookie Notice's list of third parties does not grow.

**The public repository follows this one.** github.com/vibld/vibld is written
from this repository after every merge to main
(`.github/workflows/public-export.yml`), not developed in separately. A
public pull request is reviewed there and landed here, keeping its author as
co-author; the export brings it back. Public Dependabot version updates are
off (the config is not exported), since they could only merge by diverging.
References to this repository's issues and pull requests read "internal issue
N" and "internal PR N" in the public copy, in prose and comments only.

**Code of conduct: our own.** Written for this project rather than adopted,
with reports to hello@vibld.com (`CODE_OF_CONDUCT.md`).

### Resolved 2026-09-16

**Referral reward: credit to both sides, paid on the referred account's first
purchase.** Not on signup. Nothing pays out until a card clears, which funds
the reward from revenue and removes almost all of the abuse exposure: a
signup-triggered payout on a product that hands out model spend is a faucet,
and self-referral with disposable addresses costs real money. The cost of this
choice is a weaker incentive, because the sharer waits and most referred
signups never convert. Both sides earn so that the person clicking the link
has a reason to prefer it over signing up directly.

**Guides: two separate tracks, hosted and self-hosted.** Each readable start
to finish without asides. Chosen over one set with callouts, knowing
it roughly doubles the writing and that the two will drift unless something
enforces parity. Whatever is built should make drift visible rather than rely
on remembering, the same way the prerender tests hold the legal copy to the
code.

**Logo: the V chevron and the orange survive; the builder comes to them.**
vibld.com and app.vibld.com were shipping different marks, which is precisely
what BRAND-01 forbids: the marketing site an orange chevron on near-black
(`oklch(0.68 0.19 45)`), the builder a tilde in a purple-to-blue gradient
(hue 262 to 212). The public mark wins because it is the indexed one: favicon,
apple-touch-icon, OG image and every share already carry it, and BRAND-01
exists to consolidate the search entity rather than restart it. The builder's
purple accent is therefore rebuilt around the orange.

**Wordmark: lowercase `vibld` everywhere.** The header said `vibld` while the
metadata, schema.org Organization name, title tags and legal copy all said
`Vibld`. Lowercase wins, so `SITE.name`, page titles, OG metadata, the schema
and the legal documents change to match. Sentence-initial uses will read
oddly; that is the known cost of the choice rather than a reason to make
exceptions, and exceptions are what produced the inconsistency in the first
place.

**Connector menu: a framework, not a settings page.** Chosen with
the reservation stated: a framework built before its second real member
usually fits only its first, and GitHub is currently the only integration with
an auth flow. Recorded so the next reader knows it was a decision taken with
that risk in view rather than an oversight.

**Referral clawback: deduct on a refund or dispute, floored at zero.** The $5
comes back off the referrer's balance when the payment that earned it is
refunded or disputed. If they have already spent it the balance stops at zero
rather than going negative, so the loss is capped at what they took and
nobody is shown a debt this product has no way to collect. The cost is that a
referrer who spends the credit immediately keeps it, which is the deliberate
half of the choice: recovering that dollar is worth less than never telling
somebody they owe money.

**Revoking an invite cancels a live subscription at period end.** Today
revoking closes the door and leaves Stripe billing, so somebody can be
charged for a month they cannot sign in to. Cancelling at period end is the
only option that is wrong in neither direction: they keep what they already
paid for, nothing is charged for time they cannot use, and there is no refund
to process. Reinstating before the period ends puts it back, and that is a
path that had to be built rather than a property of the flag: the first
version of this scheduled the cancellation and nothing ever cleared it, so
re-inviting somebody restored their access and Stripe ended their
subscription anyway. Restoring only ever clears a cancellation this
deployment made, so a subscriber who cancelled for themselves keeps their
cancellation.

**The parked-payment queue: attribute, or dismiss as never ours.** An admin
can apply a parked payment to an account by email, which pays out any referral
it earns, or mark it permanently unattributable (a test payment, a deleted
account). Both, rather than attribution alone, because a row that can never
resolve is otherwise retried every night for ever with no way to end it.

**www.vibld.com redirects to the apex, permanently.** One canonical hostname.
Both hostnames were serving the site, which splits what the canonical tags
were written to consolidate, and BRAND-01's whole premise is that this name
needs one unambiguous entity rather than two.

This one has a cost worth recording, because it is not obvious from the
result. The marketing Worker ran on `/api/*` only, and every page came
straight from the asset store without invoking it. A redirect can only be
issued by something the request reaches, and Cloudflare's `_redirects` file
cannot do domain-level redirects at all (documented, and documented again as
never applying to Worker-served requests). A second Worker bound to www alone
would have kept the apex free of invocations, but a custom domain belongs to
one Worker at a time, so moving it is a step no unattended CI deploy can
take. So `run_worker_first` is now `true` and every request to this site,
assets included, runs the Worker. At this site's size that is a rounding
error against the Workers Paid allowance; at a much larger one it would be
worth revisiting with a zone-level redirect rule, which needs an API token
this deployment does not have.

### Resolved 2026-09-09

**L8 -- preview domain.** `vibld-preview.dev` is purchased and registered on Cloudflare (2026-09-09). Binding the domain is a `custom_domain` route in `wrangler.jsonc`, the same mechanism already used for `vibld.com` -- that lands when the preview Worker itself is built (item 5 in the build order below), not before, since there's no Worker yet for the domain to route to.

**L9 -- all-user preview concurrency.** Cap set at 25 concurrent previews across all users (up from the original 10), with the 26th request queued and shown a visible position rather than rejected, per the recommendation.

**L40 -- Cloudflare auto-publish, credential design.** All four qualifiers accepted as recommended:

- A scoped **API Token** the user creates in their own Cloudflare dashboard (Workers Scripts: Edit, Workers Routes: Edit, DNS: Edit -- restricted to one zone) and pastes into Vibld. Not OAuth -- Cloudflare reserves that access model for approved technology partners.
- Stored in **Cloudflare Secrets Store**, not hand-rolled encryption in D1.
- **Cloudflare only** for this flow at first; Vercel/Netlify tokens (L41) follow the same pattern once this is proven.
- **A Vibld-provided subdomain, auto-configured, is the primary path** -- not a fallback. Every exported project gets a working `<project-slug>.<preview-or-app-subdomain-of-vibld.com>` publish with no action from the user beyond pasting the token once; a full custom domain is an opt-in second step for users whose domain is already on Cloudflare. (The illustrative `vibld.app` used earlier in this document was a placeholder, not a domain Vibld owns -- the actual scheme will hang off `vibld.com` or `vibld-preview.dev`, decided when this is built.)

**L39 -- model catalogue growth (standing note, not a one-time decision).** Confirmed: no hosted BYOK (per L45), and new providers get added to the catalogue as they ship (starting point named: an OpenAI-family model). Governs how `model-catalogue.ts` grows going forward.

## Generation pattern/style/SEO catalogue (scoped 2026-09-09)

Raised in the response to internal PR 70, not part of the original ten workstreams; scoped via three follow-up questions (L50-L52 above). Build order, once started: (1) author the v1 content set -- 10 marketing page types, 6 SaaS screens, 5 style presets -- as versioned, retrievable documents rather than prose in a prompt; (2) extend the D13 retrieval path to select from it per request; (3) wire citeunseen.io per L52, whose disclosure question is resolved above.

Steps (1) and (2) shipped 2026-09-11 (`packages/ai/src/patterns.ts`, alongside the pre-existing `style-presets.ts`): a closed, versioned set of 10 marketing page patterns and 6 SaaS screen patterns, matched by keyword against the request text and injected as structural guidance for whatever matches -- not semantic retrieval (that still needs internal issue 12's embedding provider and spend cap), but the smallest thing that satisfies L50's actual "a handful of relevant patterns injected per request" without either dependency. Step (3) is unblocked as of 2026-09-17: the disclosure framing is resolved above (on by default, disclosed at generation time, emitted as ordinary removable code that the project does not depend on). It is not yet built, and it is **deferred past launch** (Chris, 2026-09-19): not part of the launch bar, and not to be raised against it. Nothing else here depends on it.

## Scale without speculative implementation

Use explicit owner/tenant, project type, template version and provider capability fields where the first slice needs them. Keep permissions and quotas out of model prompts and provider-specific objects out of core contracts. Add packages only when actual callers justify a boundary. Do not build enterprise roles, arbitrary imports, every template family or a universal plugin system in M1.

## Details still to resolve during implementation

These details do not reopen D1-D30 or the launch decisions above. Record choices in the implementing issue or a new ADR when they affect a durable boundary.

- Verify the cache-read and cache-write ratios in `PROVIDER_CACHE_RATES` against each provider's current pricing; they are live and decide what a run costs a user's allowance.
- Calibrate evaluation thresholds from the first baseline; proposed numbers in the implementation plan are engineering targets, not a reliability guarantee.
- Validate an alternate execution path and self-hosting instructions before claiming a working Cloudflare-independent OSS builder -- the L47 local adapter is the mechanism, not yet proof it works.

Acceptance of architecture does not authorize purchases, production deployment, public access changes or unlimited paid model runs.
