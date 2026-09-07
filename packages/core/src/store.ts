import type { GenerationState, ProjectSnapshot } from './types.ts';

export interface GenerationStageRecord {
  runId: string;
  projectId: string;
  baseRevision: string | null;
  state: GenerationState;
  snapshot?: ProjectSnapshot;
}

export interface PromotionResult {
  promoted: boolean;
  current?: ProjectSnapshot;
}

export interface GenerationStore {
  saveStage(record: GenerationStageRecord): Promise<void>;
  loadStage(runId: string): Promise<GenerationStageRecord | undefined>;
  loadAccepted(projectId: string): Promise<ProjectSnapshot | undefined>;
  promote(
    projectId: string,
    runId: string,
    expectedBaseRevision: string | null,
    snapshot: ProjectSnapshot,
  ): Promise<PromotionResult>;
}
