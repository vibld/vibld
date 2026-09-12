import type {
  GenerationPlan,
  GenerationRequest,
  ModelProvider,
} from '@vibld/core';
import type { StylePresetId } from '@vibld/ai/style-presets';
import { getClerkToken } from '../auth/clerk-token.ts';

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
 * The endpoint is gated by Clerk now (docs/decisions.md L5): a request with
 * no valid `Authorization: Bearer` token gets a plain 401, not a redirect --
 * there is no login host to bounce to, and no cross-origin hop to be caught
 * by `redirect: 'manual'` the way Access's did.
 */
export class SignInRequiredError extends Error {
  constructor() {
    super(
      'Sign in to generate -- use the "Sign in" button above, then try again.',
    );
    this.name = 'SignInRequiredError';
  }
}

async function authHeaders(
  getToken: () => Promise<string | null>,
): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
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
  /**
   * A page to fetch and use as inspiration for this one request. The Worker
   * does the actual fetching and text extraction (`reference-fetch.ts`) --
   * the browser only ever sends the URL, never fetches third-party content
   * itself.
   */
  referenceUrl?: string | null;
  /**
   * The chosen model, by id. The Worker checks it against the catalogue and
   * against its own credentials -- the browser is not trusted to have picked
   * one this deployment can serve.
   */
  model?: string | null;
  /**
   * Returns the caller's current Clerk session token, or `null` when signed
   * out. Injectable so tests do not need a real Clerk instance; defaults to
   * reading the live one via `window.Clerk`.
   */
  getToken?: () => Promise<string | null>;
}

export class RemoteModelProvider implements ModelProvider {
  readonly id: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;
  readonly #signal?: AbortSignal;
  readonly #onProgress?: RemoteModelProviderOptions['onProgress'];
  readonly #style: StylePresetId | null;
  readonly #knowledge: string | null;
  readonly #referenceUrl: string | null;
  readonly #model: string | null;
  readonly #getToken: () => Promise<string | null>;

  constructor(options: RemoteModelProviderOptions = {}) {
    this.id = options.id ?? 'remote';
    this.#endpoint = options.endpoint ?? '/api/plan';
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#signal = options.signal;
    this.#onProgress = options.onProgress;
    this.#style = options.style ?? null;
    this.#knowledge = options.knowledge ?? null;
    this.#referenceUrl = options.referenceUrl ?? null;
    this.#model = options.model ?? null;
    this.#getToken = options.getToken ?? getClerkToken;
  }

  async generate(request: GenerationRequest): Promise<GenerationPlan> {
    const response = await this.#fetch(this.#endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        ...(await authHeaders(this.#getToken)),
      },
      body: JSON.stringify({
        prompt: request.prompt,
        base: request.base,
        ...(this.#style ? { style: this.#style } : {}),
        ...(this.#knowledge ? { knowledge: this.#knowledge } : {}),
        ...(this.#referenceUrl ? { referenceUrl: this.#referenceUrl } : {}),
        ...(this.#model ? { model: this.#model } : {}),
      }),
      signal: this.#signal,
    });

    if (response.status === 401) {
      throw new SignInRequiredError();
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

/** One entry of the deployment's model picker. */
export interface ModelOption {
  id: string;
  label: string;
  note: string;
  provider: string;
}

export interface DeploymentConfig {
  generation: GenerationMode;
  models: ModelOption[];
  defaultModel: string | null;
  /**
   * Whether the signed-in caller is a platform admin (docs/decisions.md
   * L4). Only decides whether the shell *offers* the admin credit tool --
   * `/api/admin/*` re-checks this itself at the trusted boundary either
   * way (ADR-0006), same as the model grants this same response reports.
   */
  isAdmin: boolean;
}

/**
 * Ask the deployment what it can serve. Cached, because the answer cannot
 * change within a page load and every run would otherwise pay for it.
 *
 * The empty model list is the honest answer for a deployment that has no
 * credentials, and for `pnpm dev` where there is no endpoint at all. The
 * picker renders nothing rather than offering a choice that cannot be
 * fulfilled.
 */
const UNCONFIGURED: DeploymentConfig = {
  generation: 'fake',
  models: [],
  defaultModel: null,
  isAdmin: false,
};

let probe: Promise<DeploymentConfig> | undefined;

export function detectDeploymentConfig(
  fetchImpl?: typeof fetch,
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<DeploymentConfig> {
  probe ??= (async () => {
    const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
    let response: Response;
    try {
      response = await doFetch('/api/config', {
        headers: await authHeaders(getToken),
      });
    } catch {
      // No endpoint at all (pnpm dev, or the static-only deploy): the fake is
      // the correct answer, not an error.
      return UNCONFIGURED;
    }

    // A signed-in-but-rejected probe must not quietly answer "fake". That
    // would run the deterministic provider and present its output as a
    // finished result, which is the one thing the shell must never do -- the
    // user asked a model for a project and would be shown a mock of one
    // instead. A simply signed-out probe also lands here (no token to send),
    // and every caller of this function already treats that rejection as
    // "nothing to show yet" rather than an error worth surfacing.
    if (response.status === 401) {
      throw new SignInRequiredError();
    }

    if (!response.ok) return UNCONFIGURED;
    try {
      const body = (await response.json()) as {
        generation?: unknown;
        models?: unknown;
        defaultModel?: unknown;
        isAdmin?: unknown;
      };
      // Every field is checked. This is the deployment's own endpoint, but a
      // shape that drifted would otherwise put `undefined` in a <select> and
      // send it as the model id.
      const models = Array.isArray(body.models)
        ? body.models.filter(
            (model): model is ModelOption =>
              typeof model === 'object' &&
              model !== null &&
              typeof (model as ModelOption).id === 'string' &&
              typeof (model as ModelOption).label === 'string',
          )
        : [];
      return {
        generation: body.generation === 'model' ? 'model' : 'fake',
        models,
        defaultModel:
          typeof body.defaultModel === 'string' ? body.defaultModel : null,
        isAdmin: body.isAdmin === true,
      };
    } catch {
      return UNCONFIGURED;
    }
  })();

  // A rejected probe must not be cached: the session can be renewed by
  // reloading, and a cached rejection would outlive the problem it describes.
  return probe.catch((error: unknown) => {
    probe = undefined;
    throw error;
  });
}

/** The mode alone, for callers that only need to know which provider runs. */
export function detectGenerationMode(
  fetchImpl?: typeof fetch,
): Promise<GenerationMode> {
  return detectDeploymentConfig(fetchImpl).then((config) => config.generation);
}

export function resetGenerationModeProbe(): void {
  probe = undefined;
}
