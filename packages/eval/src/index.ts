export {
  BUILD_STAGES,
  EVAL_RESULTS_FILE,
  REPAIR_RESULTS_FILE,
  buildErrorFor,
  forLog,
  formatBakeoff,
  joinBakeoff,
  parseBuildResults,
  parseEvalResults,
  parseRepairResults,
  repairable,
  selectForRepair,
  verdictFor,
} from './bakeoff.ts';
export type {
  BakeoffReport,
  BuildRecord,
  BuildResults,
  BuildStage,
  CandidateRecord,
  EvalResults,
  ModelRow,
  RepairJob,
  RepairRecord,
  RepairResults,
  RunRow,
  Verdict,
} from './bakeoff.ts';
export {
  CASES,
  GALLERY_CASES,
  GALLERY_SITE_TYPES,
  GALLERY_STYLES,
  PROMPT_SET_VERSION,
  findCase,
  galleryCaseId,
  stubPlan,
} from './cases.ts';
export type { EvalCase, Expectation } from './cases.ts';
export {
  expectationProblems,
  expectationText,
  meetsExpectation,
  projectCode,
  runCase,
} from './harness.ts';
export type { CaseOutcome, CaseResult, HarnessOptions } from './harness.ts';
export {
  MAX_RUNS,
  WRITE_EFFORTS,
  acceptedProject,
  containedPath,
  createLiveRun,
  describeEffort,
  liveProblems,
  liveRuns,
  liveWriteEffort,
  planWrites,
  readLiveOptions,
  runCostCents,
  selectCaseIds,
  writeProject,
} from './live.ts';
export type {
  CaseSelection,
  LiveEnv,
  LiveOptions,
  LiveRun,
  PlannedWrite,
  WritePlan,
} from './live.ts';
export { checkPortability } from './portability.ts';
export type { PortabilityProblem } from './portability.ts';
export {
  formatReport,
  formatStability,
  stability,
  summarise,
} from './report.ts';
export type { CaseStability, EvalReport } from './report.ts';
export { repairCandidate, repairPrompt } from './repair.ts';
export type { RepairInput, RepairOutput } from './repair.ts';
export { SCENARIOS, runScenario } from './scenarios.ts';
export type { Scenario, ScenarioResult } from './scenarios.ts';
export { createEvalValidator, pathProblem } from './validator.ts';
