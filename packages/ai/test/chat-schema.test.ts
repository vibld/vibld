import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CHAT_SYSTEM_PROMPT,
  ChatDecisionSchema,
  chatUserPrompt,
  toChatTurn,
} from '../src/chat-schema.ts';
import type { ChatMessage } from '../src/chat-schema.ts';
import {
  CHAT_JSON_INSTRUCTION,
  CHAT_OUTPUT,
  jsonSchemaFor,
} from '../src/plan-output.ts';
import {
  MAX_CHAT_BRIEF_CHARS,
  MAX_CHAT_FIXED_PROMPT_CHARS,
  MAX_CHAT_MESSAGES,
  MAX_CHAT_PATH_CHARS,
  MAX_CHAT_PROJECT_FILES,
  MAX_CHAT_REPLY_CHARS,
  MAX_CHAT_SUMMARY_CHARS,
  MAX_CHAT_TOTAL_CHARS,
  MAX_CHAT_TOTAL_PATH_CHARS,
} from '../src/limits.ts';

/**
 * What one chat turn may answer with (docs/decisions.md, 2026-09-28).
 *
 * Strict, because a loose check here either starts a build nobody asked
 * for or tells somebody a change is being made while nothing is.
 */

const parse = (value: unknown) => ChatDecisionSchema.safeParse(value);

describe('the shape a chat turn replies in', () => {
  it('accepts a reply in words, with no brief', () => {
    const result = parse({
      action: 'reply',
      message: 'The hero uses Fraunces for headings.',
      brief: null,
    });
    assert.ok(result.success);
    assert.deepEqual(toChatTurn(result.data), {
      action: 'reply',
      message: 'The hero uses Fraunces for headings.',
    });
  });

  it('accepts a build with a brief, and returns the brief', () => {
    const result = parse({
      action: 'build',
      message: 'Adding a Monthly / Yearly toggle to Pricing.',
      brief:
        'Add a Monthly / Yearly toggle above the pricing cards. Yearly shows each price at ten times the monthly figure.',
    });
    assert.ok(result.success);
    const turn = toChatTurn(result.data);
    assert.equal(turn.action, 'build');
    assert.ok(turn.action === 'build' && turn.brief.startsWith('Add a'));
  });

  it('trims what it hands back', () => {
    const result = parse({
      action: 'build',
      message: '  Adding it.  ',
      brief: '\n Add it. \n',
    });
    assert.ok(result.success);
    assert.deepEqual(toChatTurn(result.data), {
      action: 'build',
      message: 'Adding it.',
      brief: 'Add it.',
    });
  });

  it('refuses a build with no brief, a null one or a blank one', () => {
    for (const brief of [null, '', '   \n']) {
      const result = parse({ action: 'build', message: 'Adding it.', brief });
      assert.equal(result.success, false, `accepted brief ${String(brief)}`);
      assert.ok(
        result.error!.issues.some((issue) => issue.path[0] === 'brief'),
        'the issue names the brief',
      );
    }
    assert.equal(
      parse({ action: 'build', message: 'Adding it.' }).success,
      false,
      'accepted a build with the key missing',
    );
  });

  it('refuses a reply that carries a brief', () => {
    // A model that could not decide. Guessing which half it meant is
    // either a build nobody asked for or a promise nothing keeps.
    const result = parse({
      action: 'reply',
      message: 'Sure.',
      brief: 'Add a toggle.',
    });
    assert.equal(result.success, false);
  });

  it('refuses extra keys', () => {
    const result = parse({
      action: 'reply',
      message: 'Hello.',
      brief: null,
      files: [{ path: 'index.html', content: '<p>hi</p>' }],
    });
    assert.equal(result.success, false);
  });

  it('refuses the wrong types and unknown actions', () => {
    for (const value of [
      null,
      'reply',
      [],
      { action: 'edit', message: 'Editing.', brief: 'Edit it.' },
      { action: 'reply', message: 42, brief: null },
      { action: 'build', message: 'Adding.', brief: 7 },
      { action: 'reply', message: '   ', brief: null },
      { action: ['reply'], message: 'Hi.', brief: null },
    ]) {
      assert.equal(
        parse(value).success,
        false,
        `accepted ${JSON.stringify(value)}`,
      );
    }
  });

  it('holds the message and the brief to their caps', () => {
    assert.equal(
      parse({
        action: 'reply',
        message: 'x'.repeat(MAX_CHAT_REPLY_CHARS + 1),
        brief: null,
      }).success,
      false,
    );
    assert.equal(
      parse({
        action: 'build',
        message: 'Adding it.',
        brief: 'x'.repeat(MAX_CHAT_BRIEF_CHARS + 1),
      }).success,
      false,
    );
    assert.ok(
      parse({
        action: 'build',
        message: 'Adding it.',
        brief: 'x'.repeat(MAX_CHAT_BRIEF_CHARS),
      }).success,
    );
  });
});

