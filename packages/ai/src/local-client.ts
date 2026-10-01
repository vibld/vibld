import type { PlanClient, PlanCompletion, PlanRequest } from './client.ts';
import {
  mapFinishReason,
  readCompletionStream,
  readJsonPlan,
  unreadableReason,
} from './deepseek-client.ts';
import { ProviderError } from './errors.ts';
import { CHARS_PER_OUTPUT_TOKEN } from './limits.ts';
import { outputFor } from './plan-output.ts';

/**
 * A model the owner runs on their own machine (docs/decisions.md D124, D138).
 *
 * Ollama, LM Studio and llama.cpp's server all answer OpenAI's chat
 * completions API, so this is the DeepSeek client's request without the
 * parts only a hosted service accepts, sent to an address the owner sets:
 *
 *   VIBLD_LOCAL_BASE_URL  http://localhost:11434/v1 (Ollama), or
 *                         http://localhost:1234/v1 (LM Studio), or
 *                         http://localhost:8080/v1 (llama.cpp)
 *   VIBLD_LOCAL_MODEL     the server's own name for it, "qwen3-coder:30b"
 *   VIBLD_LOCAL_API_KEY   only for a server started with one
 *
 * The catalog holds one entry for it, `local`, so the id that crosses the
 * network from the browser is still one of a closed set: the deployment,
 * not the request, decides which model that is.
 *
 * What differs from the hosted clients, each found against a real Ollama:
 *
 * - No `reasoning_effort`. Ollama refuses the whole request when the model
 *   does not think ("does not support thinking"), and most local models do
 *   not.
 * - JSON mode is asked for and dropped if the server refuses it. Ollama and
 *   llama.cpp accept `{type: 'json_object'}`; a server that does not is
 *   asked again without it, and the reply is read the way the DeepSeek
 *   client reads one, tolerating a code fence around the object.
 * - A prompt longer than the model's context window is cut silently. Ollama
 *   keeps what fits and answers as though nothing happened, so a build
 *   would fail later as a reply that does not make sense. The usage it
 *   reports says how much it read, and a reading under half of what was
 *   sent is named here as the context window it is.
 * - Every failure is a `ProviderError`, whose message reaches the person.
 *   The hosted clients' errors are replaced with "failed unexpectedly"
 *   before anyone sees them, which is right for a service the owner does
 *   not run and useless for one they do: "is it running?" is the answer
 *   most of the time. The messages name the setting, never its value, so
 *   an address on the owner's network is not shown to everybody who
 *   builds with the copy.
 */

/** The catalog's id for whichever model the owner runs (D124). */
export const LOCAL_MODEL_ID = 'local';

export interface LocalModelSettings {
  /** The server's OpenAI-compatible base, ending before `/chat/completions`. */
  baseUrl: string;
  /** The model's name on that server. */
  model: string;
  apiKey?: string;
}

export interface LocalModelEnv {
  VIBLD_LOCAL_BASE_URL?: string | undefined;
  VIBLD_LOCAL_MODEL?: string | undefined;
  VIBLD_LOCAL_API_KEY?: string | undefined;
}

/**
 * The owner's local model, or null when either setting is missing or
 * blank. Both are needed: a server with no model named answers nothing, and
 * a name with nowhere to send it is the same.
 */
export function localModelSettings(
  env: LocalModelEnv,
): LocalModelSettings | null {
  const baseUrl = env.VIBLD_LOCAL_BASE_URL?.trim().replace(/\/+$/, '');
  const model = env.VIBLD_LOCAL_MODEL?.trim();
  if (!baseUrl || !model) return null;
  const apiKey = env.VIBLD_LOCAL_API_KEY?.trim();
  return { baseUrl, model, ...(apiKey ? { apiKey } : {}) };
}

