import type { PlanClient, PlanCompletion, PlanRequest } from './client.ts';

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
export const JSON_MODE_INSTRUCTION = `OUTPUT FORMAT
Reply with a single json object and nothing else. No prose, no markdown, no
code fence. It must match this shape exactly:

{
  "summary": "one sentence describing what you built",
  "files": [
    { "path": "package.json", "content": "<the complete file>" }
  ]
}

"files" must contain every file of the project, each with its full content.`;

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
  delta?: { content?: string | null };
  finish_reason?: string | null;
}

interface StreamedUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
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
  onProgress?: (characters: number) => void,
): Promise<{
  text: string;
  finishReason: string | null;
  usage?: StreamedUsage;
}> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let finishReason: string | null = null;
  let usage: StreamedUsage | undefined;

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
          onProgress?.(text.length);
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        // Usage arrives on its own final chunk, whose `choices` is empty.
        if (chunk.usage) usage = chunk.usage;
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { text, finishReason, usage };
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
              content: `${request.system}\n\n${JSON_MODE_INSTRUCTION}`,
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

      const { text, finishReason, usage } = await readCompletionStream(
        response.body,
        request.onProgress
          ? (characters) => request.onProgress?.({ characters })
          : undefined,
      );

      const promptCharacters = request.system.length + request.prompt.length;

      return {
        plan: readJsonPlan(text),
        stopReason: mapFinishReason(finishReason),
        ...(mapFinishReason(finishReason) === 'refusal'
          ? { refusal: { category: 'content_filter', explanation: null } }
          : {}),
        usage: {
          // Estimated only when the stream omitted usage. Over-reporting is
          // the safe direction for a budget; under-reporting is not.
          inputTokens: usage?.prompt_tokens ?? estimateTokens(promptCharacters),
          outputTokens: usage?.completion_tokens ?? estimateTokens(text.length),
          cacheReadInputTokens: usage?.prompt_cache_hit_tokens ?? 0,
        },
      };
    },
  };
}
