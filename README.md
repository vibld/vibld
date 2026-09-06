# Vibld

**Vibe. Build. Ship.**

Vibld is an open-source AI application builder for creating, editing, and shipping real web applications from natural language.

The project is founded on a simple rule: **the application belongs to the user, not to Vibld**. Generated applications should be conventional, portable software projects that keep working without Vibld or Vibld Cloud.

## Status

Vibld is in Phase 0: Foundation. The repository currently captures the product boundary, architecture direction, governance, and workspace conventions. Product implementation begins with M1: Hello Vibld.

## The first loop

The MVP will prove one workflow:

> Describe → Plan → Build → Preview → Modify → Git

The first implementation milestone is intentionally narrower:

> Prompt → generated files → runnable React application → live preview

## Principles

- Users own and can export their code.
- Git is the canonical project history.
- The open-source core does not require Vibld Cloud.
- AI, sandbox, database, authentication, and deployment providers are replaceable.
- Generated code is conventional, readable, and minimally dependent on Vibld.
- Significant changes are explained before they are applied.
- AI edits preserve user work through targeted, Git-aware patches.
- Generated code runs as untrusted code inside an isolated sandbox.
- Complexity is progressive: approachable by default, inspectable throughout.

See [VIBLD.md](VIBLD.md) for the product and architecture charter and [ROADMAP.md](ROADMAP.md) for milestone scope.

## Repository layout

```text
apps/           Product applications (web and API)
packages/       Reusable domain and platform packages
examples/       Generated-app fixtures and demonstrations
docs/adr/       Architecture decision records
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
pnpm install
pnpm format:check
```

Build, lint, type-check, and test commands are wired through Turborepo. They become meaningful as workspaces are introduced.

## Contributing

Vibld is early and its interfaces will change. Read [CONTRIBUTING.md](CONTRIBUTING.md), review the accepted [architecture decisions](docs/adr/README.md), and start with a scoped issue.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
