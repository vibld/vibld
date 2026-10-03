import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { ProjectSnapshot, TranscriptTurn } from '@vibld/core';

import { CheckpointHistory } from '../src/components/CheckpointHistory.tsx';

/**
 * The History pane (D152), as it is actually wired: the list comes from the
 * route, each row is named from the conversation, and a restore asks first,
 * sends the revision it was chosen from, and hands the restored code on.
 */

const HISTORY = {
  current: 'r2',
  checkpoints: [
    {
      revision: 'r2',
      runId: 'wf-2',
      kind: 'build',
      acceptedAt: '2026-10-03T10:00:00.000Z',
    },
    {
      revision: 'r1',
      runId: 'wf-1:repair',
      kind: 'repair',
      acceptedAt: '2026-10-03T09:00:00.000Z',
    },
  ],
};

const turn = (over: Partial<TranscriptTurn>): TranscriptTurn => ({
  id: 1,
  runId: 'run-1',
  prompt: 'A landing page for a bakery',
  at: 1_790_000_000_000,
  status: 'accepted',
  summary: null,
  fileCount: 1,
  revision: 'r1',
  problem: null,
  providerId: 'remote',
  ...over,
});

const TRANSCRIPT = [
  turn({ id: 1, prompt: 'A landing page for a bakery', serverRunId: 'wf-1' }),
  turn({
    id: 2,
    prompt: 'Add an opening hours section',
    revision: 'r2',
    serverRunId: 'wf-2',
  }),
];

