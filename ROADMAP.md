# Roadmap

The roadmap describes outcomes, not delivery dates. It follows the [accepted decisions D1-D30](docs/decisions.md). The [implementation plan](docs/implementation-plan.md) orders the work and records release gates. GitHub milestones and issues hold execution status.

## M0: Foundation

Goal: establish the minimum enforced baseline before feature implementation.

- Product and technical charter
- Apache-2.0 licensing and governance
- Architecture decision process and initial decisions
- pnpm, Turborepo, and TypeScript workspace
- Repository quality baseline and contributor documentation
- Development and validation conventions
- Accepted decision register and preserved original blueprint
- DCO sign-off, named ownership and human review
- Verified private security-reporting route

Exit criterion: a contributor can install the locked workspace, run meaningful checks for the files present and begin a scoped M1 task using documented decisions. Quality enforcement and private reporting must be verified, not just described. Brand work and community templates are deferred under D28.

Track: [M0 milestone](https://github.com/vibld/vibld/milestone/1) and [foundation tracker](https://github.com/vibld/vibld/issues/1).

## M1: Hello Vibld

Goal: an invited user turns a prompt into a portable marketing site with a private working preview, a saved checkpoint and export.

- Hosted builder UI and API with invitation-only identity and tenant authorization
- Structured plan and generation contracts
- AI SDK adapter and measured initial model selection
- Versioned React Router/TypeScript marketing template with static prerendering
- Cloudflare Sandbox execution with curated dependencies and network/resource policy
- Preview lifecycle and streamed status
- Durable workflow, staged changes and bounded initial repair
- PostgreSQL metadata and durable R2 project objects with restore/export checks
- Scoped autonomy permissions and broker-first credentials
- GitHub connection, branches and PRs for Vibld-generated projects
- Revision-scoped repository indexing and semantic search
- Build, type, browser, accessibility, SEO and portability validation
- Explicit run budgets, privacy-conscious operational telemetry and cleanup

Exit criterion: the versioned evaluation suite meets its documented target, accepted exports build outside Vibld, and recovery, tenant-isolation, preview-access and budget tests pass. M1 is a hosted technical alpha. A working preview alone does not close this milestone.

Track: [M1 milestone](https://github.com/vibld/vibld/milestone/2) and [Hello Vibld tracker](https://github.com/vibld/vibld/issues/4).

## M2: Reliable iteration

Conversation-driven changes to saved projects, persistent conversation history, targeted patches, regression checks, visible repair/recovery, change summaries and rollback. Reuse the M1 writer, indexing and checkpoint boundaries. M1 plus M2 proves the first usable build/edit loop. Validate a non-Cloudflare execution path and self-hosting instructions before claiming a complete independent OSS builder.

## M3: Publish

Ship to an approved Cloudflare target, with deployment status, logs, rollback and environment/secret handling behind an adapter. Verify an independent static-hosting path. GitHub branch and PR support is already part of M1; broader existing-repository workflows follow as scoped developer use cases.

## M4: One full-stack integration

Evaluate Supabase first for generated-app data, auth and storage. Keep customer application resources and credentials separate from Vibld platform resources. Deliver one complete flow with migrations, environment setup, authorization tests and export instructions before expanding providers.

## M5: Visual iteration

Element selection, source mapping, text/style changes and responsive inspection. Changes continue to modify portable source code and use the validated patch workflow.

## Later: Broader use cases and managed teams

Expand to business apps, existing-repository editing, designers/marketing workflows and other demonstrated needs. Add templates, runtime/provider adapters and CLI/SDK capabilities when justified. Teams, collaboration, billing and advanced operations follow product evidence. Hosted accounts and project persistence are M1 capabilities, not a future standalone Cloud milestone.

## Not on the critical path

Marketplace, native mobile generation, enterprise governance, Figma import, AI image generation, extensive branding and a full Webflow-style editor remain deferred. Milestone numbers in the archived blueprint and initial repository plan are historical; use this sequence for new work.
