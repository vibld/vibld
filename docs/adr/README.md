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
- [ADR-0005: Cloudflare-first hosted platform](0005-cloudflare-hosted-platform.md)
- [ADR-0006: Scoped authority and broker-first credentials](0006-permissions-credentials-and-previews.md)
- [ADR-0007: Durable generation, staged changes and revision-scoped context](0007-durable-generation-and-repository-context.md)
- [ADR-0008: Prerendered marketing sites as the first generated project](0008-portable-marketing-site-template.md)
- [ADR-0009: Send the whole generated project when iterating on it](0009-bounded-project-context-for-iteration.md) -- **Proposed**, awaiting the decision owner
- [ADR-0010: Cloudflare auto-publish for exported projects](0010-cloudflare-auto-publish.md) -- **Proposed**, awaiting the decision owner

ADRs 0001-0004 remain unchanged. ADRs 0005-0008 record the founder's accepted [D1-D30 choices](../decisions.md); acceptance of architecture is separate from implementation status and review of the documentation PR. The archived blueprint's suggested ADR filenames were proposals, not assigned numbers.
