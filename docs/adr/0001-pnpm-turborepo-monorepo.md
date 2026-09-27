# ADR-0001: Use a pnpm and Turborepo monorepo

- Status: Accepted
- Date: 2026-09-06
- Decision owners: maintainers

## Context

Vibld will contain user-facing applications, orchestration logic, provider adapters, templates, and shared contracts that need coordinated changes. Publishing every conceptual boundary as an independent repository would add friction before those boundaries are proven.

## Decision

Use a single TypeScript repository with pnpm workspaces and Turborepo task orchestration. Product applications live under `apps/`; reusable, independently testable capabilities may graduate into `packages/`. A directory in the blueprint is not automatically a package.

## Consequences

Cross-cutting changes remain atomic, dependency installation is deduplicated, and validation has one entry point. The repository must actively prevent accidental coupling with package APIs, dependency direction, and tests. Turborepo is build tooling and must not become an application runtime dependency.

## Alternatives considered

- Multiple repositories: stronger isolation, but excessive coordination for Phase 0.
- A single application package: simpler initially, but obscures the known platform boundaries.
- npm or Yarn workspaces: viable, but pnpm offers strict, efficient dependency handling and matches the chosen contributor workflow.
