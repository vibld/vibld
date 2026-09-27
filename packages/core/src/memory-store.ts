import type { ProjectSnapshot } from './types.ts';
import type {
  GenerationStageRecord,
  GenerationStore,
  PromotionResult,
} from './store.ts';

function cloneSnapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
  return structuredClone(snapshot);
}

function cloneStage(record: GenerationStageRecord): GenerationStageRecord {
  return structuredClone(record);
}

export class InMemoryGenerationStore implements GenerationStore {
  #stages = new Map<string, GenerationStageRecord>();
  #accepted = new Map<string, ProjectSnapshot>();

  async saveStage(record: GenerationStageRecord): Promise<void> {
    this.#stages.set(record.runId, cloneStage(record));
  }

  async loadStage(runId: string): Promise<GenerationStageRecord | undefined> {
    const record = this.#stages.get(runId);
    return record ? cloneStage(record) : undefined;
  }

  async loadAccepted(projectId: string): Promise<ProjectSnapshot | undefined> {
    const snapshot = this.#accepted.get(projectId);
    return snapshot ? cloneSnapshot(snapshot) : undefined;
  }

  async promote(
    projectId: string,
    runId: string,
    expectedBaseRevision: string | null,
    snapshot: ProjectSnapshot,
  ): Promise<PromotionResult> {
    const stage = this.#stages.get(runId);
    if (!stage || stage.projectId !== projectId) {
      return {
        promoted: false,
        current: await this.loadAccepted(projectId),
      };
    }

    const current = this.#accepted.get(projectId);
    const currentRevision = current?.revision ?? null;
    if (currentRevision !== expectedBaseRevision) {
      return {
        promoted: false,
        current: current ? cloneSnapshot(current) : undefined,
      };
    }

    this.#accepted.set(projectId, cloneSnapshot(snapshot));
    this.#stages.set(runId, {
      ...cloneStage(stage),
      state: 'accepted',
      snapshot: cloneSnapshot(snapshot),
    });

    return {
      promoted: true,
      current: cloneSnapshot(snapshot),
    };
  }
}
