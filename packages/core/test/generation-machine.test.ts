import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeModelProvider, GenerationMachine } from '../src/index.ts';
import type { Validator } from '../src/index.ts';

const acceptAll: Validator = async () => ({ ok: true, errors: [] });

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
});

test('reports scripted provider exhaustion as a failed run', async () => {
  const machine = new GenerationMachine();
  const provider = new FakeModelProvider([]);

  const result = await machine.run({ prompt: 'Build' }, provider, acceptAll);

  assert.equal(result.state, 'failed');
  assert.match(result.errors[0] ?? '', /no scripted plan/i);
});
