import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { GenerationPlanSchema } from './plan-schema.ts';
import type { PlanClient, PlanCompletion, PlanRequest } from './client.ts';

export interface AnthropicPlanClientOptions {
  /** Omit to let the SDK resolve credentials from the environment. */
  apiKey?: string;
  /** Injected in tests; production callers leave it unset. */
  client?: Anthropic;
}

/**
 * The only file in Vibld that imports a model vendor's SDK.
 *
 * Structured outputs are used rather than "reply with JSON" prompting so the
 * response is schema-valid by construction; the provider still re-validates,
 * because a null `parsed_output` is a documented outcome.
 */
export function createAnthropicPlanClient(
  options: AnthropicPlanClientOptions = {},
): PlanClient {
  const client =
    options.client ??
    new Anthropic(options.apiKey ? { apiKey: options.apiKey } : undefined);

  return {
    id: 'anthropic',
    async createPlan(request: PlanRequest): Promise<PlanCompletion> {
      const response = await client.messages.parse({
        model: request.model,
        max_tokens: request.maxTokens,
        system: request.system,
        output_config: {
          effort: request.effort,
          format: zodOutputFormat(GenerationPlanSchema),
        },
        messages: [{ role: 'user', content: request.prompt }],
      });

      return {
        plan: response.parsed_output ?? null,
        stopReason: response.stop_reason,
        refusal:
          response.stop_reason === 'refusal'
            ? {
                category: response.stop_details?.category ?? null,
                explanation: response.stop_details?.explanation ?? null,
              }
            : undefined,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
        },
      };
    },
  };
}
