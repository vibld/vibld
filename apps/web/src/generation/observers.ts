import type {
  GenerationPlan,
  GenerationRequest,
  GenerationStageRecord,
  GenerationStore,
  ModelProvider,
  ProjectSnapshot,
  PromotionResult,
  Validator,
} from '@vibld/core';

/**
 * The builder shell needs to show lifecycle progress, but `@vibld/core`
 * deliberately exposes contracts rather than an event bus. Rather than fork
 * the state machine, the shell decorates the two contracts the runner already
 * depends on (`GenerationStore` and `ModelProvider`) and reports what it sees.
 * No core behaviour is reimplemented here.
 */
export interface StageObserver {
  onStage(record: GenerationStageRecord): void;
  onPromotion(runId: string, result: PromotionResult): void;
  onPlan(plan: GenerationPlan): void;
}

export class ObservingGenerationStore implements GenerationStore {
  readonly #inner: GenerationStore;
  readonly #observer: StageObserver;

  constructor(inner: GenerationStore, observer: StageObserver) {
    this.#inner = inner;
    this.#observer = observer;
  }

  async saveStage(record: GenerationStageRecord): Promise<void> {
    await this.#inner.saveStage(record);
    this.#observer.onStage(record);
  }

  loadStage(runId: string): Promise<GenerationStageRecord | undefined> {
    return this.#inner.loadStage(runId);
  }

  loadAccepted(projectId: string): Promise<ProjectSnapshot | undefined> {
    return this.#inner.loadAccepted(projectId);
  }

  async promote(
    projectId: string,
    runId: string,
    expectedBaseRevision: string | null,
    snapshot: ProjectSnapshot,
  ): Promise<PromotionResult> {
    const result = await this.#inner.promote(
      projectId,
      runId,
      expectedBaseRevision,
      snapshot,
    );
    this.#observer.onPromotion(runId, result);
    return result;
  }
}

export class ObservingModelProvider implements ModelProvider {
  readonly id: string;
  readonly #inner: ModelProvider;
  readonly #observer: StageObserver;
  readonly #beforePlan: () => Promise<void>;

  constructor(
    inner: ModelProvider,
    observer: StageObserver,
    beforePlan: () => Promise<void>,
  ) {
    this.id = inner.id;
    this.#inner = inner;
    this.#observer = observer;
    this.#beforePlan = beforePlan;
  }

  async generate(request: GenerationRequest): Promise<GenerationPlan> {
    await this.#beforePlan();
    const plan = await this.#inner.generate(request);
    this.#observer.onPlan(plan);
    return plan;
  }
}

export function withValidationDelay(
  validator: Validator,
  delay: () => Promise<void>,
): Validator {
  return async (snapshot) => {
    await delay();
    return validator(snapshot);
  };
}
