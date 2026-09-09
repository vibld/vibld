import type {
  GenerationPlan,
  GenerationRequest,
  ModelProvider,
} from '@vibld/core';
import type { StylePresetId } from '@vibld/ai/style-presets';

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
 * The endpoint sits behind Cloudflare Access, which answers a request with no
 * live session with a 302 to its own login host. `fetch` follows redirects by
 * default, lands cross-origin, and is refused by CORS -- surfacing as a bare
 * `TypeError: Load failed` that says nothing about the actual cause.
 *
 * So every call here uses `redirect: 'manual'`, which turns that bounce into
 * an opaque-redirect response we can recognise and name.
 */
export class AccessSessionError extends Error {
  constructor() {
    super(
      'Your sign-in session has expired. Reload the page to sign in again, then try once more.',
    );
    this.name = 'AccessSessionError';
  }
}

/** An opaque redirect is the only shape a blocked cross-origin bounce takes. */
function isAccessRedirect(response: Response): boolean {
  return response.type === 'opaqueredirect' || response.status === 0;
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
   * Called as the endpoint reports progress, so the shell can show that a
   * long generation is moving rather than stuck.
   */
  onProgress?: (progress: { characters: number; elapsedMs: number }) => void;
  /**
   * Aborts the request when the user cancels. Aborting the fetch also drops
   * the connection, which is the signal the Worker uses to stop its own model
   * call -- so cancelling here really does stop the spending, rather than
   * merely stopping the waiting.
   */
  signal?: AbortSignal;
  /**
   * The chosen visual direction, by id. The Worker validates it against the
   * closed set -- the browser is not trusted to have sent a real one.
   */
  style?: StylePresetId | null;
  /** Standing instructions for the project, sent with every turn. */
  knowledge?: string | null;
}

export class RemoteModelProvider implements ModelProvider {
  readonly id: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;
  readonly #signal?: AbortSignal;
  readonly #onProgress?: RemoteModelProviderOptions['onProgress'];
  readonly #style: StylePresetId | null;
  readonly #knowledge: string | null;

  constructor(options: RemoteModelProviderOptions = {}) {
    this.id = options.id ?? 'remote';
    this.#endpoint = options.endpoint ?? '/api/plan';
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#signal = options.signal;
    this.#onProgress = options.onProgress;
    this.#style = options.style ?? null;
    this.#knowledge = options.knowledge ?? null;
  }

  async generate(request: GenerationRequest): Promise<GenerationPlan> {
    const response = await this.#fetch(this.#endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify({
        prompt: request.prompt,
        base: request.base,
        ...(this.#style ? { style: this.#style } : {}),
        ...(this.#knowledge ? { knowledge: this.#knowledge } : {}),
      }),
      // Access uses a cookie; without this the browser omits it and every
      // request looks unauthenticated.
      credentials: 'same-origin',
      // Never follow Access's login redirect: it is cross-origin, so following
      // it produces an unreadable failure instead of a diagnosable one.
      redirect: 'manual',
      signal: this.#signal,
    });

    if (isAccessRedirect(response)) {
      throw new AccessSessionError();
    }

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
      if (event === 'progress') {
        const { characters, elapsedMs } = data as {
          characters?: number;
          elapsedMs?: number;
        };
        if (typeof characters === 'number' && typeof elapsedMs === 'number') {
          this.#onProgress?.({ characters, elapsedMs });
        }
        continue;
      }
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
    const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
    let response: Response;
    try {
      response = await doFetch('/api/config', {
        credentials: 'same-origin',
        redirect: 'manual',
      });
    } catch {
      // No endpoint at all (pnpm dev, or the static-only deploy): the fake is
      // the correct answer, not an error.
      return 'fake';
    }

    // A signed-out probe must not quietly answer "fake". That would run the
    // deterministic provider and present its output as a finished result,
    // which is the one thing the shell must never do -- the user asked a
    // model for a project and would be shown a mock of one instead.
    if (isAccessRedirect(response)) {
      throw new AccessSessionError();
    }

    if (!response.ok) return 'fake';
    try {
      const body = (await response.json()) as { generation?: unknown };
      return body.generation === 'model' ? 'model' : 'fake';
    } catch {
      return 'fake';
    }
  })();

  // A rejected probe must not be cached: the session can be renewed by
  // reloading, and a cached rejection would outlive the problem it describes.
  return probe.catch((error: unknown) => {
    probe = undefined;
    throw error;
  });
}

export function resetGenerationModeProbe(): void {
  probe = undefined;
}
