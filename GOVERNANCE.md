# Governance

Vibld is currently founder-led and uses a maintainer model appropriate for an early open-source project.

## Roles

- **Contributors** submit issues, discussions, documentation, code, or reviews.
- **Maintainers** review changes, manage releases, triage security reports, and steward project direction.
- **Lead maintainers** resolve deadlocks and make final calls when consensus is not practical.

Current lead maintainer: [Chris Brock (@cbrock84)](https://github.com/cbrock84). The project is founder-led. Additional maintainers may be appointed through a documented nomination and acceptance.

## Decision making

Routine decisions happen through issues and pull requests. Maintainers seek rough consensus and favor reversible experiments when evidence is incomplete.

Changes use pull requests and require human maintainer review before merge. Coding agents may propose changes and run checks but do not approve their own work or merge without human authorization. No coding-agent vendor is a permanent architectural dependency. [Repository checks](docs/repository-checks.md) document the technical enforcement and single-maintainer review limitation. Human review is the maintainer's responsibility, even when GitHub cannot enforce independent approval for a PR authored through that same account.

Decisions that materially affect portability, security, public contracts, package boundaries, licensing, governance, or provider independence require an architecture decision record. The lead maintainers make a final decision only after the alternatives and objections have been documented.

The initial [decision register](docs/decisions.md) records founder-approved D1-D30. Keep it synchronized with new ADRs and milestone changes. Contributors certify the [Developer Certificate of Origin](https://developercertificate.org/) with commit sign-off; the project does not require copyright assignment. Basic review and security duties apply now. Extensive community processes and brand work can wait until the product works.

## Project commitments

The governance process protects these commitments:

- Apache-2.0 licensed open-source core
- user ownership and portability of generated applications
- Git-native workflows
- provider-neutral architecture
- transparent security and telemetry behavior
- public rationale for consequential technical decisions

## Changes to governance

Governance changes require a public proposal and maintainer approval. As the contributor community grows, this document should evolve toward shared maintainership and a documented succession process.
