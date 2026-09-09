import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { GenerationPlanSchema } from './plan-schema.ts';
import type { PlanClient, PlanCompletion, PlanRequest } from './client.ts';

/**
 * Pull the structured output out of the response without throwing.
 *
 * A truncated response is not a parse bug and must not be reported as one:
 * the caller checks `stop_reason` and raises the error that says the output
 * ceiling was hit. So this returns null rather than throwing, and lets the
 * layer that knows why generation stopped do the explaining.
 */
export function readStructuredOutput(
  content: { type: string; text?: string }[],
  stopReason: string | null,
): unknown {
  const text = content.find((block) => block.type === 'text')?.text;
  if (text === undefined) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Unparseable JSON with a max_tokens stop is truncation, which the caller
    // names precisely. Unparseable JSON without one is a shape failure, which
    // it also names -- both from a null plan.
    void stopReason;
    return null;
  }
}

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
      // `messages.create` rather than the `messages.parse` helper, on purpose.
      //
      // `parse` validates the structured output and throws if it cannot. When
      // the model hits the output ceiling the JSON arrives cut off mid-string,
      // so `parse` throws while parsing -- before any caller can look at
      // `stop_reason`. The truncation is then reported as an unreadable
      // "Unterminated string in JSON at position 11755" rather than as what it
      // is, and ProviderTruncationError never gets the chance to fire.
      //
      // Reading the raw response first means the stop reason is known before
      // anything is parsed, so a truncated plan is named as truncated. The
      // schema is still enforced -- the provider validates it a layer up.
      const response = await client.messages.create(
        {
          model: request.model,
          max_tokens: request.maxTokens,
          system: request.system,
          output_config: {
            effort: request.effort,
            format: zodOutputFormat(GenerationPlanSchema),
          },
          messages: [{ role: 'user', content: request.prompt }],
        },
        request.signal ? { signal: request.signal } : undefined,
      );

      return {
        plan: readStructuredOutput(response.content, response.stop_reason),
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
