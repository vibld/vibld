import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Transcript } from '../src/components/Transcript.tsx';
import type { TranscriptTurn } from '../src/generation/session.ts';

/**
 * How the conversation reads once the agent can answer as well as build
 * (docs/decisions.md, 2026-09-28).
 */

function turn(overrides: Partial<TranscriptTurn>): TranscriptTurn {
  return {
    id: 1,
    runId: 'run-1',
    prompt: 'a bakery site',
    at: 1,
    status: 'running',
    summary: null,
    fileCount: 0,
    revision: null,
    problem: null,
    providerId: null,
    agentMessage: null,
    ...overrides,
  };
}

async function render(turns: TranscriptTurn[]): Promise<string> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<Transcript turns={turns} />));
  const text = container.textContent ?? '';
  act(() => root.unmount());
  container.remove();
  return text;
}

describe('the conversation', () => {
  it('shows a reply as the agent saying it, and nothing about files', async () => {
    const text = await render([
      turn({ status: 'replied', agentMessage: 'Do you need a menu page?' }),
    ]);
    assert.match(text, /Do you need a menu page\?/);
    assert.doesNotMatch(text, /files?\b/);
  });

  it('says the agent is thinking before it has decided', async () => {
    assert.match(await render([turn({})]), /Thinking/);
  });

  it('puts the agent line above the build it started', async () => {
    const text = await render([
      turn({
        status: 'accepted',
        agentMessage: 'Adding a yearly toggle to Pricing.',
        summary: 'Pricing now has a Monthly / Yearly switch.',
        fileCount: 3,
      }),
    ]);
    assert.ok(
      text.indexOf('Adding a yearly toggle') < text.indexOf('Monthly / Yearly'),
    );
    assert.match(text, /3 files/);
  });
});
