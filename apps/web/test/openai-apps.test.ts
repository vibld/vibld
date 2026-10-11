import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  OPENAI_APPS_CHALLENGE_PATH,
  handleOpenAiAppsChallenge,
} from '../worker/openai-apps.ts';

/** The ChatGPT directory's domain check (D220). */

const at = (method = 'GET') =>
  new Request(`https://app.vibld.com${OPENAI_APPS_CHALLENGE_PATH}`, { method });

describe('the OpenAI apps challenge', () => {
  it('serves the token alone, as plain text', async () => {
    const response = handleOpenAiAppsChallenge(at(), {
      OPENAI_APPS_CHALLENGE: ' tok_123 \n',
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/plain/);
    assert.equal(await response.text(), 'tok_123');
  });

  it('is not there on a deployment with no token', () => {
    assert.equal(handleOpenAiAppsChallenge(at(), {}).status, 404);
    assert.equal(
      handleOpenAiAppsChallenge(at(), { OPENAI_APPS_CHALLENGE: '' }).status,
      404,
    );
  });

  it('answers only reads', () => {
    const env = { OPENAI_APPS_CHALLENGE: 'tok_123' };
    assert.equal(handleOpenAiAppsChallenge(at('POST'), env).status, 405);
    assert.equal(handleOpenAiAppsChallenge(at('HEAD'), env).status, 200);
  });

  it('reaches the Worker before the single-page app does', () => {
    const config = readFileSync(
      new URL('../wrangler.jsonc', import.meta.url),
      'utf8',
    );
    assert.ok(config.includes(`"${OPENAI_APPS_CHALLENGE_PATH}"`));
  });
});
