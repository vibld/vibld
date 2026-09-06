# Accepted product and architecture decisions

Decision owner: Chris Brock. Accepted: 2026-09-06.

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

## Scale without speculative implementation

Use explicit owner/tenant, project type, template version and provider capability fields where the first slice needs them. Keep permissions and quotas out of model prompts and provider-specific objects out of core contracts. Add packages only when actual callers justify a boundary. Do not build enterprise roles, arbitrary imports, every template family or a universal plugin system in M1.

## Details still to resolve during implementation

These details do not reopen D1-D30. Record choices in the implementing issue or a new ADR when they affect a durable boundary.

- Select model and embedding providers using measured results and an approved spending cap.
- Confirm Cloudflare account access, Sandbox availability and limits, deployment region, Supabase region/tier and backup requirements before provisioning.
- Choose credential encryption/key management, including rotation, recovery and deletion. Cloudflare account secrets alone do not constitute a complete user-secret vault.
- Choose and verify preview domain isolation, session transport and sharing rules before exposing untrusted previews.
- Set numeric per-run and account caps, telemetry fields/retention, and data deletion/backup retention before admitting alpha users.
- Calibrate evaluation thresholds from the first baseline; proposed numbers in the implementation plan are engineering targets, not a reliability guarantee.
- Validate an alternate execution path and self-hosting instructions before claiming a working Cloudflare-independent OSS builder.

Acceptance of architecture does not authorize purchases, production deployment, public access changes or unlimited paid model runs.
