import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FakeModelProvider } from '@vibld/core';
import { MAX_CHAT_BRIEF_CHARS } from '@vibld/ai/limits';
import type { StylePresetId } from '@vibld/ai/style-presets';
import { BuilderSession } from '../src/generation/session.ts';
import type {
  ChatResult,
  ChatRunOptions,
} from '../src/generation/chat-client.ts';

/**
 * The session's end of the conversation (docs/decisions.md, 2026-09-28:
 * the agent decides whether to answer or build). `/api/chat` is faked; what
 * is asserted is what the session does with each kind of answer, and what
 * it tells the agent about the conversation so far.
 */

interface Built {
  style: StylePresetId | null | undefined;
  referenceUrl: string | null | undefined;
}

function createSession(answers: ChatResult[]) {
  let tick = 0;
  const asked: ChatRunOptions[] = [];
  const built: Built[] = [];
  const session = new BuilderSession({
    delay: async () => {},
    now: () => (tick += 1),
    stageDelayMs: 0,
    resolveProvider: async (plan, _signal, _progress, style, _k, _m, ref) => {
      built.push({ style, referenceUrl: ref });
      return new FakeModelProvider([plan]);
    },
    requestChatTurnImpl: async (options) => {
      asked.push(options);
      const answer = answers.shift();
      assert.ok(answer, 'the agent was asked more often than expected');
      return answer;
    },
  });
  session.setGeneration('model');
  return { session, asked, built };
}

const reply = (message: string): ChatResult => ({
  ok: true,
  turn: { action: 'reply', message },
  model: 'gpt-6-sol',
});

const build = (message: string, brief: string): ChatResult => ({
  ok: true,
  turn: { action: 'build', message, brief },
  model: 'gpt-6-sol',
});

