import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Autosaver, mergePatches } from '../src/projects/autosave.ts';
import type { SaveOutcome } from '../src/projects/autosave.ts';
import type { ProjectPatch } from '../src/projects/projects-client.ts';

/**
 * Saving a project without anybody pressing Save. The promises are the
 * ones a person would notice broken: a burst of changes is one request, a
 * change is never lost to a failure, a later change is never undone by an
 * earlier one, and leaving a project sends what was waiting.
 */

/** A clock the test moves by hand. */
function timers() {
  let next = 1;
  const pending = new Map<number, { run: () => void; at: number }>();
  let now = 0;
  return {
    setTimer: (run: () => void, ms: number) => {
      const id = next++;
      pending.set(id, { run, at: now + ms });
      return id;
    },
    clearTimer: (id: unknown) => {
      pending.delete(id as number);
    },
    async advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...pending]) {
        if (timer.at <= now) {
          pending.delete(id);
          timer.run();
        }
      }
      // Let the save the timer started run to completion.
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    },
    get armed() {
      return pending.size;
    },
  };
}

function saver(outcomes: SaveOutcome[] = []) {
  const clock = timers();
  const sent: ProjectPatch[] = [];
  const autosaver = new Autosaver(
    async (patch) => {
      sent.push(patch);
      return outcomes.shift() ?? 'saved';
    },
    {
      delayMs: 1_000,
      retryMs: 10_000,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    },
  );
  return { autosaver, sent, clock };
}

describe('the autosave', () => {
  it('sends a burst of changes as one request, once things are quiet', async () => {
    const { autosaver, sent, clock } = saver();
    autosaver.schedule({ settings: { model: 'a' } });
    await clock.advance(500);
    autosaver.schedule({ settings: { style: 'brutalism' } });
    await clock.advance(500);
    assert.deepEqual(sent, [], 'sent before the burst was over');
    await clock.advance(600);
    assert.deepEqual(sent, [{ settings: { model: 'a', style: 'brutalism' } }]);
    assert.equal(autosaver.status, 'saved');
  });

  it('keeps a failed change and sends it again, under anything newer', async () => {
    const { autosaver, sent, clock } = saver(['retry']);
    autosaver.schedule({ name: 'First', settings: { model: 'a' } });
    await clock.advance(1_000);
    assert.equal(autosaver.status, 'error');

    autosaver.schedule({ name: 'Second' });
    await clock.advance(1_000);
    assert.deepEqual(sent.at(-1), { name: 'Second', settings: { model: 'a' } });
    assert.equal(autosaver.status, 'saved');
  });

  it('tries a failed save again on its own, after a pause', async () => {
    const { autosaver, sent, clock } = saver(['retry']);
    autosaver.schedule({ name: 'Bakery' });
    await clock.advance(1_000);
    assert.equal(sent.length, 1);
    await clock.advance(10_000);
    assert.equal(sent.length, 2);
    assert.equal(autosaver.status, 'saved');
  });

  it('stops trying for a project that is gone', async () => {
    const { autosaver, sent, clock } = saver(['gone']);
    autosaver.schedule({ name: 'Bakery' });
    await clock.advance(1_000);
    await clock.advance(60_000);
    assert.equal(sent.length, 1);
    assert.equal(autosaver.status, 'error');
    assert.equal(clock.armed, 0);
  });

  it('sends what is waiting at once when the project is left', async () => {
    const { autosaver, sent } = saver();
    autosaver.schedule({ name: 'Bakery' });
    await autosaver.flush();
    assert.deepEqual(sent, [{ name: 'Bakery' }]);
  });

  it('never has two saves of one project in the air', async () => {
    let release!: () => void;
    let inFlight = 0;
    let most = 0;
    const sent: ProjectPatch[] = [];
    const autosaver = new Autosaver(
      async (patch) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        sent.push(patch);
        if (sent.length === 1) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        inFlight -= 1;
        return 'saved';
      },
      { setTimer: () => 0, clearTimer: () => undefined },
    );
    autosaver.schedule({ name: 'One' });
    const first = autosaver.flush();
    // Until the first save is really in the air.
    while (sent.length === 0) await Promise.resolve();
    autosaver.schedule({ name: 'Two' });
    const second = autosaver.flush();
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    assert.equal(sent.length, 1, 'the second save did not wait');
    release();
    await Promise.all([first, second]);
    assert.equal(most, 1);
    assert.deepEqual(sent, [{ name: 'One' }, { name: 'Two' }]);
  });

  it('reports what it is doing, for the one word the header shows', async () => {
    const { autosaver, clock } = saver();
    const seen: string[] = [];
    autosaver.subscribe(() => seen.push(autosaver.status));
    autosaver.schedule({ name: 'Bakery' });
    await clock.advance(1_000);
    assert.deepEqual(seen, ['saving', 'saved']);
  });
});

describe('merging two changes', () => {
  it('lets the later win, field by field, settings included', () => {
    assert.deepEqual(
      mergePatches(
        { name: 'A', settings: { model: 'm', style: null } },
        { settings: { style: 'brutalism' }, transcript: [] },
      ),
      {
        name: 'A',
        settings: { model: 'm', style: 'brutalism' },
        transcript: [],
      },
    );
    assert.deepEqual(mergePatches(null, { name: 'B' }), { name: 'B' });
  });
});
