# Security Policy

Vibld executes AI-generated and third-party code. Treat every generated project, dependency, prompt attachment, and sandbox process as untrusted.

## Reporting a vulnerability

Use [GitHub's private vulnerability-reporting form](https://github.com/vibld/vibld/security/advisories/new). Sign in to GitHub if prompted. You can also open the repository's [Security Advisories page](https://github.com/vibld/vibld/security/advisories) and select **Report a vulnerability**. Do not post vulnerability details in public issues, pull requests or discussions.

Responsible maintainer: [Chris Brock (@cbrock84)](https://github.com/cbrock84). Include impact, affected components or commits, reproduction steps and any suggested mitigation. Do not include live credentials or unrelated user data. Reports remain private through GitHub's advisory workflow until coordinated publication.

Private reporting is enabled, and the public reporting link was verified on 2026-09-06. No synthetic vulnerability report was submitted. Maintainers should enable repository security-alert notifications and verify their delivery preferences using [GitHub's notification guidance](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository#configuring-notifications-for-private-vulnerability-reporting).

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
