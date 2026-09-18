/**
 * The seam between Vibld and a model SDK.
 *
 * ADR-0003 keeps provider SDK types out of domain APIs. Everything above this
 * file talks in `PlanRequest` / `PlanCompletion`; only `anthropic-client.ts`
 * imports a vendor SDK. That also makes the provider unit-testable without a
 * network or a key: tests supply their own `PlanClient`.
 */

export type PlanEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

import type { PlanOutput } from './plan-output.ts';

export interface PlanRequest {
  system: string;
  prompt: string;
  model: string;
  maxTokens: number;
  effort: PlanEffort;
  /**
   * Abandons the call. A generation that nobody is waiting for is still
   * billed until the request to the model ends, so the ability to end it is
   * part of the contract rather than an SDK detail.
   */
  signal?: AbortSignal;
  /**
   * Called as output arrives, so a caller can show that work is happening.
   *
   * A whole project takes minutes to write. Without a signal that something
   * is being produced, a long generation is indistinguishable from a hung
   * one -- which is exactly how this looked before it worked.
   */
  onProgress?: (progress: PlanProgress) => void;
  /**
   * What shape the reply must take. Defaults to a generation plan.
   *
   * Part of the *request* rather than of the client, which is the whole of
   * the P1 this fixed (#189 review): every client hard-coded the plan's
   * schema, so a mockup run asked for one thing in its prompt and was
   * constrained to another by the API.
   */
  output?: PlanOutput;
  /**
   * The size of the prompt this client actually sent, in characters,
   * reported once just before the request goes out.
   *
   * Exists because only the client knows (#189 review). The route settling
   * a cancelled run was reconstructing the figure from the system prompt
   * and the user prompt, which is right for two of the three clients and
   * wrong for DeepSeek, where the output instruction is appended to the
   * system message. Reconstructing what somebody else assembled is the
   * two-places-that-must-agree problem, and here the two were provider
   * specific, so they could not have agreed for long.
   *
   * Characters rather than tokens: no client has a tokenizer, and the
   * estimate that turns this into money lives in one place already.
   */
  onPromptChars?: (characters: number) => void;
}

export interface PlanProgress {
  /** Characters of the plan written so far. Not tokens; no tokenizer here. */
  characters: number;
}

/**
 * What one call to a model consumed, in the one meaning every client reports.
 *
 * `inputTokens` is **all** prompt tokens, including the ones served from the
 * provider's cache and the ones it wrote into the cache. That has to be said,
 * because the providers do not agree: OpenAI's `input_tokens` and DeepSeek's
 * `prompt_tokens` already include their cached tokens (the cached count is a
 * breakdown of the total), while Anthropic's `input_tokens` excludes both
 * `cache_read_input_tokens` and `cache_creation_input_tokens`. Mapped
 * straight across, the same field would mean two different things and the
 * cached fraction would be a ratio of unrelated numbers.
 *
 * So each client normalises to this definition, and the two cache figures are
 * subsets of the total rather than additions to it:
 *
 *     inputTokens = uncached + cacheReadInputTokens + cacheWriteInputTokens
 */
export interface PlanUsage {
  inputTokens: number;
  outputTokens: number;
  /** Prompt tokens the provider served from its cache, at its cached rate. */
  cacheReadInputTokens: number;
  /**
   * Prompt tokens the provider wrote into its cache on this request, which
   * cost more than an ordinary input token rather than less.
   *
   * Zero for a provider that caches automatically and does not charge for
   * the write (OpenAI and DeepSeek both do this): there is no write to
   * report, not a write being hidden.
   */
  cacheWriteInputTokens: number;
}

export interface PlanRefusal {
  category: string | null;
  explanation: string | null;
}

/**
 * What a run spent that the caller cannot otherwise see.
 *
 * A reasoning model bills its thinking as output tokens and counts it
 * against `max_tokens`, but never streams it as content, so a caller
 * watching characters is watching the wrong number. That is not a
 * hypothetical: the first real mockup run truncated at an 18,000-token
 * ceiling having streamed 19,203 characters, which is 0.9 characters per
 * output token where this codebase assumes four (#190).
 *
 * Optional because it is provider-specific. A client that has nothing to
 * report leaves it unset rather than reporting zero, so "this provider does
 * not say" and "this provider says none" stay different answers.
 */
export interface PlanDiagnostics {
  /** Characters of reasoning streamed, where the provider streams it. */
  reasoningCharacters?: number;
  /** Reasoning tokens the provider itself reported, where it reports them. */
  reasoningTokens?: number;
}

export interface PlanCompletion {
  /** Parsed structured output, still unvalidated. The provider checks it. */
  plan: unknown;
  /** Why generation stopped. `max_tokens` means the plan is truncated. */
  stopReason: string | null;
  refusal?: PlanRefusal;
  usage: PlanUsage;
  /** Provider-specific spend the usage figures do not explain. */
  diagnostics?: PlanDiagnostics;
}

export interface PlanClient {
  readonly id: string;
  createPlan(request: PlanRequest): Promise<PlanCompletion>;
}
