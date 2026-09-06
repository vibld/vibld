# Security Policy

Vibld executes AI-generated and third-party code. Treat every generated project, dependency, prompt attachment, and sandbox process as untrusted.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Until private vulnerability reporting is enabled, contact the maintainers through the private contact method listed on the Vibld GitHub organization profile. Include impact, affected components or commits, reproduction steps, and any suggested mitigation.

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

These are architectural requirements. A feature that cannot preserve them must not ship unchanged.
