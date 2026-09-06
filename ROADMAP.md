# Roadmap

The roadmap describes outcomes, not promises or dates. GitHub milestones and issues hold the executable backlog.

## M0 — Foundation

Goal: establish a trustworthy, contributor-ready base.

- Product and technical charter
- Apache-2.0 licensing and governance
- Architecture decision process and initial decisions
- pnpm, Turborepo, and TypeScript workspace
- Repository quality baseline and contributor documentation
- Brand and landing-page baseline
- Development and validation conventions

Exit criterion: a new contributor can understand the project, install the workspace, and begin a scoped M1 task without an unwritten architectural decision.

## M1 — Hello Vibld

Goal: **prompt → generated files → runnable React app → live preview**.

- Minimal project creation flow
- Structured plan and generation contracts
- One model-provider adapter
- Versioned React application template
- Isolated sandbox and dependency installation
- Preview lifecycle and streamed status
- Build, TypeScript, runtime, and browser-console validation
- One end-to-end demonstration from prompt to preview

Exit criterion: a representative prompt reliably produces a conventional React application and displays a working preview, with failures made visible.

## M2 — Reliable iteration

Repository context, targeted patches, validation, runtime error capture, repair loops, change summaries, and rollback.

## M3 — Git-native workflow

Repository initialization, meaningful diffs and commits, GitHub connection, push/pull, and branch workflows.

## M4 — Visual iteration

Element selection, source mapping, text and style changes, and responsive inspection.

## M5 — Full-stack applications

Database and authentication adapters, environment variables, backend generation, and storage.

## M6 — Ship

Cloudflare deployment, additional deployment adapters, environment management, logs, and custom domains.

## M7 — Vibld Cloud

Accounts, persistent projects, hosted sandboxes, managed AI, billing, teams, and collaboration.

## Not on the critical path

Marketplace, native mobile generation, enterprise governance, Figma import, AI image generation, and a full Webflow-style editor are intentionally deferred until the core build-and-iterate loop is reliable.
