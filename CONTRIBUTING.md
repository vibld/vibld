# Contributing to Vibld

Thank you for helping build Vibld. The project is in an early architectural stage, so small, reviewable contributions are especially valuable.

## Before starting

1. Search existing issues and architecture decision records.
2. Open or claim an issue before substantial work.
3. Discuss changes to public contracts, package boundaries, security assumptions, or generated-project conventions before implementation.

## Development setup

Install Node.js 22 or newer and pnpm, then run:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

Root `typecheck`/`test`/`build` run Turborepo across every workspace package. CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) enforces a frozen install, `format:check`, `typecheck` and `test` on every PR, plus an independent build of `templates/marketing` outside the workspace (it has to prove it builds the way an exported project actually would). Use the pnpm version pinned in `package.json`.

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

Sign off each contribution under the [Developer Certificate of Origin 1.1](https://developercertificate.org/), using `git commit -s` with an identity you are authorized to use. Sign-off certifies your right to contribute under the applicable license; it does not assign your copyright. Review generated or AI-assisted contributions for correctness, provenance and license compatibility before certifying them.

A human maintainer reviews changes before merge. Agents must not approve their own changes or merge without human authorization.

Maintainers may ask that a broad contribution be split into smaller changes. Early alignment is encouraged for architectural work.

## Architecture decisions

Copy `docs/adr/0000-template.md`, assign the next number, and submit the ADR with the change it governs. Accepted ADRs are immutable; supersede one with a new ADR rather than rewriting history.

## Conduct

Be respectful, specific, and generous in technical discussion. A formal code of conduct will be adopted before broader community launch.

## License

Contributions use the license of their destination: Apache-2.0 for core, or the explicit license of a separately licensed component. The accepted policy for future reusable starter-template source is MIT; preserve its notices and those of dependencies. See [ADR-0008](docs/adr/0008-portable-marketing-site-template.md). Do not relicense copied core code as template code.
