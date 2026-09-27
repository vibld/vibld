-- What became of each generation run, attached to the run itself (#167).
--
-- The facts were already produced: `generation-workflow.ts` logs a
-- `generation.settled` line carrying the model, the outcome and the tokens.
-- Logs are the wrong home for them. Diagnosing "it only changed two files"
-- meant reading server output against a run the user cannot point at, and
-- after a reload there was nothing to point at either.
--
-- One row per run that actually ran. A refused run is not written here at
-- all: somebody told "not now" has not had a failed generation, and a
-- history that shows them one is lying about what happened to them.
--
-- **Metadata only, per D20.** No prompt, no generated source, no file path,
-- no secret and no provider message. `stop` is an identifier from the
-- vocabulary in packages/core/src/run-outcome.ts precisely so that a
-- provider's error text, which can quote the request back, never becomes the
-- thing that gets stored. This table must not become a second channel for
-- what the telemetry decision keeps out of the first.
CREATE TABLE generation_run_traces (
  run_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  -- A `RunStop`, never a sentence and never a boolean.
  stop TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  -- The part of input_tokens the provider served from its cache. Stored
  -- split rather than netted off: the cached fraction is the measurement
  -- that says whether a caching scheme works at all, and a net figure
  -- cannot answer it.
  cached_input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  -- The window this run had, stored with the run rather than looked up
  -- later. A model's window changes, and a run near the limit of the window
  -- it actually had is the thing worth seeing afterwards.
  context_window INTEGER NOT NULL,
  cost_micro_usd INTEGER NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  ended_at TEXT NOT NULL
);

-- The builder asks for one project's runs, newest first.
CREATE INDEX idx_generation_run_traces_project
  ON generation_run_traces (project_id, ended_at DESC);