/**
 * The share of what was sent a server must report reading before the
 * prompt counts as whole, against an estimate of four characters a token.
 *
 * Measured, not assumed: a build's outline prompt (22,591 characters) read
 * as 5,809 tokens on Qwen2.5's tokenizer through Ollama, 3.89 characters a
 * token, so a whole prompt reports slightly more than the estimate, and
 * code and markup more again. A floor of 80% still passes a tokenizer that
 * packs five characters into a token, and catches a prompt that lost a
 * fifth or more: Ollama with a 2,048-token window read 1,026 tokens of a
 * 40,000-character prompt. A smaller loss is inside what tokenizers differ
 * by, so a count of characters cannot see it; the README asks for a
 * window of 32,768 tokens, which a build's prompts fit.
 */
export const LOCAL_PROMPT_READ_FLOOR = 0.8;

/** What a local model that cannot finish a build is told to try (D124). */
export const LOCAL_MODEL_ADVICE =
  'This copy builds with a model running on its own machine, and that model ' +
  'could not finish. A larger model usually can; README.md, "Local models", ' +
  'says what to try.';

export interface LocalPlanClientOptions extends LocalModelSettings {
  /** Injected in tests; production callers leave it unset. */
  fetchImpl?: typeof fetch;
}

/** Rough, deliberately generous. Only used when the stream omits usage. */
function estimateTokens(characters: number): number {
  return Math.max(1, Math.ceil(characters / CHARS_PER_OUTPUT_TOKEN));
}

/** A refusal of JSON mode itself, as opposed to anything else in the body. */
function refusedJsonMode(status: number, detail: string): boolean {
  return status === 400 && /response_format|json_object/i.test(detail);
}

