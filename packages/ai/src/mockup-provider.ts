import { MOCKUP_SYSTEM_PROMPT, MockupSetSchema } from './mockup-schema.ts';
import type { ParsedMockupSet } from './mockup-schema.ts';
import {
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  mockupMaxTokensFor,
  readCompletion,
} from './plan-provider.ts';
import { styleDirection } from './style-presets.ts';
import type { StylePresetId } from './style-presets.ts';
import type {
  PlanClient,
  PlanEffort,
  PlanProgress,
  PlanUsage,
} from './client.ts';

/**
 * Three directions to choose between, before a build is attempted (#185).
 *
 * Not `ModelProvider`. That interface returns a `GenerationPlan` -- a
 * project -- and this returns something a person looks at and then throws
 * two thirds of away. Bending one into the other would have meant a plan
 * whose "files" were not files, and every consumer of a plan would have had
 * to learn the difference.
 *
 * It shares `readCompletion` with `PlanProvider`, which is the part the two
 * genuinely agree on: why a call stopped, and whether the JSON is the shape
 * asked for. Everything else here is different on purpose -- a different
 * system prompt, a ceiling an order of magnitude smaller, and no style DNA,
 * knowledge, palette or reference context, because the point of this run is
 * to find out what the person wants rather than to apply what they have
 * already said.
 *
 * One exception: a chosen style preset is passed through when there is one.
 * Somebody who has already picked a direction is asking for three takes
 * within it, not three arguments against it.
 */
export interface MockupProviderOptions {
  model?: string;
  maxTokens?: number;
  effort?: PlanEffort;
  onUsage?: (usage: PlanUsage) => void;
  signal?: AbortSignal;
  /**
   * Called as output arrives (#189 review). The claim that this route
   * restores a real character count was written before the callback was
   * threaded, so it was false: the provider never asked the client for
   * progress, and the client never reported any.
   */
  onProgress?: (progress: PlanProgress) => void;
  style?: StylePresetId;
}

export interface MockupRequest {
  prompt: string;
}

export class MockupProvider {
  readonly id: string;
  readonly #client: PlanClient;
  readonly #model: string;
  readonly #maxTokens: number;
  readonly #effort: PlanEffort;
  readonly #onUsage?: (usage: PlanUsage) => void;
  readonly #signal?: AbortSignal;
  readonly #onProgress?: (progress: PlanProgress) => void;
  readonly #style?: StylePresetId;

  constructor(client: PlanClient, options: MockupProviderOptions = {}) {
    this.#client = client;
    this.#model = options.model ?? DEFAULT_MODEL;
    this.#maxTokens = options.maxTokens ?? mockupMaxTokensFor(this.#model);
    this.#effort = options.effort ?? DEFAULT_EFFORT;
    this.#onUsage = options.onUsage;
    this.#signal = options.signal;
    this.#onProgress = options.onProgress;
    this.#style = options.style;
    this.id = `${client.id}:${this.#model}`;
  }

  async generate(request: MockupRequest): Promise<ParsedMockupSet> {
    const direction = this.#style ? styleDirection(this.#style) : null;
    const completion = await this.#client.createPlan({
      system: MOCKUP_SYSTEM_PROMPT,
      prompt: direction
        ? `${request.prompt}\n\nStay within this visual direction; vary the three within it rather than against it.\n\n${direction}`
        : request.prompt,
      model: this.#model,
      maxTokens: this.#maxTokens,
      effort: this.#effort,
      ...(this.#signal ? { signal: this.#signal } : {}),
      ...(this.#onProgress ? { onProgress: this.#onProgress } : {}),
    });

    // Reported before anything can throw, for the same reason the build
    // provider does it: a refusal or a truncation still spends tokens, and
    // a ledger that counts only successes under-reports the bill.
    this.#onUsage?.(completion.usage);

    return readCompletion(completion, this.#maxTokens, MockupSetSchema);
  }
}
