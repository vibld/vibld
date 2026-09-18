import type { ParsedMockup } from '@vibld/ai/mockup-schema';
import type { StylePresetId } from '@vibld/ai/style-presets';
import { getClerkToken } from '../auth/clerk-token.ts';
import { SignInRequiredError, readPlanEvents } from './remote-provider.ts';
import type { GenerationProgress } from './session.ts';

/**
 * Ask for three directions to choose between (#185).
 *
 * Deliberately a plain function rather than a `ModelProvider`. What comes
 * back is not a project: it is three things to look at, two of which are
 * about to be thrown away. Bending it into the provider interface would
 * have meant a plan whose "files" were not files, and every consumer of a
 * plan learning the difference.
 *
 * The same stream contract `/api/plan` uses, read with the same reader, so
 * the keepalives, the progress events and the malformed-frame handling are
 * one implementation rather than two. The difference is the terminal event:
 * `mockups` rather than `plan`.
 */
export interface MockupRunOptions {
  prompt: string;
  style?: StylePresetId | null;
  model?: string | null;
  signal?: AbortSignal;
  onProgress?: (progress: GenerationProgress) => void;
  fetchImpl?: typeof fetch;
  getToken?: () => Promise<string | null>;
  endpoint?: string;
}

export async function requestMockups(
  options: MockupRunOptions,
): Promise<ParsedMockup[]> {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const getToken = options.getToken ?? getClerkToken;
  const token = await getToken();

  const response = await doFetch(options.endpoint ?? '/api/mockups', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      prompt: options.prompt,
      ...(options.style ? { style: options.style } : {}),
      ...(options.model ? { model: options.model } : {}),
    }),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (response.status === 401) throw new SignInRequiredError();

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      body?.error ?? `Could not produce mockups (${response.status})`,
    );
  }
  if (!response.body) {
    throw new Error('The generation service returned an empty response.');
  }

  for await (const { event, data } of readPlanEvents(response.body)) {
    if (event === 'progress') {
      const { characters, elapsedMs, stage } = data as {
        characters?: number;
        elapsedMs?: number;
        stage?: unknown;
      };
      if (typeof elapsedMs === 'number') {
        options.onProgress?.({
          elapsedMs,
          ...(typeof characters === 'number' ? { characters } : {}),
          ...(stage === 'queued' || stage === 'running' ? { stage } : {}),
        });
      }
      continue;
    }
    if (event === 'error') {
      throw new Error(
        (data as { error?: string }).error ?? 'Could not produce mockups.',
      );
    }
    if (event === 'mockups') {
      const mockups = (data as { mockups?: unknown }).mockups;
      if (!Array.isArray(mockups) || mockups.length === 0) {
        throw new Error('The generation service returned no mockups.');
      }
      // Checked here rather than trusted, for the same reason the plan's
      // files are: this is a network boundary, and a shape that drifted
      // would otherwise reach a component that renders it.
      return mockups.filter(
        (each): each is ParsedMockup =>
          typeof each === 'object' &&
          each !== null &&
          typeof (each as ParsedMockup).label === 'string' &&
          typeof (each as ParsedMockup).rationale === 'string' &&
          typeof (each as ParsedMockup).html === 'string' &&
          (each as ParsedMockup).html.length > 0,
      );
    }
  }

  throw new Error('The connection closed before the mockups arrived.');
}
