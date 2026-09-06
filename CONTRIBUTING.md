# Contributing to Vibld

Thank you for helping build Vibld. The project is in an early architectural stage, so small, reviewable contributions are especially valuable.

## Before starting

1. Search existing issues and architecture decision records.
2. Open or claim an issue before substantial work.
3. Discuss changes to public contracts, package boundaries, security assumptions, or generated-project conventions before implementation.

## Development setup

Install Node.js 22 or newer and pnpm, then run:

```bash
pnpm install
pnpm check
```

Some commands are intentionally no-ops until the first application packages land.

## Working agreements

- Keep changes scoped to one concern.
- Add tests for behavior, not implementation detail.
- Preserve portability: generated apps must not require Vibld to run.
- Keep provider-specific behavior behind adapters.
- Never commit secrets, credentials, or private user content.
- Record significant, hard-to-reverse decisions as ADRs.
- Update documentation when behavior or public contracts change.

## Commits and pull requests

Use clear imperative commit subjects. Pull requests should explain the problem, the chosen approach, validation performed, and any follow-up work. Link the relevant issue and ADR where applicable.

Maintainers may ask that a broad contribution be split into smaller changes. Early alignment is encouraged for architectural work.

## Architecture decisions

Copy `docs/adr/0000-template.md`, assign the next number, and submit the ADR with the change it governs. Accepted ADRs are immutable; supersede one with a new ADR rather than rewriting history.

## Conduct

Be respectful, specific, and generous in technical discussion. A formal code of conduct will be adopted before broader community launch.

## License

By contributing, you agree that your contributions are licensed under the Apache License 2.0.
