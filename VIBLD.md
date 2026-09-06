# Vibld Charter

This document is the product and technical compass for Vibld. The [accepted decisions](docs/decisions.md) and [ADRs](docs/adr/README.md) specify the current direction. The [original blueprint](docs/archive/README.md) preserves historical proposals. Capabilities below are requirements until implemented and verified.

## Product thesis

Vibld is the open application-building layer for AI-assisted software development. It turns natural-language intent into real, editable, portable web applications while giving nontechnical builders a clear path from idea to working software and developers full access to code, tools, and history.

Start with technical founders and small agencies creating marketing sites and landing pages. Expand to nontechnical owners, developers working in existing repositories, designers and marketing users, and other demonstrated use cases. Preserve adaptable project, ownership and provider boundaries without building every audience's features in M1.

## Product promise

Users control and can export their projects. A generated project must remain a normal application that can be cloned, edited, built, and deployed without Vibld. Optional `.vibld/` metadata can improve the experience, but deleting it must not break the application. Third-party licenses still apply; Vibld does not guarantee exclusive ownership of arbitrary generated content.

## MVP

The MVP proves this loop well:

1. A user describes an application.
2. Vibld forms and explains a structured plan.
3. Vibld generates a conventional React application.
4. An isolated sandbox installs and runs it.
5. The user sees a live preview and validation results.
6. The user requests a change.
7. Vibld applies a targeted patch and repairs failures.
8. The resulting changes appear as meaningful Git diffs and commits.

M1 delivers the initial build, private preview, bounded repair, durable checkpoint and export as an invitation-only hosted alpha. GitHub branches/PRs and repository indexing are included early. M2 completes the conversational editing loop.

The first generated-application standard is React Router framework mode with static prerendering, React, TypeScript, Vite and Tailwind CSS. Add selected shadcn/ui, Radix primitives or Lucide icons where useful. Generated projects support familiar install, development, build, lint, typecheck and test commands. Validate crawlable route HTML, page metadata, responsive behavior and accessibility alongside the build. The separate builder UI uses React/TypeScript/Vite as a SPA.

## Architecture boundaries

Vibld separates policy from providers:

- `core` owns project models and orchestration contracts.
- `agent` owns planning and controlled tool use.
- `ai` adapts model providers and streaming responses.
- `sandbox` adapts untrusted execution environments.
- `preview` owns lifecycle and preview event contracts.
- `git` owns repository operations and change representation.
- `templates` owns versioned generated-app foundations.
- `editor` and `ui` serve user-facing applications without becoming required runtimes for exported projects.

Boundaries are conceptual until code proves they deserve packages. Provider-specific SDK types must not leak into domain contracts.

The hosted platform uses Hono on Cloudflare Workers, Workflows for persisted generation stages, Cloudflare Sandbox SDK for untrusted execution, Supabase PostgreSQL/Auth, Hyperdrive SQL connections and R2 project objects/assets. Use Durable Objects for coordination where needed. AI SDK sits behind Vibld-owned model contracts; evaluation determines the initial provider. Sandboxes are disposable and never the only copy of accepted project history.

Stage edits against a known base revision, validate, then promote under a single project writer and revision check. Git is accepted code history; PostgreSQL records ownership/run state and references durable project objects. Remote GitHub is an optional sync destination, not a prerequisite for saving a project. Indexes must match the authorized project revision.

## Safety and trust

Generated and dependency code is untrusted. It must not receive control-plane credentials. Trusted services broker privileged operations; narrow runtime injection is an exception for integrations that require it. Apply filesystem and outbound-network policy from the first hosted slice. Begin with curated dependencies. Keep secrets out of Git, telemetry, workflow payloads and model context.

The service enforces project/action/destination/budget/expiry grants for each autonomy mode. Models cannot expand their own permissions. Hosted previews are private, origin-isolated and shareable only through explicit expiring grants. M1 needs tenant-isolation, bypass, cancellation, restore and budget tests before inviting users.

AI actions should be inspectable. Plans, relevant files, patches, validation failures, and recovery actions need representations that both the interface and logs can explain.

## Open source and cloud

The open-source project should contain the complete single-user building experience, project saving, provider adapters, project format, Git, BYOK, export and basic deployment capabilities. Vibld Cloud may charge for managed operations, hosted compute/AI, collaboration and teams. Basic persistence is not an artificial paid gate. Cloud features must not impose a Vibld runtime on exported applications.

Initial execution is Cloudflare-first. Self-hosting and an alternate execution path still require implementation and verification; the repository does not yet contain a runnable builder. Operational telemetry will be on by default with opt-out, documented fields/retention and no source code or prompts in the default analytics stream. Required security/accounting records need a separate disclosed policy.

The core stays Apache-2.0. Reusable starter-template source will carry MIT at its own boundary, with upstream notices preserved and users choosing their application license. See [ADR-0008](docs/adr/0008-portable-marketing-site-template.md).

## Out of scope for the MVP

Multiplayer collaboration, enterprise SSO, a marketplace, native mobile generation, a full visual editor, proprietary database or auth platforms, team billing, custom domains, and production observability must not delay the core loop.
