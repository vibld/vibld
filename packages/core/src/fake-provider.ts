import type {
  GenerationPlan,
  GenerationRequest,
  ModelProvider,
} from './types.ts';

export class FakeModelProvider implements ModelProvider {
  readonly id = 'fake';
  #plans: GenerationPlan[];

  constructor(plans: GenerationPlan[]) {
    this.#plans = [...plans];
  }

  async generate(_request: GenerationRequest): Promise<GenerationPlan> {
    const next = this.#plans.shift();
    if (!next) {
      throw new Error('FakeModelProvider has no scripted plan remaining');
    }

    return structuredClone(next);
  }
}
