import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeModelProvider, GenerationMachine } from '../src/index.ts';
import type { GenerationPlan, ModelProvider, Validator } from '../src/index.ts';

const acceptAll: Validator = async () => ({ ok: true, errors: [] });

function createDeferredProvider(): {
  provider: ModelProvider;
  release: (plan: GenerationPlan) => void;
} {
  let resolvePlan: ((plan: GenerationPlan) => void) | undefined;
  const provider: ModelProvider = {
    id: 'deferred',
    generate: () =>
      new Promise<GenerationPlan>((resolve) => {
        resolvePlan = resolve;
      }),
  };

  return {
    provider,
    release: (plan) => {
      assert.ok(resolvePlan);
      resolvePlan(plan);
    },
  };
}

test('accepts a validated generated snapshot', async () => {
  const provider = new FakeModelProvider([
    {
      summary: 'Create a landing page',
      files: [
        {
          path: 'src/App.tsx',
          content: 'export default function App() {}',
        },
      ],
    },
  ]);
  const machine = new GenerationMachine();

  const result = await machine.run(
    { prompt: 'Build a landing page' },
    provider,
    acceptAll,
  );

  assert.equal(result.state, 'accepted');
  assert.equal(result.errors.length, 0);
  assert.equal(result.accepted?.files[0]?.path, 'src/App.tsx');
  assert.match(result.accepted?.revision ?? '', /^r[a-f0-9]{8}$/);
  assert.equal(result.summary, 'Create a landing page');
});

test('preserves the last accepted checkpoint when a later run fails validation', async () => {
  const provider = new FakeModelProvider([
    {
      summary: 'Initial version',
      files: [{ path: 'index.html', content: 'good' }],
    },
    {
      summary: 'Broken version',
      files: [{ path: 'index.html', content: 'broken' }],
    },
  ]);
  const machine = new GenerationMachine();

  const first = await machine.run({ prompt: 'Create it' }, provider, acceptAll);
  const acceptedRevision = first.accepted?.revision;

  const rejectBroken: Validator = async (snapshot) => ({
    ok: snapshot.files.every((file) => !file.content.includes('broken')),
    errors: ['validation failed'],
  });

  const second = await machine.run(
    { prompt: 'Change it' },
    provider,
    rejectBroken,
  );

  assert.equal(second.state, 'failed');
  assert.equal(second.accepted?.revision, acceptedRevision);
  assert.equal(second.accepted?.files[0]?.content, 'good');
  assert.equal(second.staged?.files[0]?.content, 'broken');
  assert.deepEqual(second.errors, ['validation failed']);
  assert.equal(
    second.summary,
    'Broken version',
    'a validation failure must still report what the model said it built',
  );
});

test('reports scripted provider exhaustion as a failed run', async () => {
  const machine = new GenerationMachine();
  const provider = new FakeModelProvider([]);

  const result = await machine.run({ prompt: 'Build' }, provider, acceptAll);

  assert.equal(result.state, 'failed');
  assert.match(result.errors[0] ?? '', /no scripted plan/i);
});

test('cancels an active run without promoting staged work', async () => {
  const machine = new GenerationMachine();
  const { provider, release } = createDeferredProvider();

  const pending = machine.run({ prompt: 'Build' }, provider, acceptAll);
  assert.equal(machine.running, true);
  machine.cancel();
  release({
    summary: 'Late result',
    files: [{ path: 'index.html', content: 'late' }],
  });

  const result = await pending;

  assert.equal(result.state, 'cancelled');
  assert.equal(result.accepted, undefined);
  assert.equal(machine.running, false);
});

test('rejects a concurrent writer while another run is active', async () => {
  const machine = new GenerationMachine();
  const { provider, release } = createDeferredProvider();

  const firstPending = machine.run({ prompt: 'First' }, provider, acceptAll);
  const second = await machine.run({ prompt: 'Second' }, provider, acceptAll);

  assert.equal(second.state, 'failed');
  assert.deepEqual(second.errors, [
    'GenerationMachine already has an active run',
  ]);

  release({
    summary: 'First result',
    files: [{ path: 'index.html', content: 'first' }],
  });
  const first = await firstPending;

  assert.equal(first.state, 'accepted');
  assert.equal(first.accepted?.files[0]?.content, 'first');
});
