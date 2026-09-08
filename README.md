# Vibld

**Vibe. Build. Ship.**

Vibld is an open-source AI application builder for creating, editing, and shipping real web applications from natural language.

Generated applications should be conventional, portable software projects that keep working without Vibld or Vibld Cloud. Users can inspect and export the complete project, subject to its third-party license obligations.

## Status

Vibld is early, and the honest summary is narrower than the ambition above.

**What runs today.** `apps/web` is a builder shell that takes a prompt through planning, staged files, validation and an accepted checkpoint, and shows a preview of the result. `packages/core` owns the generation contracts, the state machine and the run budget; `packages/ai` puts a model provider behind them. A hosted deployment can serve model-backed generation through an authenticated endpoint.

**What does not exist yet.** Sandboxed execution of generated code, durable project storage, accounts and tenant isolation, GitHub branches and pull requests, repository search, permission grants and spend ceilings. Without those the builder is a demonstration of the loop, not a product anyone should trust with their work. By default it runs a deterministic fake provider, so nothing here implies a model wrote what you see.

The [accepted decisions D1-D30](docs/decisions.md) define an invitation-only, Cloudflare-first hosted alpha for technical founders and small agencies creating marketing sites.

## The first loop

The MVP will prove one workflow:

> Describe, plan, build, preview, modify, and preserve changes in Git.

M1: Hello Vibld covers:

> Prompt, prerendered React site, private working preview, bounded repair, saved checkpoint, and portable export.

Hosted identity, tenant isolation, GitHub branches/PRs, repository search, permissions and budgets are part of M1. M2 adds dependable conversational editing. See the [implementation plan](docs/implementation-plan.md) for sequencing and release gates.

## Principles

- Users own and can export their code.
- Git is the canonical project history.
- The complete single-user OSS builder must work without Vibld Cloud; its alternate runtime and self-hosting path still need validation.
- AI, sandbox, database, authentication, and deployment providers are replaceable.
- Generated code is conventional, readable, and minimally dependent on Vibld.
- Significant changes are explained before they are applied.
- AI edits preserve user work through targeted, Git-aware patches.
- Generated code runs as untrusted code inside an isolated sandbox.
- Complexity is progressive: approachable by default, inspectable throughout.

See [VIBLD.md](VIBLD.md) for the product and architecture charter, [ROADMAP.md](ROADMAP.md) for milestone scope, and the [archived blueprint](docs/archive/README.md) for the original proposal.

## Repository layout

```text
apps/           Product applications (web and API)
packages/       Reusable domain and platform packages
examples/       Generated-app fixtures and demonstrations
docs/           Decisions, implementation plan, ADRs and blueprint archive
infrastructure/ Deployment and runtime configuration
scripts/        Repository automation
tests/          Cross-package and end-to-end tests
```

Directories that have not reached their implementation milestone contain a short README rather than a speculative package.

## Development

Prerequisites:

- Node.js 22 or newer
- pnpm

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm check        # lint, type-check and test every workspace
```

Format, type and test checks run for real across `packages/core`, `packages/ai` and `apps/web`, and CI runs them on every pull request alongside CodeQL. A green `pnpm check` still is not product validation: it says the code compiles and its unit tests pass, not that a generated site is any good. [Issue #2](https://github.com/vibld/vibld/issues/2) tracks what is still missing — human-review and DCO enforcement through repository protections.

## Contributing

Vibld is early and its interfaces will change. Read [CONTRIBUTING.md](CONTRIBUTING.md), review the accepted [architecture decisions](docs/adr/README.md), and start with a scoped issue.

## License

The core is licensed under Apache-2.0. See [LICENSE](LICENSE). Future reusable starter-template source will carry an explicit MIT license at its own boundary; this does not relicense existing core files. See [ADR-0008](docs/adr/0008-portable-marketing-site-template.md).
