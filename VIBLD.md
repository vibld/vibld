# Vibld Charter

This document is the durable product and technical compass for Vibld. Architecture decisions may refine it, but changes to these principles should be deliberate and public.

## Product thesis

Vibld is the open application-building layer for AI-assisted software development. It turns natural-language intent into real, editable, portable web applications while giving nontechnical builders a clear path from idea to working software and developers full access to code, tools, and history.

Vibld is not merely an open-source copy of a hosted AI builder. Its purpose is to make AI-assisted building interoperable: across model providers, execution environments, source-control hosts, data services, and deployment targets.

## Product promise

The application belongs to the user. A generated project must remain a normal application that can be cloned, edited, built, and deployed without Vibld. Optional `.vibld/` metadata can improve the experience, but deleting it must not break the application.

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

The first generated-application standard is React, TypeScript, Vite, Tailwind CSS, shadcn/ui, Radix primitives where useful, and Lucide icons. Generated projects should support install, development, build, lint, and TypeScript validation with familiar commands.

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

## Safety and trust

Generated and dependency code is untrusted. It must not receive control-plane credentials. Secrets are injected at runtime, never committed, and not added to model context by surprise. Dependency and static checks are part of generation, not an afterthought. Network and filesystem capabilities should become policy-controlled as the sandbox matures.

AI actions should be inspectable. Plans, relevant files, patches, validation failures, and recovery actions need representations that both the interface and logs can explain.

## Open source and cloud

The open-source project should contain the complete local building experience, provider adapters, project format, Git workflow, and basic deployment capabilities. Vibld Cloud may provide managed sandboxes, persistence, collaboration, hosted AI, billing, secrets, and operational convenience. Cloud features must not make exported applications proprietary.

## Out of scope for the MVP

Multiplayer collaboration, enterprise SSO, a marketplace, native mobile generation, a full visual editor, proprietary database or auth platforms, team billing, custom domains, and production observability must not delay the core loop.
