import type {
  GenerationPlan,
  GenerationRequest,
  ModelProvider,
} from '@vibld/core';

/**
 * Calls the Worker's /api/plan endpoint.
 *
 * Deliberately plain `fetch` and no model SDK: this module ships in the
 * browser bundle, where a provider credential would be readable by anyone who
 * opens the page (ADR-0006). The key lives only in the Worker.
 *
 * The response is a server-sent event stream. A generation can run for a
 * minute or more, and a buffered response sends no bytes until it finishes --
 * long enough that the browser abandons the request and reports an opaque
 * network error. The stream's keepalives prevent that.
 */

interface PlanEvent {
  event: string;
  data: unknown;
}

/**
 * Read SSE frames from a response body.
 *
 * Comment lines (`:` prefixed, which is what a keepalive is) carry no data and
 * are skipped -- they exist purely to keep bytes flowing.
 */
export async function* readPlanEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<PlanEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');

        let event = 'message';
        const dataLines: string[] = [];
        for (const line of frame.split('\n')) {
          if (line.startsWith(':')) continue;
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:'))
            dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) continue;

        try {
          yield { event, data: JSON.parse(dataLines.join('\n')) };
        } catch {
          throw new Error('The generation service sent a malformed event.');
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export interface RemoteModelProviderOptions {
  id?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  /**
   * Aborts the request when the user cancels. Aborting the fetch also drops
   * the connection, which is the signal the Worker uses to stop its own model
   * call -- so cancelling here really does stop the spending, rather than
   * merely stopping the waiting.
   */
  signal?: AbortSignal;
}

export class RemoteModelProvider implements ModelProvider {
  readonly id: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;
  readonly #signal?: AbortSignal;

  constructor(options: RemoteModelProviderOptions = {}) {
    this.id = options.id ?? 'remote';
    this.#endpoint = options.endpoint ?? '/api/plan';
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#signal = options.signal;
  }

  async generate(request: GenerationRequest): Promise<GenerationPlan> {
    const response = await this.#fetch(this.#endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify({ prompt: request.prompt, base: request.base }),
      // Access uses a cookie; without this the browser omits it and every
      // request looks unauthenticated.
      credentials: 'same-origin',
      signal: this.#signal,
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(body?.error ?? `Generation failed (${response.status})`);
    }
    if (!response.body) {
      throw new Error('The generation service returned an empty response.');
    }

    for await (const { event, data } of readPlanEvents(response.body)) {
      if (event === 'error') {
        throw new Error(
          (data as { error?: string }).error ?? 'Generation failed.',
        );
      }
      if (event === 'plan') {
        const plan = (data as { plan?: GenerationPlan }).plan;
        if (!plan || !Array.isArray(plan.files)) {
          throw new Error(
            'The generation service returned an unexpected response.',
          );
        }
        return plan;
      }
    }

    // The connection closed without a result. Naming it beats the browser's
    // bare "Load failed".
    throw new Error('The connection closed before generation finished.');
  }
}

export type GenerationMode = 'model' | 'fake';

/**
 * Ask the deployment which provider is available. Cached, because the answer
 * cannot change within a page load and every run would otherwise pay for it.
 */
let probe: Promise<GenerationMode> | undefined;

export function detectGenerationMode(
  fetchImpl?: typeof fetch,
): Promise<GenerationMode> {
  probe ??= (async () => {
    try {
      const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
      const response = await doFetch('/api/config', {
        credentials: 'same-origin',
      });
      if (!response.ok) return 'fake';
      const body = (await response.json()) as { generation?: unknown };
      return body.generation === 'model' ? 'model' : 'fake';
    } catch {
      // No endpoint at all (pnpm dev, or the static-only deploy): the fake is
      // the correct answer, not an error.
      return 'fake';
    }
  })();
  return probe;
}

export function resetGenerationModeProbe(): void {
  probe = undefined;
}