describe('talking to the agent', () => {
  it('shows a reply, and changes nothing', async () => {
    const { session, built } = createSession([
      reply('Which pages do you need: just a landing page, or a blog too?'),
    ]);
    await session.send('a site for my bakery');

    const state = session.getState();
    assert.equal(state.transcript.length, 1);
    assert.equal(state.transcript[0]?.status, 'replied');
    assert.match(state.transcript[0]?.agentMessage ?? '', /Which pages/);
    assert.equal(state.chatting, false);
    assert.equal(state.running, false);
    assert.equal(state.acceptedSnapshot, null);
    assert.deepEqual(built, [], 'a reply built something');
  });

  it('builds from the brief, under the words that were typed', async () => {
    const { session } = createSession([
      build(
        'Building a landing page for your bakery.',
        'A landing page for a small sourdough bakery with opening hours and a map.',
      ),
    ]);
    await session.send('yes, do it');

    const state = session.getState();
    assert.equal(state.transcript.length, 1, 'the exchange appears twice');
    const turn = state.transcript[0]!;
    assert.equal(turn.prompt, 'yes, do it');
    assert.equal(turn.agentMessage, 'Building a landing page for your bakery.');
    assert.equal(turn.status, 'accepted');
    assert.match(state.prompt ?? '', /sourdough bakery/, 'built the word yes');
  });

  it('keeps the style and reference of a message it answered for the build that follows', async () => {
    const { session, built } = createSession([
      reply('Should the menu be a page of its own?'),
      build('Adding it.', 'A bakery site with a separate menu page.'),
    ]);
    await session.send(
      'a bakery site',
      'succeed',
      'editorial' as StylePresetId,
      'https://example.com',
    );
    await session.send('yes');

    assert.deepEqual(built, [
      { style: 'editorial', referenceUrl: 'https://example.com' },
    ]);
  });

  it('drops a held preset when a gallery style is chosen (D146)', async () => {
    const { session, built } = createSession([
      reply('Should the menu be a page of its own?'),
      build('Adding it.', 'A bakery site with a separate menu page.'),
    ]);
    await session.send(
      'a bakery site',
      'succeed',
      'editorial' as StylePresetId,
      'https://example.com',
    );
    session.setGalleryStyle('amberbrae');
    await session.send('yes');

    assert.deepEqual(built, [
      { style: null, referenceUrl: 'https://example.com' },
    ]);
  });

  it('tells the agent what happened so far, in words', async () => {
    const { session, asked } = createSession([
      build('Building it.', 'A bakery landing page.'),
      reply('Sure, navy works well with the cream you have.'),
    ]);
    await session.send('a bakery site');
    await session.send('can the hero be navy?');

    const second = asked[1]!;
    assert.deepEqual(
      second.messages.map((message) => message.role),
      ['user', 'assistant', 'user'],
    );
    assert.match(second.messages[1]!.text, /Building it\..*Built it/);
    assert.equal(second.messages[2]!.text, 'can the hero be navy?');
    assert.ok(second.project, 'no project sent once one exists');
    assert.ok(second.project.files.length > 0);
  });

  it('sends no project before there is one', async () => {
    const { session, asked } = createSession([reply('What is it for?')]);
    await session.send('a website');
    assert.equal(asked[0]!.project, null);
  });

  it('says so when the agent could not answer', async () => {
    const { session } = createSession([
      {
        ok: false,
        error: { kind: 'failed', message: 'Could not answer that (502).' },
      },
    ]);
    await session.send('hello');
    const turn = session.getState().transcript[0]!;
    assert.equal(turn.status, 'failed');
    assert.equal(turn.problem, 'Could not answer that (502).');
    assert.equal(session.getState().chatting, false);
  });

  it('can be cancelled while the agent is deciding', async () => {
    let seen: AbortSignal | undefined;
    let tick = 0;
    const session = new BuilderSession({
      delay: async () => {},
      now: () => (tick += 1),
      stageDelayMs: 0,
      resolveProvider: async (plan) => new FakeModelProvider([plan]),
      requestChatTurnImpl: (options) =>
        new Promise<ChatResult>((resolve) => {
          seen = options.signal;
          options.signal?.addEventListener('abort', () =>
            resolve({
              ok: false,
              error: { kind: 'aborted', message: 'Canceled.' },
            }),
          );
        }),
    });
    session.setGeneration('model');
    const sent = session.send('hello');
    assert.equal(session.getState().chatting, true);
    session.cancel();
    await sent;

    assert.equal(seen?.aborted, true, 'the request was left running');
    assert.equal(session.getState().chatting, false);
    assert.equal(session.getState().transcript[0]?.status, 'cancelled');
  });

  it('goes straight to a build where there is no model to talk to', async () => {
    const { session, asked } = createSession([]);
    session.setGeneration('fake');
    await session.send('a bakery site');
    assert.deepEqual(asked, []);
    assert.equal(session.getState().transcript[0]?.status, 'accepted');
  });

  it('builds a message longer than its own brief could be, as written', async () => {
    // A template's brief from vibld.com is twice what the agent may write
    // back (D111); asking it would have built a summary of the template.
    const { session, asked } = createSession([]);
    const brief = `A bakery site. ${'Every section as specified. '.repeat(200)}`;
    assert.ok(brief.length > MAX_CHAT_BRIEF_CHARS);
    await session.send(brief);
    assert.deepEqual(asked, []);
    const turn = session.getState().transcript[0];
    assert.equal(turn?.status, 'accepted');
    assert.equal(turn?.prompt, brief.trim());
  });

  it('keeps a forced failure a test of the build path', async () => {
    const { session, asked } = createSession([]);
    await session.send('a bakery site', 'fail-validation');
    assert.deepEqual(asked, []);
    assert.equal(session.getState().transcript[0]?.status, 'failed');
  });

  it('describes a large project within the bounds the Worker refuses past', async () => {
    const { session, asked } = createSession([
      build('Building it.', 'A bakery landing page.'),
      reply('Noted.'),
    ]);
    await session.send('a bakery site');
    const snapshot = session.getState().acceptedSnapshot!;
    // More files than the Worker accepts, one with a path it would refuse.
    const many = Array.from({ length: 150 }, (_, index) => ({
      path: `src/components/Generated${index}.tsx`,
      content: '',
    }));
    (snapshot as { files: typeof many }).files = [
      { path: `src/${'x'.repeat(300)}.tsx`, content: '' },
      ...many,
    ];
    await session.send('thanks');

    const files = asked[1]!.project!.files;
    assert.ok(files.length <= 100);
    assert.ok(files.every((path) => path.length <= 256));
  });
});
