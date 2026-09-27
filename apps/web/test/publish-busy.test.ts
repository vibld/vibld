import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * That publishing is not refused by a build that has already finished
 * (#196 review).
 *
 * A verification build answers as soon as it has an answer and destroys
 * its container afterwards, on `ctx.waitUntil`, holding that user's build
 * lock for as long as the destroy takes. That relocation was my own fix
 * for a different finding, and it made an ordinary sequence fail: generate,
 * then press publish, and the publish route met a `busy` refusal from a
 * build nobody was running and turned it into a 422, which reads to the
 * person pressing the button as "your project does not build".
 *
 * The repair's rebuild already waits that out. This is the other caller,
 * and it had been left behind, which is the fix-the-instance-not-the-class
 * shape this pull request keeps finding.
 *
 * The waiting itself is `rebuild-budget.test.ts`, which calls
 * `askWhileBusy` and `buildWithin`. What is here is the wiring: `index.ts`
 * imports `cloudflare:workers` and cannot be loaded under `node --test`, so
 * the route can be perfectly wrong while every other test passes.
 */

const INDEX = readFileSync(
  join(import.meta.dirname, '..', 'worker', 'index.ts'),
  'utf8',
);

/** `handlePublish`, from its declaration to the brace that closes it. */
function handlePublish(): string {
  const from = INDEX.indexOf('async function handlePublish(');
  assert.notEqual(from, -1, 'handlePublish is gone; this test is stale');
  const end = INDEX.indexOf('\n}\n', from);
  assert.notEqual(end, -1, 'handlePublish never closes');
  return INDEX.slice(from, end);
}

/**
 * The same route with its prose taken out.
 *
 * Because a position compared inside the whole text is comparing against
 * the comments too: the assertion below looked for `422` and found the one
 * in the comment explaining why a 503 comes first, so a correct route
 * failed its own test. That is the same defect as measuring the text
 * around a property, arriving from the other side.
 */
function code(): string {
  return handlePublish()
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe('publishing against a workspace that is still being torn down', () => {
  it('waits a busy workspace out rather than refusing', () => {
    assert.match(
      handlePublish(),
      /askWhileBusy\(/,
      'a teardown from the last build refuses this publish outright',
    );
  });

  it('asks again only for a refusal about somebody else', () => {
    // `busy` is another build holding the lock, which says nothing about
    // this project. Every other reason is about this build, and asking
    // again would spend the caller's wait on an answer that will not
    // change.
    assert.match(
      handlePublish(),
      /reason === 'busy'/,
      'the publish retries refusals that will answer the same way',
    );
  });

  it('gives each attempt what is left rather than its own full cap', () => {
    // The finding one round earlier, which this route would otherwise
    // reintroduce: seven attempts at thirteen minutes each is not a bound
    // on anything, and the person is holding a request open through it.
    assert.match(
      handlePublish(),
      /buildWithin\([\s\S]{0,400}?\n\s+within,/,
      'the publish can spend seven build timeouts before answering',
    );
  });

  it('does not report an unreachable build service as a broken project', () => {
    // 422 is "your files do not build". A build service that never
    // answered has not said that, and the repair step already reads the
    // same fact the same way.
    const route = code();
    const unavailable = route.indexOf('if (!built)');
    assert.ok(unavailable > 0, 'an unanswered build is read as an answer');
    assert.match(
      route.slice(unavailable, unavailable + 200),
      /503/,
      'an unreachable build service is reported as a failed build',
    );
    assert.ok(
      unavailable < route.indexOf('422'),
      'the 422 is reached before anything checks there was an answer',
    );
  });
});
