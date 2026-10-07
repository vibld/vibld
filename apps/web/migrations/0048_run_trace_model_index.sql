-- The builder says what a build is expected to cost before it is asked for
-- (`apps/web/worker/build-estimate.ts`): the recent builds on each model the
-- picker offers, newest first. `/api/config` asks it every time the builder
-- loads, and without this index each ask reads every run ever traced.
CREATE INDEX idx_generation_run_traces_model
  ON generation_run_traces (model, ended_at DESC);
