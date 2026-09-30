# Applications

Four Cloudflare Workers (ADR-0005). Each README says what it does and how it
is deployed.

- [`web`](web/README.md) -- the builder at `app.vibld.com`: a
  React/TypeScript/Vite SPA and the Worker behind its `/api` routes. Sign-in
  (Clerk), the control plane in D1 and R2, model generation as a durable
  Workflow, projects, billing, publishing and GitHub pushes. Locally,
  `pnpm dev` serves no `/api`, so it runs the deterministic fake provider.
- [`preview`](preview/README.md) -- the private sandbox previews: installs
  and runs a generated project in a time-boxed, network-restricted container
  on `vibld-preview.dev`, with revocable share links. It also runs the
  one-shot build that publishing uses.
- [`publish`](publish/README.md) -- serves published sites at
  `<slug>.vibld-preview.dev` from R2. It has no route of its own:
  `apps/preview` owns the zone's wildcard route and forwards to it.
- [`marketing`](marketing/README.md) -- `vibld.com`: a prerendered React
  Router site with the product pages, docs, roadmap, legal pages and
  `llms.txt`.
