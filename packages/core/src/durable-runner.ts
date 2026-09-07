import { GenerationMachine } from './generation-machine.ts';
import type { GenerationStore } from './store.ts';
import type {
  GenerationRequest,
  GenerationResult,
  ModelProvider,
  ProjectSnapshot,
  Validator,
} from './types.ts';

export interface DurableGenerationRequest extends GenerationRequest {
  projectId: string;
  runId: string;
}

export interface DurableGenerationResult extends GenerationResult {
  conflict: boolean;
}

export class DurableGenerationRunner {
  constructor(private readonly store: GenerationStore) {}

  async run(
    request: DurableGenerationRequest,
    provider: ModelProvider,
    validator: Validator,
  ): Promise<DurableGenerationResult> {
    const storedBase = request.base ?? (await this.store.loadAccepted(request.projectId));
    const baseRevision = storedBase?.revision ?? null;

    await this.store.saveStage({
      runId: request.runId,
      projectId: request.projectId,
      baseRevision,
      state: 'planning',
    });

    const machine = new GenerationMachine();
    const durableValidator: Validator = async (snapshot) => {
      await this.store.saveStage({
        runId: request.runId,
        projectId: request.projectId,
        baseRevision,
        state: 'validating',
        snapshot,
      });
      return validator(snapshot);
    };

    const result = await machine.run(
      { prompt: request.prompt, base: storedBase },
      provider,
      durableValidator,
    );

    if (result.state === 'accepted' && result.accepted) {
      const promotion = await this.store.promote(
        request.projectId,
        request.runId,
        baseRevision,
        result.accepted,
      );

      if (!promotion.promoted) {
        await this.store.saveStage({
          runId: request.runId,
          projectId: request.projectId,
          baseRevision,
          state: 'failed',
          snapshot: result.accepted,
        });

        return {
          state: 'failed',
          accepted: promotion.current,
          staged: result.accepted,
          errors: ['Accepted revision changed before promotion'],
          conflict: true,
        };
      }

      return {
        ...result,
        accepted: promotion.current,
        conflict: false,
      };
    }

    await this.store.saveStage({
      runId: request.runId,
      projectId: request.projectId,
      baseRevision,
      state: result.state,
      snapshot: result.staged,
    });

    return {
      ...result,
      accepted: storedBase ? structuredClone(storedBase) : undefined,
      conflict: false,
    };
  }
}
