# Accepted product and architecture decisions

Accepted: 2026-09-06.

This register records the choices approved during the Phase 0 review. Letters retain their conversation identifiers; the descriptions make each choice usable without that conversation. D16(d) was the additional hybrid recommendation. These are approved requirements, not claims of implemented capabilities.

The [charter](../VIBLD.md), [roadmap](../ROADMAP.md), and [ADRs](adr/README.md) apply these decisions. The [original blueprint](archive/README.md) is historical context. Later accepted decisions take precedence over its tentative technology choices and conflicting milestone sequences. Change accepted decisions through a new ADR and an explicit register update.

| ID  | Choice        | Accepted direction                                                                                                                                                                                                                                        |
| --- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | a, then b/c/d | Start with technical founders and small agencies. Expand to nontechnical business owners, developers working in existing repositories, designers and marketing users. Allow for other project types and audiences without implementing them all in M1.    |
| D2  | b             | Generate marketing sites and landing pages first. Business applications and CRUD workflows follow.                                                                                                                                                        |
| D3  | a             | M1 combines generated files and working preview, with bounded initial repair, a saved checkpoint and export. M2 adds dependable conversational editing and recovery. M1 is a technical alpha; M1 plus M2 proves the usable build/edit loop.               |
| D4  | b             | Run an invitation-only hosted alpha. Identity, tenant authorization, quotas, private previews, secrets and basic operations are release requirements.                                                                                                     |
| D5  | b             | Use Cloudflare Sandbox SDK for the first execution adapter. Preserve an interface for other runtimes.                                                                                                                                                     |
| D6  | c             | Use a React/TypeScript/Vite builder UI, Hono on Workers, Workflows for long-running jobs, Sandbox for execution, PostgreSQL metadata via Hyperdrive, and R2 artifacts. Add Durable Objects for coordination/live connections where needed.                |
| D7  | b             | Keep metadata in PostgreSQL and durable project content outside disposable sandboxes. Git records accepted code history; remote GitHub is optional for project survival.                                                                                  |
| D8  | c             | Include GitHub connection, branches and pull requests in M1. Prove this on Vibld-generated projects first; arbitrary existing-repository import/editing comes later.                                                                                      |
| D9  | a             | Use AI SDK behind a small Vibld-owned model contract. Configure providers deliberately and keep SDK types out of domain interfaces.                                                                                                                       |
| D10 | a             | Select initial models through a measured bakeoff. No provider winner or paid evaluation allowance is implied by this decision.                                                                                                                            |
| D11 | a             | Persist a controlled workflow with one active implementation agent, bounded repairs/retries and explicit cancellation and recovery. Logical prompt roles need not be autonomous agents.                                                                   |
| D12 | a             | Stage edits against a known base revision, validate them, then promote an accepted revision. Enforce one writer per project and surface conflicts without overwriting user work.                                                                          |
| D13 | c             | Include repository indexing and semantic search early. Combine exact/symbol retrieval with semantic retrieval, scoped by tenant, project and revision.                                                                                                    |
| D14 | c             | Offer selectable autonomy modes through explicit project/action/destination/budget/time permissions. The service enforces permissions; the model cannot grant itself authority.                                                                           |
| D15 | a, then b/c   | Begin with curated dependencies, then approved additions, then a broader install mode. Keep isolation, network and resource restrictions in every mode.                                                                                                   |
| D16 | d             | Use a hybrid, broker-first credential design. Keep provider and control-plane credentials in trusted services; allow narrow runtime injection only where an integration requires it.                                                                      |
| D17 | b             | Make hosted previews private by default, with explicit, revocable, time-limited sharing on an isolated origin.                                                                                                                                            |
| D18 | a             | Use a versioned evaluation set covering functionality, portability and failure recovery. Report initial success and success after repair separately.                                                                                                      |
| D19 | a             | Enforce run budgets and expose usage, elapsed time and cost, including failed attempts. Bound sandbox lifetime and concurrency as well as model usage.                                                                                                    |
| D20 | b             | Enable minimal operational telemetry by default with an easy opt-out. Exclude source code, prompts and secrets. Do not describe linkable identifiers as anonymous.                                                                                        |
| D21 | a             | Keep a complete single-user builder in OSS. Cloud sells managed operations and team capabilities. Saving, Git, BYOK and export are not artificial paid gates.                                                                                             |
| D22 | a             | After the build/edit loop, deliver publishing, then one full-stack integration, then advanced visual targeting.                                                                                                                                           |
| D23 | a             | Evaluate Supabase first for generated applications' database, auth and storage. Customer application services remain separate from Vibld's own platform.                                                                                                  |
| D24 | a             | Keep core Apache-2.0; license reusable starter-template source MIT. Users choose their application license subject to upstream obligations.                                                                                                               |
| D25 | a             | Founder-led governance, human-reviewed PRs and DCO sign-off. No copyright assignment and no permanent dependence on one coding-agent vendor.                                                                                                              |
| D26 | a             | Enforce a small quality baseline before feature code. Use locked installs, formatting and meaningful lint/type/test/build checks as code appears.                                                                                                         |
| D27 | a             | Preserve the original blueprint, maintain this register, and keep ADRs, roadmap, issues and real GitHub milestones aligned.                                                                                                                               |
| D28 | c             | Keep the repository informal until the product works. Defer brand work and extensive community templates; keep essential ownership, quality and security controls.                                                                                        |
| D29 | a             | Use React Router framework mode with static prerendering for generated marketing sites, alongside TypeScript, Vite, Tailwind and selected UI components. The builder UI remains a separate Vite SPA. Superseded for generated projects by D92 (ADR-0014). |
| D30 | a             | Use Supabase PostgreSQL and Supabase Auth for the hosted platform, with Hyperdrive for direct PostgreSQL access from Workers.                                                                                                                             |

## Launch decisions (accepted 2026-09-09)

Accepted 2026-09-09 (internal PR 70). L1 and L24 amend D30 -- D23 is untouched by both.

