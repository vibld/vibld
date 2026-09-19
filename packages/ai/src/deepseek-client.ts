import type { PlanClient, PlanCompletion, PlanRequest } from './client.ts';
import { PLAN_JSON_INSTRUCTION, outputFor } from './plan-output.ts';

/**
 * A second real model provider, behind the same `PlanClient` seam.
 *
 * Issue #9 asks for exactly this -- "prove a second real provider before
 * broad independence claims" -- and ADR-0003 is what makes it cheap: every
 * layer above `PlanClient` is already provider-agnostic, so this file is the
 * whole integration.
 *
 * Written against the REST API with plain `fetch` rather than a vendor SDK.
 * DeepSeek is OpenAI-compatible, so an SDK would buy nothing but a dependency
 * in a Worker bundle -- and the one thing ADR-0003 asks is that vendor
 * specifics stay in a file like this one.
 *
 * Two differences from the Anthropic path drive the design:
 *
 *  - There is no schema-constrained output. DeepSeek offers JSON *mode*
 *    (`response_format: {type: 'json_object'}`), not JSON *schema*, so the
 *    shape has to be asked for in the prompt and checked afterwards. The
 *    provider above already re-validates against `GenerationPlanSchema` and
 *    raises `ProviderShapeError`, so an off-shape reply is named rather than
 *    silently accepted -- but it is a real reliability difference, not a
 *    formatting detail, and it is why the schema is spelled out below.
 *  - JSON mode documents that it "may occasionally return empty content".
 *    That arrives here as a null plan, which the provider reports as a shape
 *    failure rather than a crash.
 */

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

/**
 * Asked for in the prompt because it cannot be enforced by the API.
 *
 * The word "json" is required -- DeepSeek's JSON mode does not engage without
 * it -- and the documentation asks for an example of the desired shape, so
 * both are here rather than in the shared system prompt, which must stay
 * provider-neutral.
 */
/**
 * Kept as an export because it is part of this module's public surface, but
 * it is no longer this module's constant: the shape a reply must take
 * belongs to the request now, not to the client (#189 review). This is the
 * plan's spelling of it, which is what every caller that does not say
 * otherwise still gets.
 */
export const JSON_MODE_INSTRUCTION = PLAN_JSON_INSTRUCTION;

/** OpenAI-style finish reasons, mapped to the vocabulary Vibld reasons about. */
export function mapFinishReason(
  reason: string | null | undefined,
): string | null {
  switch (reason) {
    case 'stop':
      return 'end_turn';
    // The output ceiling was hit. Mapping this is what lets
    // ProviderTruncationError fire instead of a confusing parse failure.
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'refusal';
    case null:
    case undefined:
      return null;
    default:
      return reason;
  }
}

interface StreamedChoice {
  delta?: {
    content?: string | null;
    /**
     * A reasoning model's thinking, streamed beside the answer. Billed as
     * output and counted against `max_tokens`, and deliberately not
     * appended to `text`: it is not part of the JSON the schema parses
     * (#190).
     */
    reasoning_content?: string | null;
  };
  finish_reason?: string | null;
}

interface StreamedUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  /**
   * Where a reasoning model reports its thinking separately. Already inside
   * `completion_tokens`, so this explains that figure rather than adding to
   * it (#190).
   */
  completion_tokens_details?: { reasoning_tokens?: number };
}

interface StreamedChunk {
  choices?: StreamedChoice[];
  usage?: StreamedUsage | null;
}

/**
 * Accumulate an OpenAI-style SSE completion stream.
 *
 * Exported so the framing can be tested without a network: chunk boundaries
 * do not respect frame boundaries, and a parser that assumed they did would
 * fail only against a real server.
 */
export async function readCompletionStream(
  body: ReadableStream<Uint8Array>,
  onProgress?: (progress: {
    characters: number;
    reasoningCharacters: number;
  }) => void,
): Promise<{
  text: string;
  finishReason: string | null;
  usage?: StreamedUsage;
  /**
   * Characters of reasoning seen, counted rather than kept. Nothing needs
   * the text; what was missing was any sign that it existed at all, which
   * is how a ceiling came to be reasoned about from the answer's size
   * alone (#190).
   */
  reasoningCharacters: number;
}> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let finishReason: string | null = null;
  let usage: StreamedUsage | undefined;
  let reasoningCharacters = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n');
      while (boundary !== -1) {
        const line = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + 1);
        boundary = buffer.indexOf('\n');
        if (!line.startsWith('data:')) continue;

        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;

        let chunk: StreamedChunk;
        try {
          chunk = JSON.parse(payload) as StreamedChunk;
        } catch {
          throw new Error('The model service sent a malformed stream chunk.');
        }

        const choice = chunk.choices?.[0];
        const delta = choice?.delta?.content;
        if (typeof delta === 'string') {
          text += delta;
          onProgress?.({ characters: text.length, reasoningCharacters });
        }
        // Counted, not accumulated, and deliberately not reported through
        // `onProgress`: that meter means "how much of the answer exists so
        // far", and folding thinking into it would make a different number
        // wrong (#190).
        const reasoning = choice?.delta?.reasoning_content;
        if (typeof reasoning === 'string') {
          reasoningCharacters += reasoning.length;
          // Reported as it arrives, not only alongside the answer. A
          // reasoning model thinks first, so a run cancelled early has
          // streamed nothing but this, and a caller told only about the
          // answer would settle a minute of billed thinking at zero
          // (#190). `characters` is unchanged here, so the meter still
          // means what it meant.
          onProgress?.({ characters: text.length, reasoningCharacters });
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        // Usage arrives on its own final chunk, whose `choices` is empty.
        if (chunk.usage) usage = chunk.usage;
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { text, finishReason, usage, reasoningCharacters };
}

