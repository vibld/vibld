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
 */
export class RemoteModelProvider implements ModelProvider {
  readonly id: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;

  constructor(
    options: { id?: string; endpoint?: string; fetchImpl?: typeof fetch } = {},
  ) {
    this.id = options.id ?? 'remote';
    this.#endpoint = options.endpoint ?? '/api/plan';
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async generate(request: GenerationRequest): Promise<GenerationPlan> {
    const response = await this.#fetch(this.#endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: request.prompt, base: request.base }),
      // Access sets a cookie; without this the browser omits it and every
      // request looks unauthenticated.
      credentials: 'same-origin',
    });

    const body = (await response.json().catch(() => null)) as {
      plan?: GenerationPlan;
      error?: string;
    } | null;

    if (!response.ok) {
      throw new Error(body?.error ?? `Generation failed (${response.status})`);
    }
    if (!body?.plan || !Array.isArray(body.plan.files)) {
      throw new Error(
        'The generation service returned an unexpected response.',
      );
    }
    return body.plan;
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
