# ADR-0005: Cloudflare-first hosted platform

- Status: Accepted
- Date: 2026-09-06
- Decision owner: Chris Brock
- Approval: D4(b), D5(b), D6(c), D7(b), D30(a)
- Refines: ADR-0003 and ADR-0004

## Context

The first release is an invitation-only hosted alpha. Generated code needs an execution boundary separate from the trusted API, and generation can outlive an HTTP request. Projects must survive sandbox eviction. Cloudflare is the selected infrastructure provider, while generated applications must remain portable.

## Decision

| Component           | Initial choice                               | Responsibility                                                                          |
| ------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| Builder UI          | React, TypeScript, Vite SPA                  | Authenticated project, conversation, changes and preview views                          |
| API                 | Hono on Cloudflare Workers                   | Identity validation, tenant authorization and trusted service entry points              |
| Job runtime         | Cloudflare Workflows                         | Persisted stages, bounded retry, cancellation and reconciliation                        |
| Untrusted execution | Cloudflare Sandbox SDK                       | Install, build, test and preview within project-scoped limits                           |
| Platform metadata   | Supabase PostgreSQL                          | Ownership, project/run records, checkpoints, permissions and usage                      |
| Platform identity   | Supabase Auth                                | Invitation-only identity/session lifecycle; API still checks authorization              |
| SQL connection path | Hyperdrive and a supported PostgreSQL driver | Workers access to PostgreSQL                                                            |
| Object storage      | R2 behind storage contracts                  | Durable repository/checkpoint objects, assets and build artifacts                       |
| Coordination        | Durable Objects where required               | Project execution coordination and live connections; not the only durable project store |

Use direct SQL through Hyperdrive, initially evaluating `pg`. The Supabase JavaScript client may handle auth; it is not the Hyperdrive SQL transport. Explicitly configure cache behavior: authorization, permission, run-state and read-after-write queries must not return stale cached state. Prove the chosen connection/transaction model against the selected Supabase endpoint.

Enforce tenant boundaries in the API and persistence layer. Direct privileged SQL does not acquire end-user RLS claims by itself. Use constrained database roles and documented transaction-scoped tenant handling; test cross-tenant reads and writes. Keep service-role credentials out of browsers and sandboxes.

PostgreSQL records the accepted revision and artifact manifest. R2 stores immutable, checksummed project objects with recovery information sufficient to reconstruct the repository. A sandbox is a disposable working copy. Persist objects before advancing the accepted revision with a conditional update; reconcile orphaned objects and interrupted runs. There is no atomic transaction spanning PostgreSQL, R2 and GitHub.

Keep platform Supabase resources separate from customer applications' future Supabase resources. No customer app receives platform database access. Keep provider identifiers inside adapters. Add deployment/package units when a working slice requires them, rather than creating one service per conceptual boundary.

## Consequences

Cloudflare provides the first hosted execution environment, but an alternate runtime and self-hosting path remain unproven. Workflows, database connections, object storage and sandbox processes can fail independently. M1 must include restart, eviction, disconnect, restore and tenant-isolation tests, plus operator cleanup and cost limits.

Provisioning still requires account capability checks, region/tier selection and an approved budget. This ADR does not claim a deployed system.

## Alternatives considered

- A single full-stack server can simplify local execution, but is not the selected hosted architecture.
- D1 would keep more services on Cloudflare; PostgreSQL is the accepted metadata direction and supports the planned relational/search needs.
- Browser-only execution reduces hosted work but does not match the chosen managed alpha and execution policy.
- Supabase's HTTP data API is viable for other use cases; the selected platform SQL path is PostgreSQL through Hyperdrive.

## References

- [Cloudflare React guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/)
- [Workflow rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
- [Hyperdrive with Supabase](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/)
- [Hyperdrive behavior](https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/)
