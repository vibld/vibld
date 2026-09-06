# ADR-0003: Use provider adapters at external boundaries

- Status: Accepted
- Date: 2026-09-06
- Decision owners: maintainers

## Context

Vibld will use changing external systems for AI models, sandboxes, source control, data, authentication, and deployment. Binding core orchestration or project models to a provider SDK would make replacement costly and undermine self-hosting.

## Decision

Core code defines capability-oriented contracts using Vibld-owned types. Provider integrations implement those contracts at the boundary. Provider SDK objects, errors, and configuration do not cross into core domain APIs. Adapters should expose real capability differences rather than pretending every provider is identical.

Create an abstraction only when at least one concrete workflow needs it; do not build a speculative universal plugin system during M1.

## Consequences

Providers can be tested and replaced independently and self-hosted deployments can choose their stack. Translation code and contract tests are required. Provider-specific capabilities may require explicit extensions or capability checks.

## Alternatives considered

- Direct SDK use throughout the codebase: faster for the first integration but expensive to unwind.
- A lowest-common-denominator interface: superficially portable but hides useful capabilities and failure modes.