export function createLocalPlanClient(
  options: LocalPlanClientOptions,
): PlanClient {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  // Learned once per client: a server that refused JSON mode will refuse
  // it on every call of the run, and asking twice each time doubles the
  // requests for nothing.
  let jsonMode = true;

  async function send(
    request: PlanRequest,
    messages: { role: string; content: string }[],
  ): Promise<Response> {
    const body = {
      model: options.model,
      max_tokens: request.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      messages,
    };
    try {
      return await doFetch(`${options.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.apiKey
            ? { authorization: `Bearer ${options.apiKey}` }
            : {}),
        },
        body: JSON.stringify(body),
        ...(request.signal ? { signal: request.signal } : {}),
      });
    } catch (error) {
      if (request.signal?.aborted) throw error;
      if (timedOut(error)) {
        throw new ProviderError(
          'The local model server took too long to start answering. On a ' +
            'machine without a GPU, a model can take minutes to read ' +
            'vibld’s prompt; a machine with one reads it in seconds.',
        );
      }
      throw new ProviderError(
        'Could not reach the local model server set in VIBLD_LOCAL_BASE_URL. ' +
          'Check that it is running and that the address is the one this ' +
          'copy can reach.',
      );
    }
  }

  return {
    id: 'local',
    async createPlan(request: PlanRequest): Promise<PlanCompletion> {
      const systemSent = `${request.system}\n\n${outputFor(request).instruction}`;
      const userText = (request.cachePrefix ?? '') + request.prompt;
      const promptCharacters = systemSent.length + userText.length;
      request.onPromptChars?.(promptCharacters);
      const messages = [
        { role: 'system', content: systemSent },
        { role: 'user', content: userText },
      ];

      let response = await send(request, messages);
      if (!response.ok && jsonMode) {
        const detail = await response.text().catch(() => '');
        if (!refusedJsonMode(response.status, detail)) {
          throw failedResponse(response.status, detail, options.model);
        }
        jsonMode = false;
        response = await send(request, messages);
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw failedResponse(response.status, detail, options.model);
      }
      if (!response.body) {
        throw new ProviderError(
          'The local model server returned an empty response.',
        );
      }

      const { text, finishReason, usage, reasoningCharacters } =
        await readCompletionStream(
          response.body,
          request.onProgress
            ? (progress) => request.onProgress?.(progress)
            : undefined,
        );

      const sentTokens = estimateTokens(promptCharacters);
      // How much of the prompt the server read. Cached (reused) tokens are
      // part of `prompt_tokens`, as OpenAI's format has it and as Ollama
      // reports them: 2,176 prompt tokens with 2,162 of them cached,
      // measured 2026-10-01. So the count is taken as it is, never added
      // to (Codex review of internal PR 346).
      const read = usage?.prompt_tokens;
      if (
        typeof read === 'number' &&
        read < sentTokens * LOCAL_PROMPT_READ_FLOOR
      ) {
        throw new LocalContextError(read, sentTokens);
      }

      const plan = readJsonPlan(text);
      const stopReason = mapFinishReason(finishReason);
      return {
        plan,
        ...(text.trim().length === 0 ? { emptyBody: true } : {}),
        ...(plan === null &&
        text.trim().length > 0 &&
        stopReason !== 'max_tokens'
          ? {
              failure: {
                finished: true,
                reason: unreadableReason(text, finishReason),
              },
            }
          : {}),
        stopReason,
        ...(stopReason === 'refusal'
          ? { refusal: { category: 'content_filter', explanation: null } }
          : {}),
        usage: {
          // Every prompt token, as `PlanUsage` counts them.
          inputTokens: read ?? sentTokens,
          outputTokens:
            usage?.completion_tokens ??
            estimateTokens(text.length + reasoningCharacters),
          // Nothing is billed, so nothing about the cache needs to be.
          cacheReadInputTokens: 0,
          cacheWriteInputTokens: 0,
        },
        ...(reasoningCharacters > 0
          ? { diagnostics: { reasoningCharacters } }
          : {}),
      };
    },
  };
}

/**
 * Whether a failed fetch was a wait that ran out rather than a server that
 * was not there. Node gives up on response headers after five minutes
 * (undici's `UND_ERR_HEADERS_TIMEOUT`), and a 7B model on a 4-core CPU
 * took longer than that to read a build's 6,000-token prompt (2026-10-01),
 * which "could not reach" described wrongly.
 */
function timedOut(error: unknown): boolean {
  const cause = (error as { cause?: { code?: unknown; name?: unknown } })
    ?.cause;
  return /timeout/i.test(
    `${String(cause?.code ?? '')} ${String(cause?.name ?? '')}`,
  );
}

/**
 * The prompt did not fit the local model's context window, so the server
 * read only part of it.
 */
export class LocalContextError extends ProviderError {
  override readonly stop = 'context-exceeded' as const;

  readonly read: number;
  readonly sent: number;

  constructor(read: number, sent: number) {
    super(
      `The local model read ${read} tokens of the roughly ${sent} it was ` +
        'sent, so its context window is too small for this request. Give ' +
        'it a larger one and try again: with Ollama, start it with ' +
        'OLLAMA_CONTEXT_LENGTH=32768 or more.',
    );
    this.name = 'LocalContextError';
    this.read = read;
    this.sent = sent;
  }
}

/**
 * A refusal from the owner's own server, said in words. Its body is
 * included because it is the owner's server talking about the owner's
 * setup, and it is usually the whole diagnosis ("model not found, try
 * pulling it first").
 */
function failedResponse(
  status: number,
  detail: string,
  model: string,
): ProviderError {
  const said = detail.trim().slice(0, 200);
  if (status === 404) {
    return new ProviderError(
      `The local model server has no model named "${model}" ` +
        '(VIBLD_LOCAL_MODEL). Download it on that server first, for ' +
        `example with \`ollama pull ${model}\`.${said ? ` It said: ${said}` : ''}`,
    );
  }
  if (status === 401 || status === 403) {
    return new ProviderError(
      `The local model server refused the request (${status}). If it was ` +
        'started with an API key, set the same key in VIBLD_LOCAL_API_KEY.',
    );
  }
  return new ProviderError(
    `The local model server answered ${status}.${said ? ` It said: ${said}` : ''}`,
  );
}
