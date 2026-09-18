import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { outputFor } from './plan-output.ts';
import { findModel } from './model-catalogue.ts';
import type {
  PlanClient,
  PlanCompletion,
  PlanRequest,
  PlanUsage,
} from './client.ts';

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

/**
 * Anthropic's three input counters, totalled into the one meaning
 * `PlanUsage` defines.
 *
 * `input_tokens` here is the uncached remainder: it excludes both cache
 * figures rather than breaking down into them, which is the opposite of what
 * OpenAI and DeepSeek report. Mapping it straight across would under-report
 * the input side of every cached run, and would make the cached fraction a
 * ratio of one number to a different number that does not contain it.
 */
export function usageOf(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): PlanUsage {
  const read = usage.cache_read_input_tokens ?? 0;
  const written = usage.cache_creation_input_tokens ?? 0;
  return {
    inputTokens: usage.input_tokens + read + written,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: read,
    cacheWriteInputTokens: written,
  };
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
      // Streaming, and not the `messages.parse` helper, both on purpose.
      //
      // Streaming because the SDK refuses a non-streaming request whose
      // max_tokens could run past ten minutes -- at a 64000-token ceiling it
      // throws "Streaming is required for operations that may take longer than
      // 10 minutes" before sending anything. A whole project needs that
      // ceiling, so the request has to stream.
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

      // `effort` is not universal. Haiku 4.5 rejects it with a 400, so the
      // catalogue records which models accept it and the parameter is omitted
      // rather than sent hopefully. An unknown model is assumed to accept it:
      // the catalogue is the closed set every caller is checked against, so
      // reaching here with an id it does not hold means a test double, and
      // silently dropping effort there would hide a real mistake.
      const known = findModel(request.model);
      const effort =
        known && !known.supportsEffort ? undefined : request.effort;

      // Never ask for more output than the model will produce. Past its
      // ceiling the request is rejected outright rather than truncated, which
      // would read as an outage rather than as the wrong model for the job.
      const maxTokens = known
        ? Math.min(request.maxTokens, known.maxOutputTokens)
        : request.maxTokens;

      // The schema travels in `output_config` rather than in the prompt, so
      // what goes as prompt is exactly these two (#189 review).
      request.onPromptChars?.(request.system.length + request.prompt.length);

      const stream = client.messages.stream(
        {
          model: request.model,
          max_tokens: maxTokens,
          // One cache breakpoint, on the system prompt, and it is the only
          // one this request can honestly place (#166).
          //
          // A cache entry matches a prefix, so a marker only pays where
          // everything before it is byte-identical from one request to the
          // next. Exactly one part of this request is: the system prompt,
          // which is the same ~2,700 tokens for every run by every user of
          // the deployment. Everything in the user message begins with the
          // person's own words and is different every time.
          //
          // The project's own files are the larger half of an iterating
          // run's input and are deliberately *not* cached: the accepted
          // revision changes on every run that applies anything, so the
          // block would be rewritten between consecutive turns and the
          // marker would pay the write premium every time to match nothing.
          // A breakpoint there starts paying the day two requests share a
          // base revision, which is not the loop this product has.
          //
          // As an array rather than the plain string this used to be,
          // because the directive is read from inside a content block. At
          // the message level it is ignored silently, so the failure mode is
          // an unchanged bill rather than an error, which is why
          // `anthropic-client.test.ts` asserts the shape rather than trusting
          // it.
          system: [
            {
              type: 'text',
              text: request.system,
              cache_control: { type: 'ephemeral' },
            },
          ],
          output_config: {
            ...(effort ? { effort } : {}),
            // The schema the *caller* asked for, not this client's idea of
            // one (#189 review). Hard-coding it here made a mockup run
            // structurally impossible: the prompt asked for a set of
            // directions and the API constrained the reply to a plan.
            format: zodOutputFormat(outputFor(request).schema),
          },
          messages: [{ role: 'user', content: request.prompt }],
        },
        request.signal ? { signal: request.signal } : undefined,
      );

      // Counted rather than estimated: this is the plan's own text arriving.
      // The caller decides how often to surface it -- reporting every delta
      // would be thousands of updates for one generation.
      if (request.onProgress) {
        let characters = 0;
        stream.on('text', (delta) => {
          characters += delta.length;
          request.onProgress?.({ characters });
        });
      }

      const response = await stream.finalMessage();

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
        usage: usageOf(response.usage),
      };
    },
  };
}
