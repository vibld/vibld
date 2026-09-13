# Applications

- [`web`](web/README.md) -- the React/TypeScript/Vite builder shell. It runs a
  deterministic prompt-to-checkpoint lifecycle in the browser against
  `@vibld/core`, with a clearly labelled local mock preview. No sandbox
  execution, model provider, persistence, Git export or deployment yet.

The Hono API on Cloudflare Workers, with Workflows for generation jobs, arrives
with the hosted slices. No deployable product exists here yet. See
[ADR-0005](../docs/adr/0005-cloudflare-hosted-platform.md).
