# Vibld

**Vibe. Build. Ship.**

Vibld is an open-source AI application builder for creating, editing, and shipping real web applications from natural language.

Generated applications should be conventional, portable software projects that keep working without Vibld or Vibld Cloud. Users can inspect and export the complete project, subject to its third-party license obligations.

## Status

Vibld is in Phase 0: Foundation. This repository contains documentation and workspace configuration, not a runnable builder. M0 quality enforcement remains work to do. The [accepted decisions D1-D30](docs/decisions.md) define an invitation-only, Cloudflare-first hosted alpha for technical founders and small agencies creating marketing sites.

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

Directories contain short READMEs until their implementation milestone begins. This keeps Phase 0 explicit without creating speculative packages.

## Development

Prerequisites:

- Node.js 22 or newer
- pnpm

```bash
pnpm install --frozen-lockfile
pnpm format:check
```

Build, lint, type-check, and test commands are wired through Turborepo, but currently run no workspace tasks. A green `pnpm check` is not product validation. [Issue #2](https://github.com/vibld/vibld/issues/2) tracks enforced checks before feature code.

## Contributing

Vibld is early and its interfaces will change. Read [CONTRIBUTING.md](CONTRIBUTING.md), review the accepted [architecture decisions](docs/adr/README.md), and start with a scoped issue.

## License

The core is licensed under Apache-2.0. See [LICENSE](LICENSE). Future reusable starter-template source will carry an explicit MIT license at its own boundary; this does not relicense existing core files. See [ADR-0008](docs/adr/0008-portable-marketing-site-template.md).