| ID   | Choice         | Accepted direction                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1   | a              | Clerk replaces Supabase Auth for the Vibld platform. D23 (Supabase for generated apps) is untouched. Amends D30.                                                                                                                                                                                                                                                                                                                             |
| L2   | a              | Verify the Clerk session JWT against a cached JWKS inside the Worker -- no network call per request.                                                                                                                                                                                                                                                                                                                                         |
| L3   | a              | The budget ledger and every ownership row key on the Clerk user id. Email is display only.                                                                                                                                                                                                                                                                                                                                                   |
| L4   | a              | Platform admins come from a `VIBLD_PLATFORM_ADMINS` GitHub Actions secret (comma-separated emails), synced to the Worker on deploy, honored only for a Clerk-verified primary address.                                                                                                                                                                                                                                                       |
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
| L28  | a              | No row-level security on the control plane; one enforced authorization choke point plus a test that no query path bypasses it. RLS is mandatory in the generated-app Supabase template, and generation is refused when it is off there.                                                                                                                                                                                                      |
| L29  | --             | Turnstile, a per-IP WAF rate limit, disposable-domain blocking, the existing per-user ceiling, and a new account-wide daily ceiling all ship before Access comes off.                                                                                                                                                                                                                                                                        |
| L30  | a              | Stripe, Clerk (Svix) and the GitHub App webhooks are all signature-verified with a replay window, rejected before the body is parsed.                                                                                                                                                                                                                                                                                                        |
| L31  | a              | No BYOK storage in the hosted product until a credential vault exists. _(Deployment tokens for L40's auto-publish flow are a separate question, resolved under "Resolved 2026-09-09"; they are not covered by this line.)_                                                                                                                                                                                                                   |
| L32  | --             | Project content purged 30 days after account deletion; audit log kept 12 months with the user id tombstoned.                                                                                                                                                                                                                                                                                                                                 |
| L33  | **b**          | Security scanning is run directly, and a trust center is stood up separately.                                                                                                                                                                                                                                                                                                                                                                |
| L34  | a              | Hosted model access runs on one shared platform key per provider, gated by our own credit ledger.                                                                                                                                                                                                                                                                                                                                            |
| L35  | a              | One credit = 1¢ of model spend; the user sees a plain "generations remaining" for the model they chose.                                                                                                                                                                                                                                                                                                                                      |
| L36  | --             | Free $0/$1 spend, Build $19/$14, Ship $49/$40, top-up $10/$8 expiring 12 months (D155, 2026-10-04; was Build $29/$10, Ship $99/$40, top-up $20/$8). Recorded in full below.                                                                                                                                                                                                                                                                  |
| L37  | a              | Hard stop at the allowance, with one-click top-up. No auto-charged overage, except the top-up an account opts into (D166) and the Build plan a Free account opts into (D167), both 2026-10-07.                                                                                                                                                                                                                                               |
| L38  | a              | Annual billing at two months free -- Build $190, Ship $490 (D156, 2026-10-04; was $290 and $990).                                                                                                                                                                                                                                                                                                                                            |
| L39  | a              | Opus is available inside a paid tier, drawn from the same allowance. _(Extended under "Resolved 2026-09-09": more providers are to be added as they ship, and hosted BYOK stays off per L45.)_                                                                                                                                                                                                                                               |
| L40  | **b**          | Vibld deploys into the user's own Cloudflare account to auto-publish exported sites, reversing the recommendation against holding deploy credentials. Resolved: a scoped API Token the user pastes in (not OAuth), stored in Cloudflare Secrets Store, Cloudflare only for now, and the primary path is a Vibld-provided subdomain auto-configured on the user's behalf -- not merely a fallback. See "Resolved" below for the exact scheme. |
| L41  | a              | Cloudflare, Vercel and Netlify at launch; DigitalOcean and a container path after.                                                                                                                                                                                                                                                                                                                                                           |
| L42a | a              | The GitHub App requests Contents, Pull requests and Metadata, plus Administration (read and write) since 2026-09-29 so a project can create its repository (D72).                                                                                                                                                                                                                                                                            |
| L42b | a              | No Vultr Kubernetes/registry template.                                                                                                                                                                                                                                                                                                                                                                                                       |
| L42c | **b**          | Vibld may hold deploy hooks/credentials for users, specifically to run the L40 Cloudflare auto-publish flow. _(moved off recommendation -- recommended no)_                                                                                                                                                                                                                                                                                  |
| L43  | a              | One initial commit on first export, then one commit per accepted checkpoint.                                                                                                                                                                                                                                                                                                                                                                 |
| L44  | a              | A scheduled Worker reads both providers' balances daily and emails an alert through Resend on a threshold.                                                                                                                                                                                                                                                                                                                                   |
| L45  | a              | BYOK is the self-hosted story only. The hosted product sells credits and holds no user model-provider keys.                                                                                                                                                                                                                                                                                                                                  |
| L46  | a              | The self-hosted build has no auth by default; Clerk switches on when its environment variables are present.                                                                                                                                                                                                                                                                                                                                  |
| L47  | a              | The self-hosted build ships a local (Docker or child-process) sandbox adapter alongside the Cloudflare one.                                                                                                                                                                                                                                                                                                                                  |
| L48  | a              | Billing, entitlement and tenancy code ships in the same public repository as the core, inert without secrets.                                                                                                                                                                                                                                                                                                                                |
| L49  | a              | v0.1.0 is tagged once the hosted alpha is stable and a clean checkout is proven in CI to build, run and generate with only a provider key.                                                                                                                                                                                                                                                                                                   |
| L50  | a              | The generation pattern/style/SEO catalog is retrieved on demand -- a handful of relevant patterns injected per request -- extending D13's retrieval work and ADR-0009's bounded-context design, not held permanently in the system prompt.                                                                                                                                                                                                   |
| L51  | a              | Catalog v1 is small and real: about 10 marketing page types, 6 SaaS app screens, 5 style presets (glassmorphism, minimalist, brutalist, retro, editorial), built well enough to improve output before it grows.                                                                                                                                                                                                                              |
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
| Free tier                      | $0 -- $1/mo model spend with a card, $0.20 once without  |
| Build tier                     | $19/mo -- $14/mo model spend                             |
| Ship tier                      | $49/mo -- $40/mo model spend                             |
| Top-up                         | $10 -- $8 model spend, expires 12 months                 |
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

### Template categories, 2026-10-06

Chris: "The templates on vibld are missing the subcategories for things like
ecommerce, shopify, etc. (see https://lovable.dev/templates for examples)".
The gallery and the builder's picker filtered by kind and by the five use
cases, while each design's own catalog category,
38 of them, was printed on its card and could not be browsed.

- **D161. Templates are browsed by category and subcategory (Chris,
  2026-10-06: "Approve").** As on
  lovable.dev/templates: Websites, Apps and App screens, then a subcategory
  inside websites and apps, each a prerendered page of its own at
  `/templates/<category>/<subcategory>` with only its own designs, and the
  gallery's other filters carried between them. Websites: Portfolio, Local
  services, Ecommerce, Shopify, SaaS, AI products, Landing page, Blog,
  Editorial, Music, Events, Resume. Apps: Internal tools, SaaS,
  Business tools, Dashboards, Productivity, Developer tools, Starter kits,
  Finance, Project management, Product management, Education, Lifestyle,
  Presentations. App screens keep their screen-type filter. A subcategory
  gathers catalog categories, so the catalog is unchanged; Shopify takes
  the designs whose purpose names Shopify, which Ecommerce lists too. The map is `packages/ai/src/design-categories.ts`; the
  builder's picker uses the same one, in place of its kind and use-case
  filters, and so does the gallery, in place of its Show, Use case and Kind
  filters. The use-case pages are unchanged.
- **D162. The style gallery is listed under the template categories too
  (Chris, 2026-10-07: "Yes" to folding them in).** Chris asked "I thought we
  had like 1200+ templates?": the 1,342 style gallery entries were only at
  `/styles/gallery`. Each one is a website with a full build prompt, so
  each is now also a card on `/templates` and in the builder's Templates
  option, under the website subcategory its industry names: Agency and
  portfolio under Portfolio, E-commerce under Ecommerce, AI under AI
  products, General brand under Landing page, Media and publishing under
  Editorial, and SaaS, Design tools, Developer tools, Fintech, Productivity
  and Web3 under SaaS (the closest existing subcategory; no new ones were
  added). A card links to the style's own gallery page, and in the builder
  adds its build prompt to the message as a design's brief is. The
  gallery's Source filter lists them as "Style gallery". `/styles/gallery`
  is unchanged.
- **D164. The SaaS industries get their own website subcategories (Chris,
  2026-10-07: "Split out").** D162 put six gallery industries under SaaS, 600+
  entries. Design tools, Developer tools, Fintech, Productivity and Web3
  are now website subcategories of their own, after SaaS, which keeps the
  gallery's SaaS industry. The website designs whose catalog category is
  fintech, productivity or developer tools move with them; SaaS keeps CRM
  and sales, analytics, HR, marketing tools and collaboration. Design tools
  and Web3 hold only styles, so a subcategory counts as filled by a style
  as well as a design.

### Pricing, 2026-10-04

Chris asked for pricing that covers costs plus a small margin for his time.
The proposal measured what a build costs from production run traces (GPT-6
Luna about $0.02, from three runs; GPT-6 Sol about $0.70; one Opus 5.5 run
$2.62) and put fixed infrastructure at about $10 a month. Model spend is
the only cost that grows with use, and the allowance is already metered at
cost (L35), so a plan's margin is the gap between its price and its
allowance, less Stripe's 2.9% + $0.30. Production had 16 accounts and no
paid subscription or top-up when this was decided, so no subscriber's price
changes.

- **D155. Cost-plus prices (Chris, 2026-10-04: "D155a").** Build $19 a
  month with $14 of model spend, Ship $49 with $40, top-up $10 for $8. At
  full use of the allowance that leaves $4.15 (22%), $7.28 (15%) and $1.41
  (14%) after Stripe; it was $17.86, $55.83 and $11.12. Free is unchanged.
  Amends L36. The amounts are `PRICE_USD_CENTS` in
  `apps/web/worker/stripe-client.ts` and `TIER_INCLUDED_MICRO_USD` in
  `entitlement.ts`; `scripts/configure-accounts.mjs` (apply) moves each
  Stripe lookup key to a new price at that amount and archives the old one.
- **D156. Annual plans stay, at two months free (Chris, 2026-10-04).**
  Build $190 a year, Ship $490. Amends L38.

### Free accounts, 2026-10-05

Every Free account's run counted against the one deployment-wide day (L29,
$80 by default) that paid runs count against too, so free use could pause
paying accounts until midnight UTC.

- **D158. Free use gets its own share of the day (Chris, 2026-10-05: "D158
  yes").** A run on the Free plan of a deployment that sells plans counts
  against a Free share of the day as well as the whole of it: $10 by
  default, `VIBLD_FREE_DAILY_MICRO_USD`. Paid runs count against the whole
  day only, so they are never refused for free use. A Free run that draws on
  top-up credit leaves the share, since that is paid money. The share is a
  `pool` column in the account ledger (`apps/web/worker/budget.ts`), so
  settlement is unchanged. Previews are the second half: a Free account's
  previews hold a container for at most two hours a UTC day
  (`VIBLD_FREE_PREVIEW_DAILY_MINUTES` on apps/preview, 120 by default),
  counted from admission to release, per account rather than per sandbox
  (so share links draw on the owner's day), with a session that crosses
  midnight charged to the new day for its later part. It is checked when a
  preview is asked for and again when a queued one is admitted, counting
  every open session at its whole lifetime, so the one running keeps its
  thirty minutes and parallel starts cannot each overrun. A Free preview never takes the
  last five of the twenty-five containers (`PAID_PREVIEW_RESERVED`), so
  Free use alone cannot fill the fleet for paid plans; a Free preview may therefore wait while
  those five are idle, which is the one exception to L9's "queued only when
  full". apps/web decides which previews are Free (`freePreviewFor`): the
  account's own in the builder, the project owner's for a shared link.
- **D159. Free's monthly dollar waits for a card (Chris, 2026-10-05:
  "Trial, then $1/mo").** A Free account with no card on file gets a trial
  of $0.20 (about two builds, `VIBLD_FREE_TRIAL_MICRO_USD`), which never
  resets: it is its own `trial` period in the account's ledger, inside the
  Free share of the day (D158). Saving a card through the same Stripe setup
  page the welcome credit uses moves the account to the $1.00 a month, and
  nothing is charged. A card counts for the first account that saved it
  (`billing_signup_cards`, by fingerprint); an account that has had a
  subscription or bought a top-up already counts as having one. This applies
  to every Free account, existing ones included. A run refused on the trial
  asks for a card rather than naming the 1st. Auto-reload and
  auto-subscribe, once a card is on file, are separate and opt-in.
- **D160. The Free plan keeps Luna (Chris, 2026-10-05: "Keep Luna").** The
  question was which DeepSeek model the Free plan should default to; the
  answer was no change to its model or default.
- **D163. The welcome credit is retired (Chris, 2026-10-07: "Retire").**
  With D159 the same card buys the Free plan's monthly dollar, so the one-time
  $1.00 for saving it is no longer offered. `DEFAULT_SIGNUP_CREDIT_USD_CENTS`
  is 0, and production retires it with `VIBLD_SIGNUP_CREDIT_USD_CENTS` set to
  0 on the deploy environment (the Worker secret persists until replaced).
  Accounts already granted it keep it until it expires. vibld.com states the
  grant only while it is above zero.
- **D166. Opt-in auto-reload of the top-up (Chris, 2026-10-07: decision
  card D166, recommended "Cap $30/mo"; amends L37).** Off unless an account
  turns it on in the builder. With it on, when the most the next run could
  draw (the allowance left or the credit left, whichever is larger) drops
  below $1 after a run settles, the card the account chose is charged off
  session for the $10 top-up ($8 of credit, expiring like any top-up). At most
  the monthly cap the account picks, $10 to $100 in whole top-ups and $30
  until it picks, counted per UTC month. One charge in flight at a time
  (`billing_auto_reload_attempts`). A declined charge, one the bank wants
  confirmed, or a card no longer saved turns it off, and the builder says why
  above the one-click top-up, which stays. A refund or a lost dispute of the
  charge takes the credit back as for a Checkout top-up. The refund policy and
  the Terms say so. Turning it on needs an invite, as checkout does; turning
  it off never does, so an account whose invite was withdrawn can still take
  the permission back.
- **D167. Opt-in auto-subscribe starts Build, once (Chris, 2026-10-07:
  decision card D167, "Start Build"; amends L37).** Off unless a Free account
  turns it on in the builder, which needs a card Stripe can charge again. With
  it on, at the moment auto-reload would charge a top-up (D166), and in its
  place, the account is moved to the monthly Build plan on that card, off
  session, with Stripe's `error_if_incomplete` so a refusal leaves no
  subscription. Once: having started the plan, it turns itself off
  (`disabled_reason = 'subscribed'`), and a plan canceled later is not started
  again: the account's `stripe_subscription_id` stays recorded, the claim
  refuses it, and the switch is not offered again. A declined charge, one the
  bank wants confirmed, or a card no longer saved turns it off too. Not offered
  on a paid or gifted plan, nor while a subscription Stripe may still bill
  (`past_due`, `paused`) exists, asked of Stripe itself just before the plan
  is started, so a Checkout purchase whose webhook has not landed yet is not
  doubled. Open plan and top-up Checkouts are expired before the plan starts, a
  top-up paid but not yet credited is waited for (one paid by bank debit for
  as long as it takes to settle, `billing_unsettled_topups`), and either Checkout is
  refused while an attempt is in flight. One attempt in flight at a time, on the setting's own row (`billing_auto_subscribe`), and never
  beside an auto-reload charge: each claim refuses while the other's is held.
  An account on a plan that has it on keeps the switch, to turn it off. The
  refund policy and the Terms say so.

### Checkpoint history, 2026-10-03

ROADMAP M2 asks for "a history view that lists every accepted checkpoint and
restores one in a single step". It is built on what was already stored: R2
keeps every revision a project has accepted (`projects/{id}/snapshots/{rev}.json`),
and `generation_stages` records each acceptance, so no migration was needed.
The builder gets a History tab beside Runs; the Worker gets
`GET /api/projects/:id/checkpoints` and
`POST /api/projects/:id/checkpoints/restore`.

- **D152. How rollback behaves (Chris confirmed these defaults,
  2026-10-03).**
  - **Refused while a build runs** in the project (409, the check DELETE
    makes), because the build would then promote over the restored code or
    be refused as a conflict with it. Also refused for an archived project,
    and when the accepted revision is no longer the one the list was loaded
    with (409, `checkpoint-moved`), so a restore chosen from a stale list
    never undoes a build or another tab's restore.
  - **Every checkpoint is kept.** A restore moves the accepted pointer by
    compare-and-set and records itself as one more accepted stage row
    (`rollback-<uuid>`); it never rewrites a snapshot in R2 and never
    deletes a build's row, so the checkpoint restored from stays in the
    list and can be put back in turn. A revision restored again replaces
    its own earlier rollback row, so restores, which are free, cannot grow
    the table past the builds (Codex review of internal PR 360).
  - **It never re-publishes or pushes.** The published site and the
    connected GitHub repository stay as they were until the person ships
    again. It spends nothing either: no budget is reserved or charged and
    no run trace is written.
  - **Open to the project's owner like GET.** Both routes are ungated, as
    `/api/projects/:id` is: putting back code the project already had is
    tidying it, and a revoked account keeps what it made. Another
    account's project answers 404, not 403.
  - **Accepted checkpoints only.** The list is the project's accepted
    revisions, newest first and capped at 100, leaving out a build check's
    own row (D69); a copied or remixed project's starting code is listed as
    a copy. Staged or failed runs are not offered.

### Sample gallery, 2026-10-03

Internal issue 186 asks for real output per style and site type on
vibld.com, generated through the normal path and recorded with the prompt
that produced it. It is built on the examples catalog
(`examples/catalogue.json`): the same file, the same publish workflow, the
same no-hand-edits rule, and a new section of /examples.

- **D153. The full grid (Chris, 2026-10-03: "Full grid").** Five site
  types (consultancy, portfolio, shop, docs, event), each one brief, built
  in six styles: 30 builds, estimated at $5 to $10. The briefs and styles
  are `GALLERY_SITE_TYPES` and `GALLERY_STYLES` in
  `packages/eval/src/cases.ts`, as eval cases named
  `gallery-<type>-<style>` that a blank selection does not run, so the
  Model bakeoff workflow regenerates any cell. Defaults taken on Chris's
  behalf, each changed by editing that file and rerunning:
  - **The styles:** Minimalist, Editorial, Brutalism, Glassmorphism, Warm
    Paper and Acid Dark, chosen to look as unlike each other as the
    presets allow.
  - **The model:** DeepSeek V4 Pro, the model the estimate was made on.
    The production default, GPT-6 Sol, was not costed for this.
  - **One run per cell,** with the bakeoff's single repair turn, the one
    the product itself makes. A cell that still does not build is left out
    and the page shows the rest, never a patched copy.

  The first run (five bakeoff runs, 37144400710 to 37153138437) cost
  $9.46 and kept 17 of the 30 cells, 7 of them after the repair turn:
  consultancy 3, portfolio 4, shop 3, docs 3 and event 4. Ten cells did
  not build, eight of them on the same typecheck error: a Radix primitive
  imported as a module and used as a component (`Slot` in `button.tsx`,
  or `Tooltip` or `Sheet`), which the repair turn did not fix. Three more
  built but threw on load (React error 130, an element type that is an
  object) and are left out too, per `examples/README.md`.
  The generation prompt's stack rules now say that every `radix-ui`
  export is a namespace of parts, and that Button's `asChild` renders
  `Slot.Root`.

- **D157. Re-run the 13 dropped cells (Chris, 2026-10-05: "Re-run all
  13").** After that prompt change, the same cases on the same model, one
  run each (bakeoff runs 37263180128 to 37269459713), cost $3.56. Twelve
  built, one of them after the repair turn. Shop in Brutalism did not: it
  imported a `Sheet` that `radix-ui` does not export (a sheet is
  `Dialog`), then gave `Dialog.Content` a `side` prop it does not take.
  Docs in Warm Paper built but threw on load (React error 310, a hook
  called conditionally) and is left out too, so the gallery keeps 28 of 30.

### What comes next, 2026-10-03

Chris asked what to tackle next and took all six suggestions, in the order
suggested.

- **D149. Launch first, then product work (Chris, 2026-10-03).** In order,
  one pull request at a time: release v0.4.0 and point the Reddit post at
  it; validate self-hosting from the README alone; close the M0 and M1
  issues that have shipped; add `claude-sonnet-5-5` to the model catalog
  (internal issue 300); build checkpoint history and rollback (M2); then a
  curated gallery of real generated sites (internal issue 186).
- **D150. It is v0.4.0.** Since v0.3.0 the whole builder runs under Docker
  with no cloud account, signs in with no paid service, builds with a local
  model, previews in the browser and has an admin panel and the style
  gallery, which is more than a patch. Notes in `docs/releases/v0.4.0.md`;
  the Public release workflow tags it after the export of the merge.
- **D151. Close what is one check short, and say what is left on the rest
  (Chris, 2026-10-03).** None of the 24 open M0 and M1 issues met every
  acceptance criterion on main at 0fd7dd8. Internal issue 3 (only "renders correctly on
  GitHub" unchecked) and internal issue 17 (no reporter-side test recorded) are closed;
  each of the other 22 has a comment saying exactly what is left.

### The style gallery, 2026-10-02

Chris asked for Drummond-IT/designs-v1's style gallery
(`style-gallery-patterns/`, 1,342 website style presets) to become a
selectable style library: an importer keyed on `id`, a picker, applying a
style's tokens and fonts to a project, generating with its build prompt, and
a contrast guard on color edits.

- **D142. Where it lives, taken on Chris's behalf.** The catalog is its own
  module, `@vibld/ai/style-gallery`, beside the design templates (D83) and
  apart from the 24 style presets, which are unchanged. Its data is
  `packages/ai/data/style-gallery.json`, generated by
  `packages/ai/bin/import-style-gallery.ts` and committed, as the template
  catalog is, so tests and builds need no access to designs-v1. It is JSON
  rather than a data module because at 26 MB it must never be bundled: it is
  written one entry per line in `id` order, so a re-import's diff names the
  styles that changed, and the builder will read entries from the Worker's
  assets rather than from code. Each import upserts by `id` and drops ids the
  source no longer has; running it twice changes nothing. It changes the
  catalog's words only to US English (D120, about 22,000 strings, nearly all
  "colour" and "centred") and would turn an em-dash into `--` (D87; there
  are none). It refuses to write if an entry fails a check: Chris's rules
  (Google Fonts from the source's allowlist only, nothing below 12px, a 16px
  step, no URL, no decorative color carrying text) and the source's own
  (fields, controlled values, the ten prompt sections, unique ids and names
  across vibld's catalogs, every contrast pair measured again). A swatch
  holding several roles ("canvas / supporting accent (decorative)") is
  decorative only when every role is.
- **D143. The data is exported to vibld/vibld, and vibld.com publishes the
  gallery (Chris, 2026-10-02: "Publish gallery").** `scripts/public-export.mjs`
  no longer leaves `packages/ai/data/style-gallery.json` out, and vibld.com
  gets browsable style pages beside the templates. The facts Chris decided
  on, as recorded before: designs-v1 is private and has no license file, and
  `style-gallery-patterns/` has none of its own. Its README says the entries
  were "derived from measurements of public marketing sites" (colors, type
  sizes and weights, spacing, radii, shadows and section order), that every
  name, description and prompt is newly written, and that "This folder makes
  no licensing decisions."
- **D144. How the builder reaches the gallery, taken on Chris's behalf.**
  A chosen gallery style is a project setting, stored by `id` in a new
  `projects.style_gallery` column (migration 0045) and carried like the
  style preset: choosing one clears the preset and choosing a preset clears
  it, so a build never gets two styles. The production build writes the
  gallery beside the builder's assets as files (`_style-gallery/cards.json`,
  `baseline.json`, `styles/<id>.json`; `apps/web/scripts/style-gallery-assets.ts`)
  rather than into any bundle. The Worker runs first for `/_style-gallery/*`
  and answers 404, so the files are reached only through
  `/api/style-gallery`, which the access gate guards like the rest of the
  builder. The picker loads the cards (about 1.4 MB) only when its panel is
  first opened.
- **D145. A gallery style's tokens are a file Vibld writes, Chris's choice
  (2026-10-02).** A build in a gallery style sends the style's id; the
  Worker reads its entry and writes `src/vibld-gallery-style.css` into every patch
  (`styleTokensFile`, `withScaffold`), and src/styles.css imports it right
  after Tailwind. The file holds exactly the entry's `design_tokens` in
  Tailwind v4's `@theme` namespaces: each color under its own token
  (`--color-canvas`, so `bg-canvas`), each type step as `--text-N` with its
  line height, tracking and weight (`text-62`), each radius as
  `--radius-<element>` (`rounded-cards`), each shadow as `--shadow-N`, and
  the faces as `--font-display` and `--font-body`, with body text at 16px.
  Fonts are self-hosted from Fontsource (`@fontsource/<family>/<weight>.css`
  for each weight the type scale uses), which the dependency scan declares
  in package.json. It is a templated path, so the model never writes it, and
  it is rewritten on every build that has a style. A build without one
  (the style cleared, or a preset chosen) removes the file and its import,
  so the old style stops setting the theme. It removes only a file that
  says Vibld wrote it, so a project's own file at that path is kept.
- **D146. What a build in a gallery style is told, taken on Chris's behalf.**
  As Chris asked, the gallery's `baseline_rules_markdown`, then the style's
  `build_prompt`, both whole, after a short note naming the tokens file and
  the utilities it declares (`styleGalleryGuidance`). It goes last in every
  call's request context and replaces the product-type palette, the
  standing style preferences and any style preset, so the model is never
  given two design systems. Two lines are vibld's own: decorative colors
  never sit behind text and body text stays at 16px or more (Chris's
  rules), and where the rules or prompt name a stack, package or service
  vibld's STACK does not have (the baseline mentions Supabase and zod),
  STACK wins. The request itself outranks the style, as it outranks a
  preset. The longest guidance (orchardlough) is about 24,200 characters
  against a preset's 12,400, so a build's reservation for fixed prompt text
  rises from 36,000 to 48,000 characters, and the smallest build a Free
  account can start on the default model needs $0.87 set aside, from
  $0.86. Mockups and the quick draft are drawn in the gallery style too
  (`styleGalleryDirection`, within the preset directions' bound).
- **D147. The theme guard blocks rather than warns, taken on Chris's
  behalf.** vibld had no color editor, so the gallery panel gets one: the
  chosen style's color tokens, each editable. Every edit is checked against
  all of the style's measured contrast pairs (`checkColorEdits`), each at
  its own target (4.5:1 for text, 3:1 for UI and large text), and a pair
  that names a decorative-only color fails whatever its ratio. An edit that
  fails is not applied, and the panel lists the pairs it broke. The kept
  edits are saved with the project (`projects.style_gallery_colors`,
  migration 0046), cleared when the style changes, and checked again by
  the Worker before a build writes them into the tokens file, so a request
  that skips the builder is refused the same way. Exempt pairs (the
  catalog's decorative fills) are not measured.
- **D148. A design template can be chosen as inspiration in the builder
  (Chris, 2026-10-02).** The composer gets a Templates option: the template
  catalog vibld.com shows (the entries not merged into another), filtered
  by kind and use case and searched by name and summary. Adding one puts
  its brief in the message as text, filling an empty message or following
  what is there, exactly as "Start from this template" on vibld.com does
  (D106), so what a build is asked for stays in view and can be edited.
  The names load when the panel opens (`@vibld/ai/design-template-index`);
  each brief is a file the build writes (`_templates/briefs/<id>.json`)
  and the Worker serves one at a time through the gated
  `/api/templates/brief`, because the catalog is far too large for the
  builder's bundle or the Worker's.

### Resolved 2026-09-30 (afternoon)

Chris answered the open questions from the overnight work and the docs audit
on 2026-09-30.

- **D89. Tag v0.1.0 now.** The first launch bar is met (D80, D82), and D81
  ships each step as it is proven. The public repository is written only from
  here, so its tags are too: `.github/workflows/public-release.yml`, dispatched
  from main after the export, tags the public main and publishes a release
  with the notes in `docs/releases/<version>.md`. It refuses when the public
  main is not yet that commit's export.
- **D90. The announcement is drafted, and Chris posts it.** Show HN and
  LinkedIn copy against v0.1.0, for his review.
- **D91. A `VIBLD_MODEL` the deployment cannot serve is refused.** It used to
  fall back to the first model in catalog order: a copy with the shipped
  `gpt-6-sol` and only an Anthropic key ran on Claude Fable 5.1. A run with no
  chosen model is now refused with the setting to change
  (`unservableConfiguredModel`); a model the person chose still runs.
- **D92. The Vite single-page app stands.** ADR-0014 is accepted and
  supersedes D29's React Router framework mode and static prerendering for
  generated projects. `templates/marketing` keeps its own stack.
- **D93. A project remembers its reference page.** Every build reads it until
  the field is cleared; sending a message no longer clears it, and a remix
  copies it with the other settings.
- **D94. Optional `.vibld/` metadata is allowed,** as ADR-0002 says, on its
  condition: nothing else in the project may need it. The evaluation's
  portability check refuses a file that refers to it rather than the
  directory itself.
- **D95. Hosted bring-your-own-key stays under consideration** on the
  roadmap, behind a credential vault (L31). A self-hosted copy already uses
  its own keys (L45).
- **D96. `llms.txt` opens `# vibld`,** the lowercase wordmark.
- **D97. Referral links default to the deployment's own address.** The hosted
  service sets `VIBLD_REFERRAL_ORIGIN` to vibld.com in `wrangler.jsonc`, so
  its links are unchanged; a copy that leaves it unset points at itself.
- **D98. Three tidy-ups.** `apps/web/.env.example` leaves every value empty,
  as its header says (a). vibld.com reads the Free plan's model and project
  limit from the builder's source, as it reads prices (b). The roadmap shows
  build-and-repair reliability as shipped (c).
- **D99. The first release from this repository is v0.2.0.** vibld/vibld
  already had a v0.1.0 tag and release, made by hand on 2026-09-27 at that
  day's export and before `pnpm generate` existed, so `public-release.yml`
  refused to tag v0.1.0 again. Chris chose a new version over moving a
  published tag or rewriting its notes: v0.1.0 stays as it is, and
  `docs/releases/v0.2.0.md` says what changed since it.
- **D100. The template gallery is shipped.** It is the catalog at
  vibld.com/templates (D83, internal PR 323), and the roadmap says so. Picking a design
  inside the builder is not built, and the roadmap does not claim it.
- **D101. vibld.com shows Chris's clean-room layers.** The four moving
  backgrounds run live on /styles, from files generated from the source a
  build writes into a project (`apps/marketing/scripts/backdrops.ts`, held to
  it by a test). Nocturne (a landing page) and stacked-cards (a page section)
  are listed on /templates with the prompt that made each; their reference
  pages are copied from Drummond-IT/designs-v1 `layers/` and served as they
  are at `/layers/<slug>`, kept out of search indexes. The one change is an
  em-dash in Nocturne's title, which became a colon (as D87).
- **D102. Two batches of clean-room ports.** Chris confirmed on 2026-09-30
  that his ports are designs-v1's `layers/` and `design-prompt-catalog/`,
  and nothing else.

### Resolved 2026-09-30 (evening)

Chris reviewed /templates and found the cards thin: a palette, fonts that all
look alike, no filtering, and an exact count where his rule rounds.

- **D103. Every template has its own set of fonts.** No two templates share
  the same combination; a family may recur, and a set may be one family, a
  pair, or three or more, chosen for the design's mood. The catalog used
  Inter for 52 of its 207 headings and one family for everything in 108.
  The build prompts' font lines change to match. The sets are in
  `packages/ai/data/design-template-type.ts`: 207 sets over 183 families,
  Inter now in one design, and every face named in its prompt. An audit of
  every prompt for font names found alternatives the catalog offered ("Inter
  or DM Sans"), which are renamed with the rest.
- **D104. Template fonts are self-hosted subsets.** A script copies a small
  Latin subset of each family into vibld.com, as the site's own fonts are,
  so a visitor's browser asks Google for nothing and the legal pages are
  unchanged.
- **D105. Counts in copy are rounded down.** 207 is "200+", 24 is "20+", 14
  is "10+"; under ten stays exact. Prices, measured costs, durations and plan
  limits are not counts. The rule is written into CLAUDE.md, where it had
  not been, which is how /templates came to say "207".
- **D106. Four more changes to the templates.** A "Start from this template"
  button that opens the builder with the prompt filled in; vibld.com deployed
  on every push to main that changes it; a source batch, an added date and a
  type (homepage, screen, section) on every entry, ready for the next batch;
  and a share image of each template's mocked homepage.

### Resolved 2026-09-30 (night)

Chris asked for Drummond-IT/designs-v1's SaaS screen patterns
(`saas-screen-patterns/`, 237 entries: 149 app screens, 60 marketing sites
and 28 starter apps) to be folded into the template catalog and the
inspiration gallery, keeping names, guardrails and build prompts, merging
duplicates, and re-checking every color pair against WCAG AA.

- **D107. Duplicates.** Six entries are the same product as a design
  already in the catalog and are shown on it as another design for it,
  rather than listed twice: cuetide and dawnlist on queueline (a dark
  pre-launch waitlist page), coquill and chorusdesk on plainwrite (a
  collaborative documents editor), hexledger on nightvault (a dark fintech
  marketing site) and gildway on tallyway (a payments startup's site). No
  name or id clashes with any existing one.
- **D108. Typefaces.** The 88 marketing sites and starters each get their
  own set, unique across both batches, as D103 did for the first. The 149
  screen patterns keep the faces the catalog drew them in: composed into a
  template, a screen is drawn in the template's type.
- **D109. Inspiration.** Every entry's palette and type pairing joins
  /inspiration as a style to borrow, as D83 did. The builder's style
  presets are unchanged.
- **D110. Screens compose into templates.** /templates filters by screen
  type; a template's page lets a reader pick screens to add, and the
  builder has a screen picker of its own. A composed screen brings its
  patterns, layout, states and guardrails, and is built in the template's
  design system.
- **D111. A template's brief can be sent.** The Worker capped a message at
  4,000 characters, and every template brief is 6,700 to 8,400, so "Start
  from this template" (D106) filled the composer with a message the Worker
  refused. The cap on a build prompt and a chat message is now 40,000, the
  most the builder accepts from a template link; the conversation a chat
  turn carries is 60,000 (one such message and 20,000 before it). A
  message longer than the 4,000 characters the agent may write back as a
  brief is built as written rather than rewritten by the agent. A build's
  worst-case input reservation rises from 260,500 to 296,500 characters,
  about 14%; the smallest build a Free account can start on the default
  model now needs $0.86 set aside, from $0.81.

### Resolved 2026-09-30 (night, later)

Chris asked that his GitHub account and profiles be credited as vibld's
builder, and whether the repository should move to his account.

- **D112. The repository stays in the vibld organization.** A public
  commit counts on a GitHub profile when its author email belongs to that
  account, whoever owns the repository; the credit was missing because the
  export authored every public commit as `vibld <hello@vibld.com>`. A
  transfer would have broken the export and release workflows, the GitHub
  App, and the URL the site, README, release notes and posts all use.
- **D113. Chris is named as the builder.** The public export authors each
  commit, and the release workflow tags each release, as Chris Brock under
  his GitHub no-reply address (15268570+cbrock84@users.noreply.github.com),
  so it counts on his profile without publishing a private address; the
  committer stays `vibld`. Past public commits keep their author: rewriting
  them would force-push main and move the v0.2.0 tag. The README, a
  `CITATION.cff`, the root `package.json`, vibld.com's footer and the home
  page's Organization schema (`founder`) name him. The settings only he can
  change are listed in `docs/social-launch.md`.
- **D114. Profiles linked: GitHub only, for now.** Others are added to
  `SITE.founder.sameAs` when Chris gives their URLs.
- **D115. The self-host check runs in the Chris Brock LLC account, under
  prefixed names.** The copy is deployed beside vibld's own, so every name
  must differ from vibld's: `selfhost-web`, `selfhost-preview`,
  `selfhost-publish`, `selfhost-generation` and `selfhost-control-plane`
  (database and bucket), rate-limit namespaces from 5001. Walking the docs
  found that the shipped configuration names vibld's Workers, bucket,
  Workflow, service targets and rate-limit namespaces as well as the values
  the docs listed, and that the docs told a self-hoster to keep the
  database name `vibld-control-plane`: in an account that also ran vibld,
  following them would have replaced vibld's Workers. `scripts/self-host.mjs`
  now writes each Worker's configuration from a settings file and refuses
  one that still names vibld's deployment; the **Self-host check** workflow
  deploys a copy from it in the documented order and checks it signed out.
  Sign-in and a generation need a Clerk instance of the copy's own.
- **D116. The self-host check stops signed out.** It proves the copy
  deploys under its own names and refuses a signed-out caller; sign-in and
  a generation on a copy stay untested outside the project, and the docs
  keep saying so.
- **D117. The `selfhost-*` resources are torn down after the check.** The
  first run (36755192186) passed: the copy served its interface and
  answered `/api/config` signed out with 401. It was torn down by hand; the
  workflow now creates the database and bucket itself and removes
  everything it made at the end, pass or fail
  (`scripts/self-host-resources.mjs`).

### Resolved 2026-09-30 (evening)

- **Codex review of internal PR 333, all three taken.** The rate-limit namespace base
  is now required and may not overlap vibld's own ids, which are
  account-wide; without a preview domain of its own the builder is not
  bound to the publish Worker, so publishing reports itself unavailable
  instead of publishing under `vibld-preview.dev`; and the check tears
  itself down.
- **D118. Cut a release once the docs say what the check proved.**
- **D119. It is v0.3.0, not v0.2.1.** Since v0.2.0 the template catalog
  became something to build from (400+ designs and screens, "Start from
  this template"), which is more than a patch. Notes in
  `docs/releases/v0.3.0.md`; the Public release workflow tags it after the
  export of the merge.
- **D120. US English everywhere people read.** vibld.com and its template
  catalog, the builder, the prompts that shape generated sites, READMEs,
  docs and the launch kit. `scripts/us-english.mjs` rewrites and checks it
  (in `pnpm check:style`), and the catalog importer writes it. Identifiers,
  comments, stored values (`'cancelled'` is a run status in D1), SQL, class
  names, URLs and third-party license files are left alone. The builder's
  dates are en-US.
- **D121. The legal pages get the spelling change and nothing else.** No
  wording, meaning or structure changes.
- **D122. The Reddit launch waits for self-hosting checked end to end.**
  The post leads with open source, so its readers try the self-host path
  first. The Self-host check is extended to sign in on a copy and run one
  real build on it, on Cloudflare and under Docker, before the post goes up.
- **D123. A self-hosted copy needs no sign-in service beyond Cloudflare.**
  Beside Clerk, a copy can sign in with one owner's password
  (`VIBLD_AUTH=owner`) or with Cloudflare Access in front of the builder
  (`VIBLD_AUTH=access`). Chris: "Cloudflare access AND one-owner password
  mode. There should be no dependencies on any paid services." Clerk stays
  for app.vibld.com. There is still no mode without sign-in.
- **D124. A copy can build with a local model.** Ollama, LM Studio or
  llama.cpp through their OpenAI-compatible endpoint, set by the owner as a
  base URL and a model name. Paid keys stay supported. A small model that
  cannot finish a build says so plainly.
- **D125. Without Containers, the preview bundles in the viewer's
  browser.** On Cloudflare's free plan nothing can run npm or Vite, so a
  copy without the sandbox previews with esbuild-wasm in a Web Worker,
  packages from an ES-module CDN and Tailwind compiled in the page. Chris
  chose it over WebContainers, Sandpack and building in GitHub Actions,
  whose facts were put to him.
- **D126. Docker, and the order of the work.** The whole builder runs under
  docker compose with no Cloudflare account: the Workers under workerd with
  local storage, previews in a sibling container. Built in this order, one
  pull request each: sign-in (D123), Docker, local models (D124), the
  in-browser preview (D125), then the end-to-end check (D122). One-click
  deploy templates for hosts that run containers come after Docker.
- **D127. Deployment provider keys are managed in the admin panel.** The
  keys a deployment builds with are set, replaced and removed from the
  panel, stored encrypted in D1 under a key held as a Worker secret, and
  shown only by their last four characters. There are no per-user keys;
  L31 and L45 stand.
- **D128. Platform admin tools, in four pieces.** A list of every account
  (search, filters, sort, CSV export), a deeper account page, a platform
  overview, and model and plan controls. Accounts are recorded in D1 as
  they sign in (migration 0041, which folds in 0040's `access_accounts`),
  backfilled from projects and billing, and importable from Clerk's
  directory by an admin.
- **D129. The admin list stays read-only.** The panel shows who is an
  admin; changing it remains a change to the `VIBLD_PLATFORM_ADMINS`
  secret, which no session can make (L4).
- **D130. The admin tools come before Docker.** Built now, one pull request
  per piece, then the D126 order resumes.
- **D131. A key set in the panel is used ahead of the secret.** Where a
  provider has both a panel key and a Worker secret synced by the deploy,
  the panel's key builds; removing it goes back to the secret.
- **D132. The deploy creates the key-encryption key once.** The deploy
  workflow generates `VIBLD_KEY_ENCRYPTION_KEY` when the Worker has none
  and never replaces it, since a new one would leave every stored key
  unreadable.
- **D133. The panel controls model access per plan and per person.**
  Which models each plan includes, and extra models for one account, are
  set in the panel, stored in D1 and audited. D66 (Free builds with GPT-6
  Luna) is the starting setting; `VIBLD_MODEL_POLICY` applies only until a
  panel policy is saved.
- **D134. Plan limits are editable in the panel.** Active projects and the
  monthly allowance per plan are set in the panel and audited. vibld.com's
  pricing copy is updated by hand to match.
- **D135. A deployment that sells no plans uses the Free plan's models.**
  Once model access is saved in the panel, everybody on a deployment with
  no billing counts as Free, so the panel's Free row decides what they get.
- **D136. A per-person setting adds models to the plan's.** An account gets
  its plan's models plus the extras an admin grants it; removing the extras
  returns it to the plan.
- **D137. Under Docker, previews run on the host's Docker.** The compose
  file mounts the host's Docker socket into the vibld container, so workerd
  starts each preview's and each build check's sandbox as a sibling
  container, the same code path as on Cloudflare. Anything in control of
  the vibld container can control the host's Docker; Chris chose this over
  one shared sandbox container and over no sandbox at all.
- **D138. A local model is set in the environment.** Its base URL and model
  name are `VIBLD_LOCAL_BASE_URL` and `VIBLD_LOCAL_MODEL` (and
  `VIBLD_LOCAL_API_KEY` for a server that wants one): `.env` under Docker,
  Worker variables on Cloudflare, the same place as `VIBLD_PROVIDER` and
  `VIBLD_MODEL`. Chris chose this over the admin panel and over both with
  the panel first.
- **D139. The in-browser preview merges when CI is green.** Codex review
  findings are fixed as they come, but its pull request did not wait for a
  clean Codex review.
- **D140. Not while the live generate check is red.** The pull request
  waited for "Clone, generate with one key, build" to pass on its head.
- **D141. Container hosts run the builder alone, and a VPS runs it all.**
  Hosts that give one container one port and no Docker socket (Render,
  Railway, Fly.io) run the image with `VIBLD_SANDBOX=off`: only the builder
  starts, on `PORT`, previews bundle in the viewer's browser (D125), builds
  are not checked in a sandbox and publishing is off. A separate one-click
  VPS template installs Docker and runs the full compose file, sandbox
  previews included. Chris chose both over either one alone.

### Taken on Chris's behalf, 2026-09-30 overnight, confirmed the same day

Chris asked for the design prompt catalog in Drummond-IT/designs-v1
(`design-prompt-catalog/`, 207 designs) to be folded into vibld's template
catalog and inspiration gallery, keeping entry names, build prompts and the
baseline, merging duplicates, and re-checking every color pair against WCAG
AA. These were decided while he was away. Chris confirmed D83 to D87 on
2026-09-30, and decided D88 as below.

- **D83. Where it lives.** vibld had no template catalog or inspiration
  gallery to extend: two hand-built templates, seven generated examples, 24
  style presets whose picker and tests assume two dozen. So the catalog is its
  own module, `@vibld/ai/design-templates` (generated by
  `packages/ai/bin/import-design-catalog.ts`, kept out of the package index and
  the Worker), shown on vibld.com at `/templates`, `/templates/<id>` and
  `/inspiration`. The style presets are unchanged.
- **D84. Categories.** The catalog's twenty categories map onto vibld.com's
  five use cases: every app is a small tool or app; portfolio, resume and
  music go to portfolio; events to events; landing-page to the SaaS landing
  page; services, ecommerce, blog and editorial to small business. The
  catalog's own category is kept beside it.
- **D85. Duplicates.** Three designs are the same product as one of vibld's
  examples and are shown there rather than listed twice: kasimir-lund
  (illustrator portfolio), paysprout (budget tracker) and makers-forum-26
  (tech conference). The coffee shop ordering site is not the roaster's
  marketing site, so it stays its own entry. No name clashes with any of
  vibld's own names; both test suites check it.
- **D86. Typefaces.** A design keeps the faces it names; where one is not on
  Google Fonts (54 designs: Satoshi, Clash Display, system UI and others), a
  generated project loads a named substitute, and the design page says so.
- **D87. Em-dashes.** The one change to the catalog's words: its 63
  em-dashes, which the house rule bans and the design checks fail in a
  generated project, become `--`, or an en-dash where a design quotes the
  glyph an empty cell shows.
- **D88. Merged, on Chris's decision.** designs-v1 is a private repository
  with no license file, and a merge here is exported to the public,
  Apache-2.0 github.com/vibld/vibld, so the pull request was left unmerged
  for Chris. He decided on 2026-09-30 to merge it, stating that the catalog
  was built clean-room with his other Claude account.

### Resolved 2026-09-30 (later)

**The open-source launch, smallest credible version first.** Chris decided on
2026-09-30 to pause new product work and get the open-source version live
(D79). "Live" means all four of: a clean clone generates a real project with
only a provider key, proven in CI; a validated self-hosting path on
Cloudflare; a tagged v0.1.0 release; and an announcement (D80). They ship in
that order as each is proven, not held for the slowest (D81, "Smallest
credible launch").

**The first bar is met by the command line, not the builder's interface.**
Taken on Chris's behalf on 2026-09-30 while he was away (D82), and
confirmed by him the same day. The builder's interface cannot reach a real model locally: `pnpm
dev` is Vite with nothing serving `/api`, and the Worker's model path needs
sign-in, D1, R2, a Durable Object and a Workflow, none with a local
substitute. The bounded build itself needs only a key, so `pnpm generate`
(the `@vibld/ai` CLI) is the documented local path, and
`.github/workflows/clean-clone.yml` proves it on a fresh anonymous clone of
the public repository each week. A local builder against a real model (L46,
L47) belongs with the self-hosting work.

### Resolved 2026-09-30

**What vibld takes from designs-v1, and how.** Chris decided on 2026-09-30
(D75) to adopt four things from github.com/Drummond-IT/designs-v1: an
animated background layer a build can put behind its hero, a per-element
motion table in the design spec, mood tags on the style presets, and a
background library. The rule for all four: anything from that repository's
upstream library (its `catalog/`, `prompts/` and `assets/`, which the
repository describes as downloaded from a paid layer service and which carry
no license file) is recreated in vibld's own format and structure, never
copied. Its own `layers/` are Chris's clean-room work and are the starting
point for the background layer.

**Moods suggest a style; they never pick one.** Chris decided on 2026-09-30
(D76, "Suggest in the picker"). Each of the 24 style presets carries one to
three of six moods: luxe, calm, technical, organic, playful, brutal
(`PRESET_MOODS` in `packages/ai/src/style-presets.ts`, a record over the id
union, so a preset added without moods does not compile). The style picker
has a row of the six that narrows both groups of chips to the styles
carrying one (the chosen style stays visible, so it can be cleared), and the
styles whose moods the request names are marked with a dashed edge and
listed as "Suggested for your request", at most four, those sharing the most
of the request's moods first. The words that name a mood are a fixed list
matched as whole words (`MOOD_WORDS`); words requests use for something else
("bold", "clean", "modern") are left out. Nothing is chosen for the person,
and a build with no style picked is exactly what it was.

**The background library is drawn in code.** Chris decided on 2026-09-30
(D77, "Code-drawn only"): vibld's backgrounds are its own procedural ones
(shader gradients, particles, grain, flowing lines), recipes in the animated
background layer that take the project's palette, with no video files and no
generation spend. The upstream library's video loops are not used.

**How the animated background layer works** (D75, D77). Four backgrounds
live in `packages/ai/src/backdrops.ts`: AuroraMesh (a WebGL gradient field),
ParticleField (a WebGL point galaxy), GrainBlobs (soft 2D blobs under film
grain) and FlowLines (drifting 2D ribbons). They are templated files, like
the scaffold (D71): the model never plans, writes or edits one, and
`withScaffold` writes `src/components/backdrop/<id>.tsx` into a project
only when one of its files imports it. A request is told they exist only
when it asks for a moving background, by name ("aurora", "particles",
"grain", "flowing lines") or in general ("animated background", "heavy
animation"). Each paints from the project's color tokens, caps the pixel
ratio at 2, pauses off screen and in a hidden tab, draws one still frame
under reduced motion, and keeps a CSS gradient where WebGL is missing. A
canvas loop the model writes itself is held to the same four conventions by
warnings in `checkDesign` (`canvasFindings`), never errors.

### Resolved 2026-09-29 (later)

**Every call taken on Chris's behalf on 2026-09-29 stands.** Chris accepted
all of them the same day: D56 to D62 from the overnight run, and the part of
D66 decided while implementing it. The three not recorded elsewhere here:

- D56: AI crawlers are allowed. vibld.com's `robots.txt` names GPTBot,
  ClaudeBot, PerplexityBot and the other answer-engine crawlers as allowed,
  and the site publishes `llms.txt` and `llms-full.txt`
  (`apps/marketing/scripts/postbuild.ts`).
- D57: app.vibld.com stays out of search. The builder sends
  `noindex, nofollow` and its `robots.txt` says why; only vibld.com is
  meant to rank.
- D58: no competitor is named on vibld.com; its copy describes what
  vibld does.

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

**A build is shown as soon as its code exists, badged until it is
checked.** Chris decided on 2026-09-29 (D69, "show early, badge it"). The
builder used to show a build only when its whole Workflow had finished,
after the verification build and any repair, which added 40 to 90 seconds
to every build and 100 to 250 when a repair ran, although the project had
already been promoted in `assemble`. Now, once the run has settled its
spend, the Workflow records that the promoted revision is being checked (a
`<runId>:verify` stage row, open until the check ends), and the builder is
sent that revision's code at once, through the stream's `progress` events
or `GET /api/runs/:id`. The preview and the code view show it with a badge,
"Checking the build", then "Fixing a problem" while a repair runs; the
badge goes when the check passes. The conversation's summary still lands
when the run settles, and the lifecycle bar stays on "Check" until then. A
project reopened mid-check shows the same code and badge. Billing and
settlement are unchanged: the check is opened after the run's own spend is
settled, and nothing is charged differently.

Decided while implementing it, and Chris's to reverse:

- A build whose code does not build keeps it. The accepted revision in D1
  and R2 is what it always was: the first attempt, or a repair that did not
  fix it. The builder no longer lets it look accepted: the badge says "Does
  not build", the turn in the conversation and the Problems tab say the
  check failed and that it is still the current version, and the agent is
  told the same. Putting the previous revision back instead would be a
  change to what a failed check does to the project.
- A repair's code replaces the first attempt's on screen as soon as the
  repair is promoted, still badged, rather than only when the run ends.
- Stop while only the check is running stops nothing and says so: the
  build is written, promoted and settled, and a Stop at that point never
  terminated anything before either. Stop during a repair terminates it as
  before.
- A build stopped or broken after it promoted its code is handed to the
  builder as that code, badged "Not checked", instead of being reported as
  a failed build while the project held its code. "Not checked" (the build
  service could not judge it) is said in the badge and the conversation
  but is not listed as a problem.
- While the check runs, export, publish and push act on the last finished
  checkpoint, not on the code being checked; a project reopened mid-check
  already has that code as its accepted revision, so there they act on it.
- A deployment with no build service shows nothing early: nothing is
  checked there, so its builds end as they always did.
- A project cannot be deleted while its build is being checked, since a
  repair may still promote into it.

**Vibld writes its own boilerplate; the model writes the page.** Chris
decided on 2026-09-29 (D71, "Template ours only"). A bounded build no longer
asks the model for `package.json`, `index.html`, `vite.config.ts`,
`tsconfig.json`, `src/main.tsx`, `src/lib/utils.ts` or `README.md`: about
16% of a build's visible output, plus the reasoning behind it, went on files
with one right answer, and the tsconfig was where the prompt spent the most
words preventing a build error. `applyBoundedPatch` writes them from
`packages/ai/src/scaffold.ts`: the packages and ranges in `stack.ts`, the
title and description the outline now returns, and every package the
project's files import, declared at the range the outline gave in its new
`dependencies` list, at `stack.ts`'s range for an optional package such as
cmdk, or at `latest` when nobody named one, so a stray import installs
rather than buying a repair. The model still writes `src/styles.css`,
`src/App.tsx` (now a default export, which the templated `main.tsx`
renders), `src/lib/motion.ts`, pages, components and the shadcn/ui
primitives; no shadcn/ui source is vendored. The outline and file-group
prompts replace REQUIRED FILES and the tsconfig paragraph with FILES WRITTEN
FOR YOU, which states the alias, the scripts and each file's exports from
the same constants the templates use; an outline that plans one of these
files anyway has it dropped, and a step that writes one has it discarded. A
follow-up keeps the project's own copies, so a hand edit is not undone. It
changes `package.json` only to add a package a file newly imports, and
`index.html` only when the request renames or re-describes the site: the
outline then gives a new title or description (it is told to repeat the
current ones otherwise), and only the `<title>` text and the meta
description's content are replaced, escaped, leaving the rest of a
hand-edited file as it was. A repair never renames. The
single-response prompt, used only by runs enqueued before bounded builds, is
unchanged. The output still installs and builds with plain npm (ADR-0002):
the eval's stub now takes its configuration from the same templates, so
CI's build of it builds them.

**A repository per project, created or picked.** Chris decided on
2026-09-29 (D72, "Per project, create or pick"). The GitHub connection used
to be one row per account (`github_bindings`, 0005), so every project pushed
to the same repository. The connection is now split in two. The account
keeps the GitHub sign-in (`github_connections`: the login and the App
installation on the person's own account), and each project has its own
repository binding (`github_project_bindings`, keyed by project id, with the
same grant, expiry and revocation rules 0005 had). A project with no
repository offers two choices on its first push: "Create a new repository",
named from the project's name, slugified and editable, private unless
unticked, created on the person's own GitHub account through the App's
installation there; or "Use an existing repository", the existing picker of
repositories the installation reaches and the person can push to. Both go
through the GitHub sign-in, because the user token that can create or list
repositories exists only during that return. A name that is taken comes
back with a free one suggested in the field (`name-2`, `name-3` and so on),
and the picker is offered beside it. Disconnecting a project's repository
touches no other project, even one bound to the same repository;
"Disconnect GitHub" on the account ends every project's binding and the
sign-in. Push history, the last pull request shown for a project and
webhooks work per project: a push records the project it came from, and a
webhook still finds the push by repository and branch.
`0039_github_per_project.sql` moves each existing account binding onto that
account's most recently worked-on project (Chris's is North Star) and leaves
every other project unbound; the old table stays, and nothing reads it.

Export, Publish and Push to GitHub moved into a **Ship** menu in the
project's top bar, beside Share, because a real user could not find them at
the top of the Code tab's file list. They are the same components with the
same rules (the accepted checkpoint only, one publish button per project
keyed by its id). They are no longer in the Code tab, which now says where
they went and, when the list is not the accepted checkpoint, what they act
on. The menu is a button with `aria-expanded` and `aria-controls`, closes on
Escape (returning focus to the button) and on a click outside, and hides its
panel rather than unmounting it, so a publish or push in flight survives
closing it.

Creating a repository needs a GitHub App permission the App did not request
before (L42a lists Contents, Pull requests and Metadata only):
**Repository permissions > Administration: Read and write**, set at
https://github.com/settings/apps/vibld/permissions and then accepted on each
installation. GitHub's `POST /user/repos` accepts only a user access token
and needs that permission; an installation token cannot create a repository
on a personal account at all. Until it is granted, "Create a new repository"
answers that vibld is not allowed to create repositories yet and points at
"Use an existing repository", which works as before. The App check
(`scripts/github-app-verdict.ts`) allows the permission without failing the
deploy and reports whether it is there.

Chris added the permission the same day. The App check after it reported
`administration: write` beside contents, pull requests and metadata, with
both installations on the current permissions, and L42a now lists it.

Decided while implementing it, and Chris's to reverse:

- "Most recently worked-on" for the migration is the later of the project's
  own `updated_at` and its build pointer's (`generation_projects`), the pair
  the project list sorts by, with archived projects ranked last because
  archiving moves `updated_at`. Revoked and expired bindings move in that
  state. An account with a binding and no project keeps its connection and
  binds nothing. The migration was checked against test data only, not
  against the production database.
- Old tabs are not guessed for: a push, preview, bind or disconnect that
  names no project is refused with "reload" rather than sent to the most
  recent project, as publishing does for a page from before projects.
- The same checkpoint pushed from two projects to one repository is one
  push, recorded against the project that pushed it first, because a
  revision is a hash of the files and builds the same branch.
- Deleting a project deletes its binding (the repository stays on GitHub).
  Duplicating or remixing a project does not copy it.
- A created repository is initialized with a README, because a push needs a
  default branch to commit onto. It is bound to the project straight away.
  If the installation on the person's account covers only selected
  repositories, the new one is not added to it by GitHub; the builder then
  says so, with the installation's settings link, instead of binding it.
- Repositories are only created on the person's own account, not on an
  organization, even where the installation there could.
- "Disconnect GitHub" asks for a second click, since every project then has
  to choose its repository again. The locked-out account screen offers the
  same account-wide disconnect instead of one repository.
- Returning from GitHub opens the Ship menu when the trip started there; a
  trip started from the settings panel answers there, as before.

**Admins can gift a plan, ban, delete and override one account, and every
admin action is logged.** Chris decided on 2026-09-29 (D73). Each account
has an admin page, `/admin/users/<Clerk user id>`, opened by email from the
admin page: identity, plan and whether it is gifted, projects with their
sites, spend this month and credit, recent runs with how each ended, ban
state, and every admin action taken on it. The routes are
`/api/admin/user/{detail,gift,gift/revoke,overrides,ban,unban,delete}` and
`/api/admin/audit`, all behind `requireAdmin`; the state is in D1
(`0038_admin_controls.sql`: `plan_gifts`, `user_overrides`, `user_bans`,
`admin_audit_log`).

- **Gift.** A Build or Ship tier with an optional last day and no Stripe
  charge. `planOf` in `spendable.ts` is now the one reading of the tier, so
  a gift counts wherever a subscription did: the models (`tierOf`), the
  monthly allowance (`spendableFor`), the active-project limit and the
  billing panel, which says the plan is gifted and until when. Revocable.
- **Ban.** Written to D1 first, so `principal.ts` refuses every
  authenticated request from the account with 403 `account-banned` even on
  a live session; then Clerk is asked to ban the user (Backend API
  `POST /v1/users/{id}/ban`, with `CLERK_SECRET_KEY`), running builds are
  stopped by the same steps as Stop (`stopBuild` in `run-control.ts`), the
  account's preview and share-link previews are stopped, and each live
  site is held by the operator hold. Who and why are recorded.
- **Delete.** The existing account deletion (L32), asked for by an admin,
  who types the account's email to confirm; the Worker checks it against
  Clerk. No second deletion path.
- **Overrides.** A per-account active-project limit and monthly spend cap,
  taking precedence over the tier's wherever those are read.
- **Audit log.** One append-only row per admin action: gift, revoke,
  overrides, ban, unban, delete, and the older credit grant, suspension
  lift, site hold and release, and share-link hold and release. Shown on
  the account page and, most recent first, on the admin page.

Decided while implementing it, and Chris's to reverse:

- A gift and a subscription: the account has the higher of the two while
  the gift is in force. A gift at or below what the account pays for
  changes nothing, but the billing panel still mentions it. Giving a new
  gift revokes the one before it rather than stacking. A last day typed as
  a date means through the end of that day, UTC.
- The billing panel offers "Cancel plan" only where there is a real
  subscription, and still offers "Upgrade" only to an account whose
  effective tier is Free, so a gifted Build account is not offered Ship.
- On a deployment that sells no plans (billing not configured), a gift
  changes no models, as a subscription would not.
- Overrides replace the tier's figure in both directions, above a gift or
  subscription as well as below. The spend cap replaces the monthly
  allowance only: top-up credit is still spendable on top, and a
  suspension still refuses everything. The limits are 0 to 1,000 projects
  and $0 to $10,000; "no limit" is not an override value. The project-limit
  refusal still reads "A free account can have N active projects" when N is
  an override.
- A ban refuses every route, the deletion routes and the billing portal
  included, and needs a reason; the person is told they are banned and to
  email support@vibld.com, not the reason. It does not cancel a Stripe
  subscription, revoke the GitHub grant or delete anything. The account's
  share links stop serving with it and, never having been held, serve
  again when it is lifted. Each effect is attempted and reported on its
  own; banning again retries the ones that failed. The ban adds one D1 read
  to every authenticated request, made alongside the deletion check, and
  fails closed like it.
- Unban lifts the Clerk ban and the refusal and does not republish the
  sites the ban held: the page names them, and each is released from Site
  takedown.
- An admin's deletion keeps L32's 30 days, and the owner can still keep the
  account by signing in before the purge unless it is also banned; the page
  says so. The sites are held by the operator hold, since only the owner may
  use the owner's takedown (ADR-0013).
- Nothing stops an admin banning or deleting their own account or another
  admin's.
- Invites, invite revocations and the read-only lookups are not in the audit
  log: D73 did not list them, and an invite's subject is an email address.
  The log stores the acting admin's email, as `billing_admin_credits` does,
  and never the target's email or a share token (a share-link hold records
  `project:<id>`). The older actions' rows are written once the action has
  succeeded; if the row cannot be written the action stands and the answer
  says `audited: false`. The new actions write the change and its row in
  one batch.
- The log is append-only in D1 itself: triggers refuse a delete and any
  update except to `target_user_id`, which the account purge re-keys to the
  tombstone. Rows are kept after the purge, with no 12-month expiry. The
  purge deletes an account's gifts, overrides and ban.

**A running preview takes a new revision in place, and its image starts
warm.** Chris decided on 2026-09-29 (D74, "Live-update + warm image").
Seeing a change in the preview took a minute or two every time. A running
preview could not take new files, so after a follow-up was accepted the
panel said the sandbox was serving an older checkpoint and asked for a
restart, and a restart destroyed the container and paid again for a cold
`npm install`, a typecheck and a dev-server start; a first preview measured
about 126 seconds end to end in production. Now, when a new revision
arrives (an accepted checkpoint, or a D69 build shown early while it is
checked) and a preview of the same project is running, the builder sends it
to the preview with `PATCH /api/preview`, which apps/web passes to
`@vibld/preview`'s `/internal/preview/update` (`PreviewSandbox.updatePreview`,
`apps/preview/worker/live-update.ts`). The sandbox keeps a digest of every
file it was given, writes only the files that are new or changed, removes
the ones that are gone, and Vite's watcher reloads the page. When
package.json's dependency fields or the lockfile changed, the manifests go
in first, `npm install` runs under the `installing` phase (bounded like a
first start's install and by what is left of the preview's lifetime), the
other files follow, and the dev server alone is restarted. The preview
records which revision it serves, so the "older checkpoint" notice goes
once an update lands; while one is on its way the panel says "Updating
preview…" and the tab badge says "updating". What the sandbox cannot do in
place (the dev server gone, an update that broke off, a preview expired or
not running, a failed install) comes back as a restart with a reason, and
the builder restarts as it did before and says why beside the preview.
Restart stays on offer. Fleet tickets, the hard lifetime, internal PR 307's
lost-start settling, the media allowlist and the egress allowlist all hold
across an update, and every path is checked against /workspace again inside
the sandbox.

The image now carries the generation stack already installed
(`apps/preview/Dockerfile`, from `apps/preview/warm/package.json`, which
`packages/ai/test/preview-warm-cache.test.ts` keeps equal to
`packages/ai/src/stack.ts`). A start moves that node_modules into the
project before its `npm install`, which then only reconciles it with the
project's package.json: anything beyond the stack comes from the registry
as before, under the same egress allowlist, and `npm prune` removes what
the project does not declare. Of the two options D74 named, this one and
not a warmed npm cache, on measurement at the container's size (a quarter
of a CPU, 1 GiB, a scaffolded project): a cold install took about 111
seconds, one from a warm cache 87 to 98, and one from the installed stack
13 to 27, prune included (61 with an extra package that brings 38 more,
against 146 cold). The install's time goes on unpacking and writing packages, which
a cache does not save, and a cache is also the heavier of the two: npm keeps
every package document it reads, 277 MB of them for this stack against 38 MB
of tarballs. The image grows from 228 MB to 267 MB compressed (864 MB to
1.08 GB unpacked); the warm cache alone had made it 308 MB. Each step is
logged as `preview.step` (a start adds `seed` and `prune`; an update logs
`update-probe`, `update-install`, `update-prune`, `update-write`,
`update-dev-server` and `update-typecheck`, then `preview.updated` with its
total), so the speed-up can be read from the Worker's logs.

Decided while implementing it, and Chris's to reverse:

- After an install of new dependencies the dev server is restarted (not
  the container). Vite pre-bundles dependencies when it starts and serves
  that bundle until it restarts, so a changed version would otherwise go
  on being served; the restart is seconds, not the minutes a container's
  was.
- A package.json change that no install reads (the name, a script) is
  written without an install and without a dev-server restart, so a
  changed `dev` script reaches the preview only on the next restart.
- A dependency install that fails ends the preview as a failed start does
  (fleet slot given back, container destroyed), and the builder restarts
  it; the restart's own install then shows npm's error as before.
- An update that stops part way leaves the preview running but stops it
  claiming either revision, and refuses further updates in place, so the
  next one is a restart.
- An update that needs an install is refused (a restart) when less than a
  minute of the preview's thirty remains, because a restart begins a new
  lifetime.
- While new dependencies install, the preview's phase is `installing`, so
  a share link to it answers "no longer running" until the install ends.
- The project's own typecheck runs again after each update and replaces the
  finding shown with the preview.
- A preview started before this change has no record of its files and is
  restarted on its first update.
- `PATCH /api/preview` is behind the invite gate, as starting a preview is.
- Updating is automatic, with no setting to turn it off.
- The installed stack is moved, not copied, into the project, since a
  container runs one preview; on a filesystem where that move is a copy
  (as it was in the measurement) it took 5 to 19 seconds of the total.
- These numbers come from Docker with the container's CPU and memory
  limits, not from Cloudflare; production's are for the Worker logs to
  say.
- A failed seed is cleaned up and the start installs as it used to; a
  failed prune is logged and the preview starts anyway, since the build's
  clean install still refuses an undeclared package.
- The image's stack is resolved from `stack.ts`'s caret ranges when the
  image is built, with no lockfile, so a preview keeps the patch versions
  of its image until the image is redeployed, while a build resolves the
  newest. Changing `stack.ts` now also needs the sandbox service
  redeployed to reach previews.
- The build path is unchanged: it still installs from nothing, online, so
  it goes on measuring what a clean machine resolves.
- Installs run with `--prefer-offline` (a live update's install reuses what
  the start fetched minutes before) and retry once online when that cache
  was stale (ETARGET).

**The file-writing steps stay at their default effort.** Chris decided on
2026-09-29 (D70, "Adopt if no worse"): the file-writing steps of a bounded
build would run at `low` effort only if, over the bakeoff, both the pass
rate (accepted after one repair) and the repair rate (the share of runs
that needed a repair) came within 2 points of the default; the outline
stays at its default either way. Measured with `bakeoff.yml`'s
`write_effort` input on `gpt-6-luna`, nine cases (coffee-roaster,
security-saas, dental-practice, freelance-portfolio, vibld-marketing,
pottery-booking, budget-tracker, recipe-box, conference), two runs each per
arm, prompt set 1.8.0:

|                                   |       Default |         `low` |
| --------------------------------- | ------------: | ------------: |
| Accepted as generated             |         17/18 |         14/18 |
| Accepted after one repair         | 17/18 (94.4%) | 17/18 (94.4%) |
| Needed a repair                   |     0/18 (0%) |  3/18 (16.7%) |
| Spend, generation and repair      |         39.6c |         30.1c |
| Generation, wall time for 18 runs |        80 min |        51 min |

The pass rates are equal, and the repair rate is 16.7 points worse, so D70
is not adopted and production is unchanged: nothing sets `writeEffort`.
The one rejection in each arm was the same failure, freelance-portfolio's
copy never saying "portfolio". The `low` arm cost 24% less, its repairs
included, and generated in 37% less time; the rule weighs repairs on their
own because each one adds a second build and a model call to that user's
wait. The plumbing from internal PR 309 stays (`BoundedBuilder`'s `writeEffort`,
`VIBLD_WRITE_EFFORT` in `packages/eval`, the bakeoff's `write_effort`
input), so the question can be asked again of another model or prompt set.
Runs: default 36624066946, 36632453312, 36638630804; `low` 36624075815,
36632487854, 36638633452.

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
accepted, failed or canceled. A page whose stream drops does the same
instead of reporting a failure. A stage the engine left unended is settled
when the build is next asked after or its project opened.

**A build the caller cannot fully fund starts smaller instead of being
refused.** Taken overnight on 2026-09-29 on Chris's behalf, while he was
away, after an end-to-end test found that internal PR 292 had locked every Free account
out of the default model; Chris accepted it the same day (D59). A build on GPT-6 Sol
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
have charged.** Taken overnight on 2026-09-29 on Chris's behalf; Chris accepted it the same
day (D60). Stop terminates the Workflow before its settle step, so a
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
overnight on 2026-09-29 on Chris's behalf; Chris accepted it the same day (D61). "This
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
2026-09-29 on Chris's behalf; Chris accepted it the same day (D62). A turn the builder
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
bought; that part was decided while implementing, and Chris accepted it the same day.

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
seconds. A write is sent again only when the 429 is Cloudflare's own page,
which the edge answers before the request reaches the Worker, so the write
never happened; the run after the read retry shipped (36593518869) had the
project list load and the project's creation refused that way. The Worker's
own 429s are JSON, and a write they refuse is never sent again, nor is one
whose body cannot be sent twice.

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
a person replies within 14 days; annual plans can be canceled at any time
for a prorated refund of the unused whole months, canceling in the billing
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
the billing address, and canceling in the portal alone stops renewal with
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
subscription is canceled at once with no proration, its preview stopped,
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
Chris confirmed on 2026-09-28 that a subscription is canceled with no
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
decisions: monthly plans are not refunded; annual plans can be canceled at
any time for a prorated refund of unused whole months, which an operator
issues as a partial refund in Stripe; top-ups are never refunded; and
canceling from the billing portal takes effect at the end of the paid
period. See `apps/web/README.md`, "Refunds and disputes".

**Canceling a monthly plan offers 50% off one month, once; an annual plan
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
build runs, instead of an empty or waiting state, labeled "Draft, building
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
it once the live preview has run; a failed or canceled build drops the
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

Already the shipped behavior, which is why this changed no code:
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
the pattern catalog and unblocks step 3 of its build order. Wire it into
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
Build direction for vibld.com and asked for its colors everywhere rather than
on the marketing site alone: vermilion (`#ff4a1c`) on graphite and chalk,
replacing coral and ultramarine on newsprint. The chevron and its
out-of-register second impression stay; only the inks change, so BRAND-01's
entity signal (one mark, one color, on every surface) survives the change of
color. `packages/brand` is still the one place a color is decided, and
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
charged for a month they cannot sign in to. Canceling at period end is the
only option that is wrong in neither direction: they keep what they already
paid for, nothing is charged for time they cannot use, and there is no refund
to process. Reinstating before the period ends puts it back, and that is a
path that had to be built rather than a property of the flag: the first
version of this scheduled the cancellation and nothing ever cleared it, so
re-inviting somebody restored their access and Stripe ended their
subscription anyway. Restoring only ever clears a cancellation this
deployment made, so a subscriber who canceled for themselves keeps their
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

**L39 -- model catalog growth (standing note, not a one-time decision).** Confirmed: no hosted BYOK (per L45), and new providers get added to the catalog as they ship (starting point named: an OpenAI-family model). Governs how `model-catalogue.ts` grows going forward.

## Generation pattern/style/SEO catalog (scoped 2026-09-09)

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
