import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { requestMockups } from '../src/generation/mockups-client.ts';
import { SignInRequiredError } from '../src/generation/remote-provider.ts';
import type { GenerationProgress } from '../src/generation/session.ts';

/**
 * Asking for three directions over the wire (#185).
 *
 * The same stream contract `/api/plan` uses, read with the same reader, so
 * what is tested here is the part that differs: the terminal `mockups`
 * event, and what happens when what arrives is not what was promised.
 */

function streamOf(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
}

function event(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function mockup(label: string) {
  return {
    label,
    rationale: 'Who this suits.',
    html: `<!doctype html><body>${label}</body>`,
  };
}

function serving(
  frames: string[],
  init: ResponseInit = { status: 200 },
): { fetchImpl: typeof fetch; readonly sent: RequestInit[] } {
  const sent: RequestInit[] = [];
  return {
    sent,
    fetchImpl: (async (_url: RequestInfo | URL, options?: RequestInit) => {
      sent.push(options ?? {});
      return new Response(streamOf(frames), init);
    }) as typeof fetch,
  };
}

const token = async () => 'token';

describe('requesting mockups', () => {
  it('returns the set the service sent', async () => {
    const { fetchImpl } = serving([
      event('mockups', {
        mockups: [mockup('Quiet'), mockup('Loud'), mockup('Dense')],
      }),
    ]);
    const mockups = await requestMockups({
      prompt: 'a bakery',
      fetchImpl,
      getToken: token,
    });
    assert.deepEqual(
      mockups.map((each) => each.label),
      ['Quiet', 'Loud', 'Dense'],
    );
  });

  it('sends the chosen style and model, and nothing it was not given', async () => {
    const { fetchImpl, sent } = serving([
      event('mockups', { mockups: [mockup('A'), mockup('B')] }),
    ]);
    await requestMockups({
      prompt: 'a bakery',
      style: 'brutalism',
      fetchImpl,
      getToken: token,
    });
    const body = JSON.parse(String(sent[0]?.body)) as Record<string, unknown>;
    assert.deepEqual(body, { prompt: 'a bakery', style: 'brutalism' });
  });

  it('reports progress as it arrives', async () => {
    // The payoff of running in the request: the model client streams, so
    // the character count has a producer again on this route (#183).
    const seen: GenerationProgress[] = [];
    const { fetchImpl } = serving([
      event('progress', {
        elapsedMs: 1_000,
        characters: 400,
        stage: 'running',
      }),
      event('mockups', { mockups: [mockup('A'), mockup('B')] }),
    ]);
    await requestMockups({
      prompt: 'a bakery',
      fetchImpl,
      getToken: token,
      onProgress: (progress) => seen.push(progress),
    });
    assert.deepEqual(seen, [
      { elapsedMs: 1_000, characters: 400, stage: 'running' },
    ]);
  });

  it('drops a mockup with nothing to render rather than passing it on', async () => {
    // This is a network boundary. A shape that drifted would otherwise
    // reach a component whose whole job is to render it.
    const { fetchImpl } = serving([
      event('mockups', {
        mockups: [
          mockup('Good'),
          // No document at all.
          { label: 'Missing', rationale: 'x' },
          // A document that is present and empty, which is the case a
          // shape check alone lets through: an iframe with nothing in it
          // reads as a direction that rendered to a blank page.
          { label: 'Empty', rationale: 'x', html: '' },
        ],
      }),
    ]);
    const mockups = await requestMockups({
      prompt: 'a bakery',
      fetchImpl,
      getToken: token,
    });
    assert.deepEqual(
      mockups.map((each) => each.label),
      ['Good'],
    );
  });

  it('names an error the service reported', async () => {
    const { fetchImpl } = serving([event('error', { error: 'Refused.' })]);
    await assert.rejects(
      requestMockups({ prompt: 'a bakery', fetchImpl, getToken: token }),
      /Refused\./,
    );
  });

  it('names a connection that closed before the mockups arrived', async () => {
    const { fetchImpl } = serving([]);
    await assert.rejects(
      requestMockups({ prompt: 'a bakery', fetchImpl, getToken: token }),
      /closed before/,
    );
  });

  it('asks the caller to sign in on a 401', async () => {
    const { fetchImpl } = serving([], { status: 401 });
    await assert.rejects(
      requestMockups({ prompt: 'a bakery', fetchImpl, getToken: token }),
      SignInRequiredError,
    );
  });
});
