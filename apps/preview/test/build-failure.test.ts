import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  NETWORK_FAILURE_CODES,
  networkFailure,
} from '../worker/build-failure.ts';

/**
 * That a registry outage does not get charged to the project (#196 review).
 *
 * A failed `npm install` bought a repair turn: a second paid model call,
 * asked to fix a project that compiles perfectly well, on a day when npm is
 * unreachable and every caller hits it at once. The timeout could not tell
 * them apart, because a network failure exits fast rather than hanging.
 *
 * Called rather than read, which is the point of the module existing: this
 * decides whether somebody is billed for a second generation, and a regex
 * over source is not an instrument for that.
 */
describe('whether a failed install was the project or the registry', () => {
  it("reads npm's own codes as the registry", () => {
    for (const code of NETWORK_FAILURE_CODES) {
      assert.equal(
        networkFailure(`npm error code ${code}\nnpm error network ...`),
        true,
        code,
      );
    }
  });

  it('still blames the project for a package that does not exist', () => {
    // The case this must not swallow: a dependency the model invented is
    // the project's mistake, and it is exactly what a repair turn fixes.
    assert.equal(
      networkFailure(
        'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/react-fancy-thing',
      ),
      false,
    );
  });

  it('still blames the project for a peer or version conflict', () => {
    assert.equal(
      networkFailure(
        'npm error code ERESOLVE\nnpm error ERESOLVE unable to resolve dependency tree',
      ),
      false,
    );
  });

  it('says nothing about an empty or unhelpful message', () => {
    // Absent evidence is not evidence of a network failure. Reading it as
    // one would quietly stop repairing anything whose npm output was
    // truncated away.
    assert.equal(networkFailure(''), false);
    assert.equal(networkFailure('npm error exit 1'), false);
  });

  it('does not match a code that merely appears inside a project path', () => {
    // A guard against the lazy version of this check. `E404` is not in the
    // list, so the risk is a real code appearing in prose rather than as a
    // code -- worth knowing which way that falls.
    assert.equal(
      networkFailure('npm error path /workspace/src/ETIMEDOUT-demo/index.ts'),
      true,
      'a substring match is what this is, and the test says so rather than pretending otherwise',
    );
  });
});
