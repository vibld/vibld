# ADR-0004: Execute generated code as untrusted

- Status: Accepted
- Date: 2026-09-06
- Decision owners: maintainers

## Context

Vibld installs dependencies and executes code assembled from model output and third-party packages. That code may be defective or malicious and cannot share the trust boundary of the Vibld control plane.

## Decision

All generated application commands run through a sandbox contract and are treated as untrusted. A sandbox receives only a project-scoped filesystem, explicit short-lived secrets, bounded resources, and policy-controlled network access. Vibld control-plane credentials are never available inside it. Lifecycle events and policy decisions are auditable.

The first sandbox implementation may support a narrow execution model, but the contract must preserve these invariants.

## Consequences

Preview and generation infrastructure require explicit isolation, timeouts, cleanup, and error reporting from the beginning. Local development may use a clearly labeled reduced-isolation adapter, but it cannot define the production security model.

## Alternatives considered

- Execute on the application host: operationally simple and unacceptable for hostile code.
- Rely only on static scanning: useful defense in depth, but unable to prove runtime safety.
