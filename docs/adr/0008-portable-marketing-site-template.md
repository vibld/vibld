# ADR-0008: Prerendered marketing sites as the first generated project

- Status: Accepted
- Date: 2026-09-06
- Decision owner: Chris Brock
- Approval: D1(a first), D2(b), D3(a), D24(a), D29(a)
- Refines: ADR-0002

## Context

Technical founders and small agencies are the first audience. Marketing sites need crawlable content, usable metadata and fast page loads. The interactive builder UI has different rendering needs from the sites it creates.

## Decision

The first versioned template uses React Router framework mode with static prerendering, React, TypeScript, Vite and Tailwind. Add selected shadcn/ui, Radix or icon components only when the generated site needs them. The builder remains a separate React/Vite SPA.

Provide conventional install, development, build, lint, typecheck and test commands, a lockfile, README and `.env.example`. Prerender each declared marketing route with page-specific titles, descriptions and social metadata. Validate rendered HTML and keyboard/mobile behavior; do not treat a passing compiler as a complete website quality check. Forms must state whether submission is functional or a demonstration. M1 does not imply a live email or database integration.

Generated projects must build outside Vibld without a Vibld account, broker, runtime package or `.vibld/` directory. Optional metadata stores template version and provenance without becoming required app logic. Check static hosting behavior for deep links and missing routes.

Core code stays Apache-2.0. Reusable starter-template source receives an explicit MIT license at its own boundary when added. Preserve upstream notices and mark any copied core code under its original license. User-created application code may use the user's selected license, subject to third-party obligations. This policy does not relicense existing repository files or guarantee rights in arbitrary generated content.

## Consequences

The first template does not cover every application family. Extend template capabilities for interactive apps, data and other audiences after the first build/edit loop. Prerendering is part of the generation and portability acceptance suite, not a provider-specific deployment shortcut.

## Alternatives considered

- A client-rendered Vite SPA for every output: simple but insufficient for the chosen marketing-first rendering requirement.
- A server-rendered app for every site: adds runtime operation to static sites that do not need it.
- Many framework templates in M1: expands the evaluation and repair surface before one path works.

## References

- [React Router rendering strategies](https://reactrouter.com/start/framework/rendering)
