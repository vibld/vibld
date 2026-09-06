# ADR-0002: Preserve generated-application portability

- Status: Accepted
- Date: 2026-09-06
- Decision owners: maintainers

## Context

AI builders can create durable platform lock-in when exported applications depend on proprietary runtimes, opaque metadata, or hosted services merely to function.

## Decision

Generated applications are conventional standalone projects. They may include optional `.vibld/` metadata and `VIBLD.md`, but neither may contain application logic required at build time or runtime. Removing Vibld metadata must not break install, development, build, test, or deployment workflows.

The initial generated-app standard is React, TypeScript, and Vite, with familiar package scripts and documented environment variables. Vibld-specific runtime dependencies require a separate ADR.

## Consequences

Users can leave Vibld without rewriting their applications, standard developer tools continue to work, and templates require disciplined versioning. Some deeply integrated features may require generated conventional code instead of a convenient proprietary runtime.

## Alternatives considered

- A required Vibld runtime: accelerates platform features but violates the ownership promise.
- Export-time conversion: makes the in-product project differ from the exported artifact and creates a fragile escape path.
