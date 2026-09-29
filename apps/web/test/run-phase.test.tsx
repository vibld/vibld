import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { REQUIRED_PROJECT_FILES, createScriptedBuildClient } from '@vibld/ai';
import type { ScriptedBuild } from '@vibld/ai';

import { LifecycleBar } from '../src/components/LifecycleBar.tsx';
import { isRunPhase, lifecycleStatus } from '../src/generation/run-phase.ts';
import type { RunPhase } from '../src/generation/run-phase.ts';
import { fetchBuild } from '../src/generation/runs-client.ts';
import type { BuilderStatus } from '../src/generation/session.ts';
import { buildInSteps } from '../worker/generation-run.ts';
import type {
  ProgressReport,
  WorkflowParams,
} from '../worker/generation-run.ts';
import {
  BOUNDED_BUILD_INPUT_CHARS,
  runCeilingFor,
} from '../worker/run-ceiling.ts';
import { RunProgress } from '../worker/run-progress.ts';
import { phaseFor } from '../worker/run-stage.ts';
import { worstCaseMicroUsd } from '../worker/spend.ts';
import { fakeDurableObjectCtx } from './fakes/sqlite-do-storage.ts';

/**
 * Where a build on the Worker has got to, carried to the builder's
 * lifecycle bar.
 *
 * The bug: every server step falls inside the builder's own `planning`
 * status, because the page only learns the plan when the Workflow is done,
 * so the bar said "Plan" while files were being written. The Workflow now
 * says which part of its work it is doing (`run-phase.ts`), through the
 * progress channel, and both ways the builder hears about a build (the
 * stream's `progress` events and `GET /api/runs/:id`) carry it.
 */

async function bar(status: BuilderStatus, phase?: RunPhase) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(<LifecycleBar status={status} phase={phase} />),
  );
  const active = [
    ...container.querySelectorAll('.lifecycle__step--active'),
  ].map((step) => step.querySelector('.lifecycle__label')?.textContent);
  act(() => root.unmount());
  container.remove();
  return active;
}

describe('the lifecycle bar', () => {
  it('shows the build writing files as Write, not Plan', async () => {
    assert.deepEqual(await bar('planning'), ['Plan']);
    assert.deepEqual(await bar('planning', 'outline'), ['Plan']);
    assert.deepEqual(await bar('planning', 'writing'), ['Write']);
    for (const phase of ['assembling', 'validating', 'repairing'] as const) {
      assert.deepEqual(await bar('planning', phase), ['Check'], phase);
    }
  });

  it('never goes back, and shows a run that ended as it ended', () => {
    // The builder stages and checks its own copy once the result arrives;
    // the bar must not step back from Check to Write for that moment.
    assert.equal(lifecycleStatus('staging', 'repairing'), 'validating');
    assert.equal(lifecycleStatus('validating', 'writing'), 'validating');
    for (const status of ['accepted', 'failed', 'cancelled', 'idle'] as const) {
      assert.equal(lifecycleStatus(status, 'writing'), status);
    }
    assert.equal(lifecycleStatus('planning'), 'planning');
  });

  it('knows the phases the Worker names, and nothing else', () => {
    for (const phase of [
      'outline',
      'writing',
      'assembling',
      'validating',
      'repairing',
    ]) {
      assert.ok(isRunPhase(phase), phase);
    }
    for (const other of ['planning', '', 'Writing', 3, null, undefined]) {
      assert.equal(isRunPhase(other), false, String(other));
    }
  });
});

describe('the progress channel', () => {
  const report = (phase?: RunPhase): ProgressReport => ({
    characters: 10,
    reasoningCharacters: 0,
    ...(phase ? { phase } : {}),
  });

  it('keeps the phase the model steps said, through reports that do not say one', () => {
    const channel = new RunProgress(fakeDurableObjectCtx(), {});
    assert.equal(channel.read().phase, undefined);
    channel.report(report('outline'));
    assert.equal(channel.read().phase, 'outline');
    channel.report(report('writing'));
    channel.report(report());
    assert.equal(channel.read().phase, 'writing');
  });

  it('moves on when the Workflow does, and a late report does not take it back', () => {
    const channel = new RunProgress(fakeDurableObjectCtx(), {});
    channel.report(report('writing'));
    channel.finish();
    channel.enter('assembling');
    // A report sent before the finish and landing after it.
    channel.report(report('writing'));
    assert.equal(channel.read().phase, 'assembling');
    channel.enter('validating');
    channel.enter('repairing');
    assert.equal(channel.read().phase, 'repairing');
  });

  it('is said only for a running instance', () => {
    const state = { finished: true, phase: 'validating' as const };
    assert.equal(phaseFor('running', state), 'validating');
    assert.equal(phaseFor('queued', state), undefined);
    assert.equal(phaseFor('complete', state), undefined);
    assert.equal(phaseFor('running', undefined), undefined);
    assert.equal(
      phaseFor('running', { finished: false, phase: 'bogus' as never }),
      undefined,
    );
  });
});

describe('the model steps', () => {
  it('say outline for the outline and writing for every group', async () => {
    const ceiling = runCeilingFor(
      { VIBLD_PROVIDER: 'anthropic' },
      'claude-opus-5-5',
    );
    const params: WorkflowParams = {
      projectId: 'p',
      runId: 'r',
      prompt: 'A bakery.',
      model: 'claude-opus-5-5',
      userId: 'user_x',
      worstCaseMicroUsd: worstCaseMicroUsd(
        ceiling.prices,
        ceiling.maxTokens,
        BOUNDED_BUILD_INPUT_CHARS,
      ),
      prices: ceiling.prices,
      maxTokens: ceiling.maxTokens,
      maxInputChars: BOUNDED_BUILD_INPUT_CHARS,
    };
    const script: ScriptedBuild = {
      summary: 'A bakery.',
      files: REQUIRED_PROJECT_FILES.map((path) => ({
        path,
        content: `// ${path}\n${'x'.repeat(20_000)}`,
        size: 'large' as const,
      })),
    };
    const channel = new RunProgress(fakeDurableObjectCtx(), {});
    const seen: (RunPhase | undefined)[] = [];
    const built = await buildInSteps(
      {
        client: createScriptedBuildClient(script),
        store: () => ({ loadAccepted: async () => undefined }),
        report: (progress) => {
          channel.report(progress);
          if (progress.phase) seen.push(progress.phase);
        },
      },
      params,
      (_name, run) => run(),
    );
    assert.ok(built.ok);
    assert.equal(seen[0], 'outline');
    assert.ok(seen.length > 1);
    assert.ok(seen.slice(1).every((phase) => phase === 'writing'));
    assert.equal(channel.read().phase, 'writing');
  });
});

describe('asking after a build', () => {
  const answer = (run: Record<string, unknown>) =>
    (async () =>
      new Response(JSON.stringify({ run, snapshot: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
  const base = { id: 'run-1', state: 'running', startedAt: '2026-09-29' };

  it('reads the phase of a running build, and drops one it does not know', async () => {
    const known = await fetchBuild(
      'run-1',
      answer({ ...base, phase: 'writing' }),
      async () => null,
    );
    assert.ok(known.ok);
    assert.equal(known.run.phase, 'writing');

    const unknown = await fetchBuild(
      'run-1',
      answer({ ...base, phase: '<script>' }),
      async () => null,
    );
    assert.ok(unknown.ok);
    assert.equal('phase' in unknown.run, false);
  });
});
