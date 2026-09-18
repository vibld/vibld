import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyDeploymentConfig } from '../src/useBuilderSession.ts';
import type { ConfigurableSession } from '../src/useBuilderSession.ts';
import type { DeploymentConfig } from '../src/generation/remote-provider.ts';

/**
 * What the shell does with an answer from `/api/config`, and with no answer.
 *
 * The second is the interesting one (#188 review). `isAdmin` reads `null`
 * for "nobody has answered yet", which the admin page renders as a wait.
 * A probe that rejects has answered nothing, but it has finished, and a
 * wait that never ends is worse than a refusal: the refusal at least
 * carries a way back to the builder.
 */

function recorder(): ConfigurableSession & { readonly seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    setModels: (models) => seen.push(`models:${models.length}`),
    setModel: (model) => seen.push(`model:${model ?? 'none'}`),
    setIsAdmin: (isAdmin) => seen.push(`isAdmin:${String(isAdmin)}`),
    setGeneration: (generation) =>
      seen.push(`generation:${String(generation)}`),
  };
}

const ANSWER: DeploymentConfig = {
  generation: 'model',
  models: [{ id: 'deepseek-flash', label: 'Flash', note: '', provider: 'd' }],
  defaultModel: 'deepseek-flash',
  isAdmin: true,
};

describe('applying the deployment probe', () => {
  it('passes on what the deployment answered', async () => {
    const session = recorder();
    await applyDeploymentConfig(session, async () => ANSWER);
    assert.deepEqual(session.seen, [
      'models:1',
      'model:deepseek-flash',
      'generation:model',
      'isAdmin:true',
    ]);
  });

  it('settles the admin question when the probe rejects', async () => {
    // The bug. Both call sites swallowed the rejection, so `null` became
    // permanent and the admin page checked access forever, offering
    // neither the refusal nor the link out of it.
    const session = recorder();
    await applyDeploymentConfig(session, async () => {
      throw new Error('401');
    });
    assert.ok(
      session.seen.includes('isAdmin:false'),
      'a rejected probe left the admin question unanswered forever',
    );
    assert.ok(
      !session.seen.includes('isAdmin:null'),
      'a rejected probe must settle the question, not restate the wait',
    );
  });

  it('does not reject when the probe does', async () => {
    // Called with `void` at both sites, so a rejection escaping here would
    // be an unhandled one.
    await assert.doesNotReject(
      applyDeploymentConfig(recorder(), async () => {
        throw new Error('401');
      }),
    );
  });

  it('leaves the model list alone when the probe rejects', async () => {
    // An empty picker is already what "no answer" looks like there, and
    // clearing a list this probe never replaced would take a choice away
    // over a question it was not asked.
    const session = recorder();
    await applyDeploymentConfig(session, async () => {
      throw new Error('401');
    });
    assert.ok(!session.seen.some((call) => call.startsWith('models:')));
  });
});

/**
 * What the deployment can generate with, which decides one thing (#189
 * review): whether the composer offers directions at all.
 *
 * `explore` always calls the real `/api/mockups`, while a build in `fake`
 * mode is served by `FakeModelProvider`. Offering the action there was
 * offering something that could only fail, in exactly the modes the fake
 * exists to keep usable.
 */
describe('what the deployment can generate with', () => {
  it('records the mode the probe reported', async () => {
    const session = recorder();
    await applyDeploymentConfig(session, async () => ANSWER);
    assert.ok(session.seen.includes('generation:model'));
  });

  it('records a fake deployment as fake', async () => {
    const session = recorder();
    await applyDeploymentConfig(session, async () => ({
      ...ANSWER,
      generation: 'fake',
    }));
    assert.ok(session.seen.includes('generation:fake'));
  });

  it('says nothing about the mode when the probe rejects', async () => {
    // Null stays null. An unanswered probe is not evidence of a fake
    // deployment, and the one thing this decides is whether to offer a
    // paid action -- so "do not know" must not read as "yes".
    const session = recorder();
    await applyDeploymentConfig(session, async () => {
      throw new Error('probe failed');
    });
    assert.ok(!session.seen.some((line) => line.startsWith('generation:')));
  });
});