describe('what a chat turn asks the provider for', () => {
  it('constrains the reply to the schema it validates', () => {
    assert.equal(CHAT_OUTPUT.schema, ChatDecisionSchema);
    assert.equal(CHAT_OUTPUT.instruction, CHAT_JSON_INSTRUCTION);
  });

  it('is an object at the root with every key required, as strict modes want', () => {
    const schema = jsonSchemaFor(ChatDecisionSchema) as {
      type?: string;
      required?: string[];
      additionalProperties?: boolean;
    };
    assert.equal(schema.type, 'object');
    assert.deepEqual([...(schema.required ?? [])].sort(), [
      'action',
      'brief',
      'message',
    ]);
    assert.equal(schema.additionalProperties, false);
  });

  it('tells the model the rules the decision is made by', () => {
    for (const phrase of [
      "vibld's builder assistant",
      'CHOOSE "build"',
      'CHOOSE "reply"',
      'approve',
      'at most two',
      'stand on its own',
      'Never say or imply in a reply that you have changed',
    ]) {
      assert.ok(CHAT_SYSTEM_PROMPT.includes(phrase), `missing "${phrase}"`);
    }
  });

  it('frames the conversation and the project without escaping them', () => {
    const prompt = chatUserPrompt(
      [
        { role: 'assistant', text: 'Should Pricing get a "yearly" toggle?' },
        { role: 'user', text: 'Yes' },
      ],
      { summary: 'A bakery site.', files: ['src/App.tsx', 'index.html'] },
    );
    assert.ok(prompt.includes('Summary: A bakery site.'));
    assert.ok(prompt.includes('- src/App.tsx\n- index.html'));
    assert.ok(prompt.includes('[assistant]\nShould Pricing get a "yearly"'));
    assert.ok(prompt.endsWith('[user]\nYes'));
  });

  it('says when nothing has been built yet', () => {
    const prompt = chatUserPrompt([{ role: 'user', text: 'Hi' }], null);
    assert.ok(prompt.includes('Nothing has been built yet.'));
  });

  it('keeps everything it adds inside MAX_CHAT_FIXED_PROMPT_CHARS', () => {
    // The largest prompt a turn can send: every caller-supplied term at its
    // bound, spread across as many messages and paths as the guard allows,
    // so the framing round each one is counted as many times as it can be.
    const perMessage = Math.floor(MAX_CHAT_TOTAL_CHARS / MAX_CHAT_MESSAGES);
    const messages: ChatMessage[] = Array.from(
      { length: MAX_CHAT_MESSAGES },
      (_, index) => ({
        role: index % 2 === 0 ? 'assistant' : 'user',
        text: 'x'.repeat(perMessage),
      }),
    );
    const perPath = Math.min(
      MAX_CHAT_PATH_CHARS,
      Math.floor(MAX_CHAT_TOTAL_PATH_CHARS / MAX_CHAT_PROJECT_FILES),
    );
    const files = Array.from({ length: MAX_CHAT_PROJECT_FILES }, () =>
      'p'.repeat(perPath),
    );
    const prompt = chatUserPrompt(messages, {
      summary: 's'.repeat(MAX_CHAT_SUMMARY_CHARS),
      files,
    });

    const callerChars =
      messages.reduce((sum, message) => sum + message.text.length, 0) +
      MAX_CHAT_SUMMARY_CHARS +
      files.reduce((sum, path) => sum + path.length, 0);
    // The system prompt, plus the instruction a JSON-mode client appends to
    // it, plus the framing in the user prompt.
    const fixed =
      CHAT_SYSTEM_PROMPT.length +
      2 +
      CHAT_JSON_INSTRUCTION.length +
      (prompt.length - callerChars);
    assert.ok(
      fixed <= MAX_CHAT_FIXED_PROMPT_CHARS,
      `a turn adds ${fixed} characters of its own, over ${MAX_CHAT_FIXED_PROMPT_CHARS}`,
    );
  });
});
