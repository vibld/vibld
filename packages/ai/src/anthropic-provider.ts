import type {
  GenerationPlan,
  GenerationRequest,
  ModelProvider,
} from '@vibld/core';
import type { PlanClient, PlanEffort, PlanUsage } from './client.ts';
import { GenerationPlanSchema, PLAN_SYSTEM_PROMPT } from './plan-schema.ts';
import {
  ProviderRefusalError,
  ProviderShapeError,
  ProviderTruncationError,
} from './errors.ts';

export interface ModelProviderOptions {
  /**
   * D10 has not selected a model: this default exists so the adapter runs, and
   * is expected to be settled by the measured bakeoff, not by this constant.
   */
  model?: string;
  maxTokens?: number;
  effort?: PlanEffort;
  /**
   * Reports real token usage per run. `ModelProvider.generate` returns only a
   * plan, so without this hook a caller can only estimate what a run cost;
   * with it, `RunBudgetLedger` can be charged actual figures.
   */
  onUsage?: (usage: PlanUsage) => void;
  /**
   * Ends the run early. The caller owns the reason -- a cancelled request, a
   * disconnected client -- and this adapter only forwards it to the client.
   */
  signal?: AbortSignal;
}

export const DEFAULT_MODEL = 'claude-opus-5';
export const DEFAULT_MAX_TOKENS = 16000;
export const DEFAULT_EFFORT: PlanEffort = 'high';

/**
 * A `ModelProvider` (from @vibld/core) backed by a real model.
 *
 * It is a drop-in peer of `FakeModelProvider`: same contract, same call shape,
 * so the runner, the state machine and the UI are unchanged. CI keeps using
 * the fake — nothing here runs without credentials (ADR-0007).
 */
export class AnthropicModelProvider implements ModelProvider {
  readonly id: string;
  readonly #client: PlanClient;
  readonly #model: string;
  readonly #maxTokens: number;
  readonly #effort: PlanEffort;
  readonly #onUsage?: (usage: PlanUsage) => void;
  readonly #signal?: AbortSignal;

  constructor(client: PlanClient, options: ModelProviderOptions = {}) {
    this.#client = client;
    this.#model = options.model ?? DEFAULT_MODEL;
    this.#maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.#effort = options.effort ?? DEFAULT_EFFORT;
    this.#onUsage = options.onUsage;
    this.#signal = options.signal;
    this.id = `${client.id}:${this.#model}`;
  }

  async generate(request: GenerationRequest): Promise<GenerationPlan> {
    const completion = await this.#client.createPlan({
      system: PLAN_SYSTEM_PROMPT,
      prompt: buildUserPrompt(request),
      model: this.#model,
      maxTokens: this.#maxTokens,
      effort: this.#effort,
      ...(this.#signal ? { signal: this.#signal } : {}),
    });

    // Report usage even for a failed run: a refusal or a truncation still
    // spends tokens, and a budget that only counts successes under-reports.
    this.#onUsage?.(completion.usage);

    if (completion.stopReason === 'refusal') {
      throw new ProviderRefusalError(
        completion.refusal?.category ?? null,
        completion.refusal?.explanation ?? null,
      );
    }

    if (completion.stopReason === 'max_tokens') {
      throw new ProviderTruncationError(this.#maxTokens);
    }

    const parsed = GenerationPlanSchema.safeParse(completion.plan);
    if (!parsed.success) {
      throw new ProviderShapeError(
        parsed.error.issues
          .map(
            (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
          )
          .join('; '),
      );
    }

    return {
      summary: parsed.data.summary,
      files: parsed.data.files.map((file) => ({
        path: file.path,
        content: file.content,
      })),
    };
  }
}

/**
 * Describe the existing project when there is one, so a follow-up request
 * edits rather than silently replacing the user's work. Only paths are sent,
 * not file contents: whole-repository prompt stuffing is explicitly rejected
 * by ADR-0007, and targeted context selection is later work (#12).
 */
export function buildUserPrompt(request: GenerationRequest): string {
  const base = request.base;
  if (!base || base.files.length === 0) {
    return request.prompt;
  }

  const paths = base.files.map((file) => `- ${file.path}`).join('\n');
  return `${request.prompt}

The project already exists at revision ${base.revision} with these files:
${paths}

Return the complete set of files for the updated project, preserving anything
the request does not ask you to change.`;
}
