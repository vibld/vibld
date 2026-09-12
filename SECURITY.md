# Security Policy

Vibld executes AI-generated and third-party code. Treat every generated project, dependency, prompt attachment, and sandbox process as untrusted.

## Reporting a vulnerability

Do not open a public issue containing vulnerability details.

**Report privately here: [github.com/vibld/vibld/security/advisories/new](https://github.com/vibld/vibld/security/advisories/new)**

That form is GitHub's private vulnerability reporting. The draft advisory is visible only to you and to the maintainers of this repository; nothing about it is public until an advisory is deliberately published. You do not need a Vibld account, and there is no email address to find.

Maintainer responsible for this route: [Chris Brock (@cbrock84)](https://github.com/cbrock84).

Include impact, affected components or commits, reproduction steps and any suggested mitigation. Do not include live credentials or unrelated user data -- a report does not need them, and sending them makes the report itself a liability.

If the link above does not open a report form, the route is not working and that is itself worth telling us: say so in [issue #17](https://github.com/vibld/vibld/issues/17) **without any vulnerability details**, and wait for the route to be fixed rather than disclosing publicly.

Please allow the maintainers reasonable time to investigate before public disclosure. We will acknowledge a complete report, assess severity, coordinate a fix, and credit reporters who want attribution.

## Supported versions

Vibld has not published a stable release. Security fixes apply to the latest `main` branch until a version support policy is announced.

## Security invariants

- Sandboxes do not receive Vibld control-plane credentials.
- Secrets are never committed and enter model context only with explicit need and disclosure.
- Runtime secrets are scoped to the minimum project, environment, and lifetime.
- Untrusted code cannot access host files or networks by default.
- Dependency installation and generated code are subject to automated checks.
- Logs, telemetry, prompts, and source code are collected only under documented policy.
- Security-sensitive actions are auditable.

The accepted [permission, credential and preview architecture](docs/adr/0006-permissions-credentials-and-previews.md) requires trusted credential brokers, explicit action grants, private isolated previews, outbound policy and revocation tests. Required security/accounting records have a separate disclosed purpose from optional operational analytics. None of these controls is implemented by policy text alone.

These are architectural requirements. A feature that cannot preserve them must not ship unchanged.
