import type {
  GenerationPlan,
  GenerationRequest,
  ModelProvider,
} from '@vibld/core';
import type {
  PlanClient,
  PlanEffort,
  PlanProgress,
  PlanUsage,
} from './client.ts';
import { GenerationPlanSchema, PLAN_SYSTEM_PROMPT } from './plan-schema.ts';
import { MAX_BASE_CONTENT_CHARS, MAX_KNOWLEDGE_CHARS } from './limits.ts';
import { styleDirection } from './style-presets.ts';
import type { StylePresetId } from './style-presets.ts';
import { patternGuidance } from './patterns.ts';
import {
  ProviderContextError,
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
  /** Forwarded to the client so a caller can report generation progress. */
  onProgress?: (progress: PlanProgress) => void;
  /**
   * A named visual direction to start from. Ids only: the value crosses the
   * network, and a closed set is what stops caller text becoming prompt.
   */
  style?: StylePresetId;
  /**
   * Standing instructions for the project. Unlike a style preset this is the
   * user's own prose, which is fine: it is their instruction about their own
   * generation, and the prompt already carries their arbitrary text. What it
   * is not is unbounded -- see MAX_KNOWLEDGE_CHARS.
   */
  knowledge?: string;
}

export const DEFAULT_MODEL = 'claude-opus-5';
/**
 * A whole multi-file project has to fit in one response.
 *
 * 16000 was the reason generation never once succeeded: a landing page with
 * several components ran past it, the structured output arrived cut off
 * mid-string, and the run died with an unreadable JSON parse error. Opus 5
 * accepts up to 128000; 64000 is the documented default for a response of
 * this shape and leaves real headroom.
 *
 * This is the number the run budget prices its worst case from, so raising it
 * raises what a single run may cost. That is the trade being made: a ceiling
 * low enough to truncate is not cheaper, it just fails.
 */
export const DEFAULT_MAX_TOKENS = 64000;
export const DEFAULT_EFFORT: PlanEffort = 'high';

/**
 * A `ModelProvider` (from @vibld/core) backed by a real model.
 *
 * It is a drop-in peer of `FakeModelProvider`: same contract, same call shape,
 * so the runner, the state machine and the UI are unchanged. CI keeps using
 * the fake — nothing here runs without credentials (ADR-0007).
 */
/**
 * Turns a prompt into a validated `GenerationPlan`, whichever service answers.
 *
 * Named for what it does rather than for a vendor: it holds no vendor
 * specifics at all, only a `PlanClient`. That was true when Anthropic was the
 * only client and the name said otherwise; it became visibly wrong the moment
 * a second provider existed and the worker read
 * `new AnthropicModelProvider(deepseekClient)`.
 */
export class PlanProvider implements ModelProvider {
  readonly id: string;
  readonly #client: PlanClient;
  readonly #model: string;
  readonly #maxTokens: number;
  readonly #effort: PlanEffort;
  readonly #onUsage?: (usage: PlanUsage) => void;
  readonly #signal?: AbortSignal;
  readonly #onProgress?: (progress: PlanProgress) => void;
  readonly #style?: StylePresetId;
  readonly #knowledge?: string;

  constructor(client: PlanClient, options: ModelProviderOptions = {}) {
    this.#client = client;
    this.#model = options.model ?? DEFAULT_MODEL;
    this.#maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.#effort = options.effort ?? DEFAULT_EFFORT;
    this.#onUsage = options.onUsage;
    this.#signal = options.signal;
    this.#onProgress = options.onProgress;
    this.#style = options.style;
    this.#knowledge = options.knowledge;
    this.id = `${client.id}:${this.#model}`;
  }

  async generate(request: GenerationRequest): Promise<GenerationPlan> {
    const completion = await this.#client.createPlan({
      system: PLAN_SYSTEM_PROMPT,
      prompt: buildUserPrompt(request, this.#style, this.#knowledge),
      model: this.#model,
      maxTokens: this.#maxTokens,
      effort: this.#effort,
      ...(this.#signal ? { signal: this.#signal } : {}),
      ...(this.#onProgress ? { onProgress: this.#onProgress } : {}),
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
 * edits rather than replacing the user's work.
 *
 * File *contents* are sent, not only paths. Sending paths alone made the
 * instruction below unfulfillable: a model cannot preserve what it has never
 * seen, so every follow-up rewrote the project from scratch and the second
 * prompt -- the one iteration is for -- silently threw the first away.
 *
 * ADR-0007 rejects "whole-repository context on every request" as an
 * alternative, for cost and disclosure. That reasoning is about a repository.
 * This is a project the user generated in this session, bounded at 25 files
 * by the system prompt, that they are actively editing: there is no third
 * party's code here and nothing to disclose. Targeted retrieval (#12) is
 * still the answer once arbitrary repository import exists; it needs
 * infrastructure that does not, and it is not a reason to ship an iteration
 * that does not iterate. See docs/adr/0009.
 *
 * The project is sent as JSON, in the same shape the model returns. A file
 * whose contents happened to contain a plausible delimiter could otherwise
 * forge a boundary and appear to end the data and begin an instruction;
 * JSON escaping removes that, and matching the output shape makes "return
 * the complete set of files" unambiguous.
 */
export function buildUserPrompt(
  request: GenerationRequest,
  style?: string | null,
  knowledge?: string | null,
): string {
  const base = request.base;
  const parts = [request.prompt];

  // Standing instructions come straight after the request and before
  // everything else, because they are the user's own words about every turn
  // rather than about this one. Subordinate to the request in the same way a
  // style preset is: someone who has written "keep it dark" and then asks for
  // a white page means the white page.
  const standing = knowledge?.trim();
  if (standing) {
    if (standing.length > MAX_KNOWLEDGE_CHARS) {
      throw new ProviderContextError(standing.length, MAX_KNOWLEDGE_CHARS);
    }
    parts.push(
      `Standing instructions for this project, which apply to every request:

${standing}

Where these conflict with the request above, follow the request.`,
    );
  }

  if (base && base.files.length > 0) {
    const total = base.files.reduce(
      (sum, file) => sum + file.path.length + file.content.length,
      0,
    );
    if (total > MAX_BASE_CONTENT_CHARS) {
      // Never silently truncate. A partial project would be returned as if it
      // were the whole one, and the files that did not fit would be deleted
      // by the promotion below -- losing the user's work to save tokens.
      throw new ProviderContextError(total, MAX_BASE_CONTENT_CHARS);
    }

    parts.push(
      `The project already exists at revision ${base.revision}. These are its
current files, as JSON in the same shape you must return:

${JSON.stringify(base.files)}

Return the complete set of files for the updated project. Every file the
project should still contain must be in your response with its full content,
including files your change does not touch -- a file you leave out is deleted.
Preserve anything the request does not ask you to change.`,
    );
  }

  // L50: a handful of relevant patterns, retrieved on demand -- structural
  // guidance, so it comes before the purely visual style direction below.
  const guidance = patternGuidance(request.prompt);
  if (guidance) parts.push(guidance);

  // Last, and explicitly subordinate to the request. A preset is a starting
  // point; an instruction the user actually typed outranks it.
  const direction = styleDirection(style);
  if (direction) parts.push(direction);

  return parts.join('\n\n');
}
