# Packages

- [`core`](core) -- Vibld-owned domain contracts and orchestration: the
  generation state machine, the durable store and runner with compare-and-set
  promotion, the run-budget ledger, and a deterministic fake provider.
- [`ai`](ai/README.md) -- the first model adapter, implementing core's
  `ModelProvider`. Holds the only vendor SDK import in the repository
  (ADR-0003). Not reachable from the browser: provider credentials belong to a
  trusted service (ADR-0006).

Add packages when an actual caller justifies a boundary, not to match a
diagram.
