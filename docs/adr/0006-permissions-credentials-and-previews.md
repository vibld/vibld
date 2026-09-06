# ADR-0006: Scoped authority and broker-first credentials

- Status: Accepted
- Date: 2026-09-06
- Decision owner: Chris Brock
- Approval: D14(c), D15(a then b/c), D16(d), D17(b), D19(a)
- Refines: ADR-0004

## Context

Prompts, repositories, dependencies and generated applications are untrusted inputs. Broader autonomy must not grant those inputs access to platform credentials or other projects. Hosted previews run attacker-controlled JavaScript and must not share the builder's trust boundary.

## Decision

Represent grants outside model context with principal, tenant/project, actions, destination, budget and expiry. Check grants at each trusted tool boundary, including during retries. Deny actions outside the grant, and request a new user decision when scope changes. A standing grant avoids repeated prompts only within its approved scope. Revocation blocks new work; cancellation also stops active resources where possible.

| Credential class              | Allowed handling                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Vibld infrastructure          | Trusted service bindings only; never sent to generated code                                                              |
| User model-provider key       | Encrypted at rest; used by trusted model service, with redaction and rotation                                            |
| GitHub authorization          | GitHub App installation access scoped to the intended repository and permissions; trusted Git operations                 |
| Deployment authorization      | Trusted deployment adapter scoped to approved target; production application secrets stored in the target's secret store |
| Generated-app test credential | Brokered operation first; narrowly scoped, expiring runtime injection only where required                                |

A broker authorizes operations, not arbitrary authenticated forwarding. Bind allowed methods, destinations and paths; validate redirects and block private-network/metadata destinations. Restrict response content and size. Never expose a generic proxy backed by broad credentials. Application test credentials remain separate from production secrets. A secret injected into untrusted runtime can be read by that runtime, so injection is a disclosed risk exception, not a guarantee against exfiltration.

Choose a user-secret store with separate encryption keys or a dedicated secret service before storing user keys. Specify key recovery, rotation, access audit and deletion. Do not place plaintext secrets in project objects, workflow payloads, Git, telemetry or model context. Exported apps use conventional environment configuration and can run with the user's direct credentials outside Vibld.

Apply filesystem, resource and outbound-network policy from the first hosted slice. Start with curated dependencies and explicit install destinations. Later broader install modes retain sandbox boundaries, execution caps and outbound policy. Reject path traversal, symlink escape and oversized file/command output before promotion or context assembly.

Preview access is private by default. Use an origin isolated from the builder, preferably a separate registrable domain, with no builder cookies or credentials. Authenticate HTML, assets and live connections; test that raw sandbox/port URLs cannot bypass access control. Validate parent/preview messages against exact origins and schemas. Sharing requires an explicit expiring grant, revocation and a warning about the exposed project content. Keep private previews out of shared caches and search indexing.

## Consequences

This adds trusted service code and integration tests to M1. Some integrations may not support usable narrow credentials; leave those unavailable until their risk is reviewed. Invitation-only access does not waive these controls. Refuse hosted alpha release if isolation, revocation or raw-URL bypass tests fail.

## Alternatives considered

- Inject every credential into the sandbox: simpler integration, unacceptable control-plane exposure.
- Broker every possible operation: useful default, but cannot support every conventional app integration.
- Grant broad autonomy as a prompt instruction: cannot enforce authorization or cost ceilings.
- Share public preview URLs by default: conflicts with the accepted private-preview requirement.

## References

- [Sandbox security](https://developers.cloudflare.com/sandbox/concepts/security/)
- [Sandbox outbound traffic](https://developers.cloudflare.com/sandbox/guides/outbound-traffic/)
- [GitHub installation access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
