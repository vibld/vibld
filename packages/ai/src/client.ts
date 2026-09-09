/**
 * The seam between Vibld and a model SDK.
 *
 * ADR-0003 keeps provider SDK types out of domain APIs. Everything above this
 * file talks in `PlanRequest` / `PlanCompletion`; only `anthropic-client.ts`
 * imports a vendor SDK. That also makes the provider unit-testable without a
 * network or a key: tests supply their own `PlanClient`.
 */

export type PlanEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

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
}

export interface PlanProgress {
  /** Characters of the plan written so far. Not tokens; no tokenizer here. */
  characters: number;
}

export interface PlanUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
}

export interface PlanRefusal {
  category: string | null;
  explanation: string | null;
}

export interface PlanCompletion {
  /** Parsed structured output, still unvalidated. The provider checks it. */
  plan: unknown;
  /** Why generation stopped. `max_tokens` means the plan is truncated. */
  stopReason: string | null;
  refusal?: PlanRefusal;
  usage: PlanUsage;
}

export interface PlanClient {
  readonly id: string;
  createPlan(request: PlanRequest): Promise<PlanCompletion>;
}
