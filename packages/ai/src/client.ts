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
