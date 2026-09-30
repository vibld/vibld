# Packages

- [`core`](core) -- Vibld-owned domain contracts and orchestration: the
  generation state machine, the durable store and runner with compare-and-set
  promotion, the run-budget ledger, and a deterministic fake provider.
- [`ai`](ai/README.md) -- the model adapters, implementing core's
  `ModelProvider` over Anthropic, OpenAI and DeepSeek clients, plus the
  prompts, the generated stack and scaffold, and the design catalogues. Holds
  the only vendor SDK import in the repository (ADR-0003). Not reachable from
  the browser: provider credentials belong to a trusted service (ADR-0006).
- [`eval`](eval/README.md) -- the versioned prompt set, the portability,
  build and injected-failure checks, and the harness that runs them against
  real models for a bakeoff.
- [`brand`](brand) -- the Vibld palette and mark, as data, shared by the
  builder and the marketing site.
- [`security-headers`](security-headers) -- the response headers
  `vibld.com`, `app.vibld.com` and published sites send.

Add packages when an actual caller justifies a boundary, not to match a
diagram.
