# Architecture decision records

ADRs record consequential decisions and the reasoning behind them. They complement code and are not a substitute for implementation documentation.

## Lifecycle

1. Copy `0000-template.md` and assign the next four-digit number.
2. Open a pull request with status **Proposed**.
3. Record meaningful alternatives and consequences.
4. A maintainer changes the status to **Accepted** or **Rejected** after review.
5. Do not rewrite accepted decisions; create a new ADR that **Supersedes** the old one.

## Index

- [ADR-0001: Use a pnpm and Turborepo monorepo](0001-pnpm-turborepo-monorepo.md)
- [ADR-0002: Preserve generated-application portability](0002-portable-generated-applications.md)
- [ADR-0003: Use provider adapters at external boundaries](0003-provider-adapter-boundaries.md)
- [ADR-0004: Execute generated code as untrusted](0004-untrusted-sandbox-execution.md)