/** Parse the reply without throwing, exactly as the Anthropic client does. */
export function readJsonPlan(text: string): unknown {
  if (text.trim().length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Truncated JSON is not a parse bug. The caller knows the stop reason and
    // names it; a null plan is all this needs to return.
    return null;
  }
}

export interface DeepseekPlanClientOptions {
  apiKey?: string;
  baseUrl?: string;
  /** Injected in tests; production callers leave it unset. */
  fetchImpl?: typeof fetch;
}

/** Rough, deliberately generous. Only used when the stream omits usage. */
function estimateTokens(characters: number): number {
  return Math.max(1, Math.ceil(characters / 4));
}

export function createDeepseekPlanClient(
  options: DeepseekPlanClientOptions = {},
): PlanClient {
  const apiKey = options.apiKey ?? globalThis.process?.env?.DEEPSEEK_API_KEY;
  const baseUrl = options.baseUrl ?? DEEPSEEK_BASE_URL;
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  return {
    id: 'deepseek',
    async createPlan(request: PlanRequest): Promise<PlanCompletion> {
      if (!apiKey) {
        throw new Error(
          'DEEPSEEK_API_KEY is not set, so no DeepSeek request can be made.',
        );
      }

      // What this client really sends: the caller's system prompt with the
      // output instruction appended, plus the user prompt. That appended
      // paragraph is this client's alone, which is why measuring it here is
      // the only way to be right (#189 review).
      const systemSent = `${request.system}\n\n${outputFor(request).instruction}`;
      request.onPromptChars?.(systemSent.length + request.prompt.length);

      const response = await doFetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          max_tokens: request.maxTokens,
          // Streamed for the same reason the Anthropic path is: a whole
          // project takes minutes, and the progress meter is fed from the
          // text arriving rather than from a spinner.
          stream: true,
          stream_options: { include_usage: true },
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              // The shape the caller asked for (#189 review). This always
              // described a generation plan, so a mockup prompt was
              // followed by a paragraph contradicting it.
              content: systemSent,
            },
            { role: 'user', content: request.prompt },
          ],
        }),
        ...(request.signal ? { signal: request.signal } : {}),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        // The key must never reach an error message or a log.
        throw new Error(
          `DeepSeek rejected the request (${response.status}).${detail ? ` ${detail.slice(0, 200)}` : ''}`,
        );
      }
      if (!response.body) {
        throw new Error('DeepSeek returned an empty response.');
      }

      const { text, finishReason, usage, reasoningCharacters } =
        await readCompletionStream(
          response.body,
          request.onProgress
            ? (progress) => request.onProgress?.(progress)
            : undefined,
        );

      // `systemSent`, not `request.system`: the same figure `onPromptChars`
      // reports, and for the same reason (#189 review). This estimate feeds
      // the fallback usage when a stream ends without its terminal chunk,
      // so leaving it on the un-appended system prompt under-reported a
      // mockup run by the length of the output instruction.
      //
      // I fixed the report and not this, one round earlier, which is the
      // fourth time this review has caught me repairing the case in front
      // of me and not the one beside it. Both now read one variable.
      const promptCharacters = systemSent.length + request.prompt.length;

      return {
        plan: readJsonPlan(text),
        // Said here because here is the only place that knows. Above this,
        // an empty body and unparseable JSON are both a null plan (#191
        // review).
        ...(text.trim().length === 0 ? { emptyBody: true } : {}),
        stopReason: mapFinishReason(finishReason),
        ...(mapFinishReason(finishReason) === 'refusal'
          ? { refusal: { category: 'content_filter', explanation: null } }
          : {}),
        usage: {
          // Estimated only when the stream omitted usage. Over-reporting is
          // the safe direction for a budget; under-reporting is not.
          inputTokens: usage?.prompt_tokens ?? estimateTokens(promptCharacters),
          // Reasoning counted in, because DeepSeek bills it as output
          // (#191 review). This estimate is reached only when a stream ends
          // without its terminal usage chunk, and on that path the answer's
          // length alone is not the run: two thirds of a measured mockup
          // run's output tokens were thinking (#190), so a reasoning-heavy
          // reply settled at a third of its cost, and the empty reply this
          // same commit retries settled at nothing at all.
          //
          // The stream already counts these characters for the progress
          // meter. Not counting them here was the same omission as pricing
          // a cancelled run on `characters` alone, in the one place that
          // had not been corrected yet.
          outputTokens:
            usage?.completion_tokens ??
            estimateTokens(text.length + reasoningCharacters),
          cacheReadInputTokens: usage?.prompt_cache_hit_tokens ?? 0,
          // Same as OpenAI: caching is automatic, the write is not charged,
          // and `prompt_tokens` above already includes the hit tokens.
          cacheWriteInputTokens: 0,
        },
        // Reported only where there is something to report, so "this
        // provider does not say" stays distinguishable from "none" (#190).
        ...(reasoningCharacters > 0 ||
        usage?.completion_tokens_details?.reasoning_tokens !== undefined
          ? {
              diagnostics: {
                ...(reasoningCharacters > 0 ? { reasoningCharacters } : {}),
                ...(usage?.completion_tokens_details?.reasoning_tokens !==
                undefined
                  ? {
                      reasoningTokens:
                        usage.completion_tokens_details.reasoning_tokens,
                    }
                  : {}),
              },
            }
          : {}),
      };
    },
  };
}
