# Repository checks and review

## Local checks

Use Node.js 24.20.0 from `.node-version` and pnpm 11.15.0 from `package.json`.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm ci:check
```

`pnpm check` is an alias for the same gate. It runs:

1. Prettier across the repository.
2. ESLint for repository JavaScript and the workspace-contract guard.
3. TypeScript with `checkJs` for the tooling scripts.
4. Node's test runner for real workspace-guard and DCO tests.
5. Turborepo lint/typecheck/test/build tasks for product workspaces.

There are no product workspaces yet. The guard reports zero rather than implying an application built. It rejects missing manifests and missing task declarations in new `apps/*`, `packages/*` and `examples/*` directories. Adding a workspace requires real commands and regression tests, not placeholder scripts; human review checks their substance. If workspace patterns change, update the guard and its tests in the same PR. The first product code must add the appropriate TypeScript, ESLint, unit and build configuration for that workspace.

The current baseline uses ESLint, TypeScript and Node's test runner. Knip, Oxlint, browser tests and other tools are not prerequisites for this small tooling-only repository; add tools when the code needs them.

## GitHub checks

The Quality workflow runs on all pull requests and pushes to `main`. Its required PR job names are `Repository quality` and `DCO sign-off`. Quality failures stop the job. DCO validates the actual PR contribution range, excluding merge commits, against Git's parsed trailers and requires a sign-off matching each commit author. An empty contribution range fails. Normal GitHub merge commits do not need separate sign-off; contributors resolving changes on their branch still certify their contribution commits.

Use `git commit -s` to certify the [Developer Certificate of Origin](https://developercertificate.org/). DCO is a contribution certification, not cryptographic commit signing. If a bot's contribution lacks sign-off, resolve its provenance and certification through maintainer review rather than silently exempting all bot names.

CI pins action commits, Node and pnpm; uses a frozen lockfile; skips dependency lifecycle scripts; removes checkout credentials; and grants only repository read permissions. It does not use `pull_request_target`, repository secrets, self-hosted runners, deployment jobs or cross-run caches. For this small repository, fresh installs avoid shared-cache trust concerns. Review any future cache or install-script change before enabling it.

Dependabot checks npm and GitHub Actions weekly with a small open-PR limit. GitHub dependency alerts, secret scanning and secret push protection complement CI. They do not detect every vulnerable dependency or secret. No automated update is merged without review. CodeQL/product-specific scanning can be added when product source arrives.

## Main-branch protection

The intended rule for `main` requires PRs, the two checks above from GitHub Actions, an up-to-date branch and resolved review conversations. Force pushes and deletion remain blocked. Apply the rule to administrators and keep bypass lists empty. Verify live settings in [branch settings](https://github.com/vibld/vibld/settings/branches); changing a file does not change GitHub protection.

There is one maintainer. GitHub cannot accept the PR author's own review as an independent approval, so the initial rule does not require a second approving account. Chris Brock reviews and performs the final merge. Agents using that same account must not merge without explicit human authorization. Once another maintainer is available, require at least one independent approval and dismiss stale approvals. Do not give an agent an exemption.

Review changes to workflows and check scripts with care: code in the PR also defines these checks, and an account with administration access can change repository rules. This baseline does not claim to resist a malicious repository administrator.

## Private security reporting

The public [Security Advisories page](https://github.com/vibld/vibld/security/advisories) provides the private reporting link. The [security policy](../SECURITY.md) names the responsible maintainer and explains the reporting process. Verification covers enablement and the public entry point; it does not claim a test report or notification email was delivered.