function reply(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

function serving(answer: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: String(input),
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  return calls;
}

async function mount(
  props: {
    building?: boolean;
    onRestored?: (projectId: string, snapshot: ProjectSnapshot) => boolean;
    onRestoring?: () => () => void;
  } = {},
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(
      <CheckpointHistory
        runCount={0}
        projectId="p1"
        transcript={TRANSCRIPT}
        {...props}
      />,
    );
  });
  const button = (label: RegExp) =>
    [...container.querySelectorAll('button')].find((element) =>
      label.test(element.textContent ?? ''),
    ) as HTMLButtonElement | undefined;
  return {
    text: () => container.textContent ?? '',
    button,
    async open(projectId: string) {
      await act(async () => {
        root.render(
          <CheckpointHistory
            runCount={0}
            projectId={projectId}
            transcript={TRANSCRIPT}
            {...props}
          />,
        );
      });
    },
    async click(label: RegExp) {
      const found = button(label);
      assert.ok(found, `no ${String(label)} button`);
      await act(async () => {
        found.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    status: () => container.querySelector('[role="status"]')?.textContent ?? '',
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('the checkpoint history pane', () => {
  it('names each checkpoint by what was asked for, and marks the current one', async () => {
    serving(() => reply(HISTORY));
    const view = await mount();

    assert.match(view.text(), /Add an opening hours section/);
    // Matched through its repair's run id, not only by revision.
    assert.match(view.text(), /A landing page for a bakery/);
    assert.match(view.text(), /Current/);
    // Only the one that is not current can be restored.
    const restores = [...document.querySelectorAll('button')].filter(
      (element) => element.textContent === 'Restore',
    );
    assert.equal(restores.length, 1);
    view.unmount();
  });

  it('asks before restoring, then restores from the revision it was looking at', async () => {
    let restored = false;
    const calls = serving((call) => {
      if (call.method === 'POST') {
        restored = true;
        return reply({
          snapshot: {
            revision: 'r1',
            files: [{ path: 'index.html', content: '<h1>r1</h1>' }],
          },
        });
      }
      return reply(
        restored
          ? {
              current: 'r1',
              checkpoints: [
                {
                  revision: 'r1',
                  runId: 'rollback-x',
                  kind: 'rollback',
                  acceptedAt: '2026-10-03T11:00:00.000Z',
                },
                ...HISTORY.checkpoints,
              ],
            }
          : HISTORY,
      );
    });
    const handed: Array<[string, string]> = [];
    const view = await mount({
      onRestored: (projectId, snapshot) =>
        handed.push([projectId, snapshot.revision]) > 0,
    });

    await view.click(/^Restore$/);
    // Nothing sent yet: the first press only asks.
    assert.equal(calls.filter((call) => call.method === 'POST').length, 0);
    assert.match(view.text(), /Restore this checkpoint\?/);

    await view.click(/Yes, restore/);
    const post = calls.find((call) => call.method === 'POST');
    assert.equal(post?.url, '/api/projects/p1/checkpoints/restore');
    assert.deepEqual(post?.body, { revision: 'r1', base: 'r2' });
    assert.deepEqual(handed, [['p1', 'r1']]);
    assert.match(view.status(), /Restored the checkpoint at revision r1/);
    // Read again, so the restore shows as the newest acceptance.
    assert.match(view.text(), /Restored an earlier checkpoint/);
    view.unmount();
  });

  it('holds the composer while a restore is on its way, and says so when the builder could not take the code', async () => {
    let answer: (response: Response) => void = () => undefined;
    serving((call) =>
      call.method === 'POST'
        ? (new Promise<Response>((resolve) => {
            answer = resolve;
          }) as unknown as Response)
        : reply(HISTORY),
    );
    const holds: boolean[] = [];
    const view = await mount({
      // A build was sent before the restore landed, so the session refuses
      // to take the restored code.
      onRestored: () => false,
      onRestoring: () => {
        holds.push(true);
        return () => holds.push(false);
      },
    });
    await view.click(/^Restore$/);
    await view.click(/Yes, restore/);
    assert.deepEqual(holds, [true]);
    await act(async () => {
      answer(
        reply({
          snapshot: {
            revision: 'r1',
            files: [{ path: 'index.html', content: '<h1>r1</h1>' }],
          },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.deepEqual(holds, [true, false]);
    assert.match(view.status(), /still showing the code from before/);
    view.unmount();
  });

  it('can be talked out of a restore', async () => {
    const calls = serving(() => reply(HISTORY));
    const view = await mount();
    await view.click(/^Restore$/);
    await view.click(/Cancel/);
    assert.doesNotMatch(view.text(), /Restore this checkpoint\?/);
    assert.equal(calls.filter((call) => call.method === 'POST').length, 0);
    view.unmount();
  });

  it('offers no restore while a build runs', async () => {
    serving(() => reply(HISTORY));
    const view = await mount({ building: true });
    assert.equal(view.button(/^Restore$/)?.disabled, true);
    view.unmount();
  });

  it("says why a restore was refused, in the Worker's words", async () => {
    serving((call) =>
      call.method === 'POST'
        ? reply(
            {
              error:
                'This project has changed since its history was loaded. Look again, then restore.',
              code: 'checkpoint-moved',
              current: 'r3',
            },
            409,
          )
        : reply(HISTORY),
    );
    const handed: string[] = [];
    const view = await mount({
      onRestored: (_, snapshot) => handed.push(snapshot.revision) > 0,
    });
    await view.click(/^Restore$/);
    await view.click(/Yes, restore/);
    assert.match(view.status(), /changed since its history was loaded/);
    assert.deepEqual(handed, []);
    view.unmount();
  });

  it('keeps quiet about a restore that lands after another project is opened', async () => {
    let answer: (response: Response) => void = () => undefined;
    serving((call) =>
      call.method === 'POST'
        ? (new Promise<Response>((resolve) => {
            answer = resolve;
          }) as unknown as Response)
        : reply(HISTORY),
    );
    const handed: string[] = [];
    const view = await mount({
      onRestored: (projectId) => handed.push(projectId) > 0,
    });
    await view.click(/^Restore$/);
    await view.click(/Yes, restore/);
    await view.open('p2');
    await act(async () => {
      answer(
        reply({
          snapshot: {
            revision: 'r1',
            files: [{ path: 'index.html', content: '<h1>r1</h1>' }],
          },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.deepEqual(handed, []);
    assert.doesNotMatch(view.status(), /Restored/);
    view.unmount();
  });

  it("never offers one project's checkpoints while another's are loading", async () => {
    serving((call) =>
      call.url.includes('/p2/')
        ? (new Promise<Response>(() => undefined) as unknown as Response)
        : reply(HISTORY),
    );
    const view = await mount();
    assert.ok(view.button(/^Restore$/));
    await view.open('p2');
    assert.equal(view.button(/^Restore$/), undefined);
    assert.doesNotMatch(view.text(), /Add an opening hours section/);
    view.unmount();
  });

  it('says the history is unavailable rather than claiming there is none', async () => {
    serving(() => reply({ error: 'no' }, 503));
    const view = await mount();
    assert.match(view.text(), /unavailable/);
    assert.doesNotMatch(view.text(), /No checkpoints yet/);
    view.unmount();
  });
});
