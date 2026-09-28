import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MAX_CHAT_MESSAGES, MAX_CHAT_TOTAL_CHARS } from '@vibld/ai/limits';

import {
  fitConversation,
  readChatTurn,
  requestChatTurn,
} from '../src/generation/chat-client.ts';
import type { ChatMessage } from '../src/generation/chat-client.ts';

/**
 * Asking `/api/chat` for one turn, from the browser (docs/decisions.md,
 * "Resolved 2026-09-28"). Every outcome comes back as a value, so these
 * check the value for each thing the Worker can answer.
 */

const MESSAGES: ChatMessage[] = [{ role: 'user', text: 'What font is this?' }];

interface Sent {
  url: string;
  init: RequestInit;
}

function answering(
  body: unknown,
  status = 200,
): { fetchImpl: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return new Response(
      typeof body === 'string' ? body : JSON.stringify(body),
      { status, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, sent };
}

const token = async () => 'session-token';

describe('asking for a chat turn', () => {
  it('returns a reply', async () => {
    const { fetchImpl, sent } = answering({
      turn: { action: 'reply', message: 'Fraunces, for headings.' },
      model: 'deepseek-flash',
    });
    const result = await requestChatTurn({
      messages: MESSAGES,
      project: { summary: 'A bakery.', files: ['index.html'] },
      model: 'deepseek-flash',
      fetchImpl,
      getToken: token,
    });
    assert.deepEqual(result, {
      ok: true,
      turn: { action: 'reply', message: 'Fraunces, for headings.' },
      model: 'deepseek-flash',
    });

    const request = sent[0]!;
    assert.equal(request.url, '/api/chat');
    assert.equal(request.init.method, 'POST');
    const headers = request.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer session-token');
    assert.equal(headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(String(request.init.body)), {
      messages: MESSAGES,
      project: { summary: 'A bakery.', files: ['index.html'] },
      model: 'deepseek-flash',
    });
  });

  it('returns a build with its brief', async () => {
    const { fetchImpl } = answering({
      turn: {
        action: 'build',
        message: 'Adding a toggle to Pricing.',
        brief: 'Add a Monthly / Yearly toggle to Pricing.',
      },
      model: 'deepseek-flash',
    });
    const result = await requestChatTurn({
      messages: MESSAGES,
      fetchImpl,
      getToken: token,
    });
    assert.ok(result.ok);
    assert.deepEqual(result.turn, {
      action: 'build',
      message: 'Adding a toggle to Pricing.',
      brief: 'Add a Monthly / Yearly toggle to Pricing.',
    });
  });

  it('sends no Authorization header without a token', async () => {
    const { fetchImpl, sent } = answering({
      turn: { action: 'reply', message: 'Hi.' },
      model: 'm',
    });
    await requestChatTurn({
      messages: MESSAGES,
      fetchImpl,
      getToken: async () => null,
    });
    const headers = sent[0]!.init.headers as Record<string, string>;
    assert.equal('Authorization' in headers, false);
  });

  it('reports a missing sign-in', async () => {
    const { fetchImpl } = answering(
      { error: 'Sign in required.', reason: 'not-signed-in' },
      401,
    );
    const result = await requestChatTurn({
      messages: MESSAGES,
      fetchImpl,
      getToken: token,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.kind, 'sign-in-required');
    assert.equal(result.error.reason, 'not-signed-in');
  });

  it('reports a refusal with its reason', async () => {
    const { fetchImpl } = answering(
      {
        error: "This month's generation budget is used up.",
        reason: 'account-ceiling',
      },
      429,
    );
    const result = await requestChatTurn({
      messages: MESSAGES,
      fetchImpl,
      getToken: token,
    });
    assert.deepEqual(result, {
      ok: false,
      error: {
        kind: 'refused',
        status: 429,
        message: "This month's generation budget is used up.",
        reason: 'account-ceiling',
      },
    });
  });

  it('reports the invite gate as a refusal it can recognise', async () => {
    const { fetchImpl } = answering(
      { error: 'Not yet.', accessRefused: true, reason: 'access-refused' },
      403,
    );
    const result = await requestChatTurn({
      messages: MESSAGES,
      fetchImpl,
      getToken: token,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.kind, 'refused');
    assert.equal(result.error.reason, 'access-refused');
    assert.equal(result.error.accessRefused, true);
  });

  it('reports a failed turn, and how it stopped', async () => {
    const { fetchImpl } = answering(
      { error: 'The model returned a chat reply that...', stop: 'model-shape' },
      502,
    );
    const result = await requestChatTurn({
      messages: MESSAGES,
      fetchImpl,
      getToken: token,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.kind, 'failed');
    assert.equal(result.error.status, 502);
    assert.equal(result.error.stop, 'model-shape');
    assert.equal(result.error.reason, undefined);
  });

  it('names a failure whose body is not JSON by its status', async () => {
    const { fetchImpl } = answering('<html>Bad gateway</html>', 502);
    const result = await requestChatTurn({
      messages: MESSAGES,
      fetchImpl,
      getToken: token,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.kind, 'failed');
    assert.equal(result.error.message, 'Could not answer that (502).');
  });

  it('refuses a success that is not a turn', async () => {
    for (const body of [
      { turn: { action: 'build', message: 'Adding it.' }, model: 'm' },
      { turn: { action: 'edit', message: 'Hi.' }, model: 'm' },
      { turn: { action: 'reply', message: 'Hi.' } },
      'not json',
    ]) {
      const { fetchImpl } = answering(body);
      const result = await requestChatTurn({
        messages: MESSAGES,
        fetchImpl,
        getToken: token,
      });
      assert.ok(!result.ok, JSON.stringify(body));
      assert.equal(result.error.kind, 'invalid-response');
    }
  });

  it('reports a request that never got an answer', async () => {
    const result = await requestChatTurn({
      messages: MESSAGES,
      fetchImpl: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
      getToken: token,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.kind, 'network');
  });

  it('passes the signal on, and reports an abort as one', async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const result = await requestChatTurn({
      messages: MESSAGES,
      signal: controller.signal,
      fetchImpl: (async (_url: string, init: RequestInit) => {
        seen = init.signal ?? undefined;
        controller.abort();
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }) as unknown as typeof fetch,
      getToken: token,
    });
    assert.equal(seen, controller.signal);
    assert.deepEqual(result, {
      ok: false,
      error: { kind: 'aborted', message: 'Cancelled.' },
    });
  });

  it('does not send at all when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetchImpl, sent } = answering({});
    const result = await requestChatTurn({
      messages: MESSAGES,
      signal: controller.signal,
      fetchImpl,
      getToken: token,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.kind, 'aborted');
    assert.equal(sent.length, 0);
  });
});

describe('fitting a conversation to the bounds', () => {
  it('keeps the most recent messages up to the count', () => {
    const messages: ChatMessage[] = Array.from(
      { length: MAX_CHAT_MESSAGES + 5 },
      (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant',
        text: `m${index}`,
      }),
    );
    const kept = fitConversation(messages);
    assert.equal(kept.length, MAX_CHAT_MESSAGES);
    assert.deepEqual(kept.at(-1), messages.at(-1));
    assert.deepEqual(kept[0], messages[5]);
  });

  it('drops the oldest to fit the total, and always keeps the last', () => {
    const half = Math.floor(MAX_CHAT_TOTAL_CHARS / 2);
    const messages: ChatMessage[] = [
      { role: 'user', text: 'a'.repeat(half) },
      { role: 'assistant', text: 'b'.repeat(half) },
      { role: 'user', text: 'c'.repeat(half) },
    ];
    const kept = fitConversation(messages);
    assert.deepEqual(
      kept.map((message) => message.text[0]),
      ['b', 'c'],
    );

    const alone = fitConversation([
      { role: 'user', text: 'x'.repeat(MAX_CHAT_TOTAL_CHARS + 1) },
    ]);
    assert.equal(alone.length, 1);
  });
});

describe('reading a turn', () => {
  it('accepts the two shapes and nothing else', () => {
    assert.deepEqual(readChatTurn({ action: 'reply', message: 'Hi.' }), {
      action: 'reply',
      message: 'Hi.',
    });
    assert.deepEqual(
      readChatTurn({ action: 'build', message: 'Adding.', brief: 'Add it.' }),
      { action: 'build', message: 'Adding.', brief: 'Add it.' },
    );
    for (const value of [
      null,
      { action: 'reply', message: '' },
      { action: 'build', message: 'Adding.', brief: ' ' },
      { action: 'reply', message: 3 },
    ]) {
      assert.equal(readChatTurn(value), null, JSON.stringify(value));
    }
  });
});
