import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AnthropicModelProvider,
  buildUserPrompt,
} from '../src/anthropic-provider.ts';
import {
  ProviderRefusalError,
  ProviderShapeError,
  ProviderTruncationError,
} from '../src/errors.ts';
import { PLAN_SYSTEM_PROMPT } from '../src/plan-schema.ts';
import type {
  PlanClient,
  PlanCompletion,
  PlanRequest,
  PlanUsage,
} from '../src/client.ts';

const USAGE: PlanUsage = {
  inputTokens: 120,
  outputTokens: 3400,
  cacheReadInputTokens: 0,
};

const VALID_PLAN = {
  summary: 'A navy and neon-yellow landing page for a security product.',
  files: [
    { path: 'package.json', content: '{ "name": "demo" }' },
    { path: 'index.html', content: '<!doctype html>' },
    { path: 'src/main.tsx', content: 'export {};' },
    { path: 'src/App.tsx', content: 'export function App() { return null; }' },
    { path: 'src/styles.css', content: ':root { --navy: #0b1b3a; }' },
  ],
};

/** Records what the provider asked for and replays a scripted completion. */
function stubClient(completion: Partial<PlanCompletion>): PlanClient & {
  requests: PlanRequest[];
} {
  const requests: PlanRequest[] = [];
  return {
    id: 'stub',
    requests,
    async createPlan(request) {
      requests.push(request);
      return {
        plan: VALID_PLAN,
        stopReason: 'end_turn',
        usage: USAGE,
        ...completion,
      };
    },
  };
}

describe('AnthropicModelProvider', () => {
  it('returns a GenerationPlan for a well-formed response', async () => {
    const client = stubClient({});
    const provider = new AnthropicModelProvider(client);

    const plan = await provider.generate({ prompt: 'a security landing page' });

    assert.equal(plan.summary, VALID_PLAN.summary);
    assert.equal(plan.files.length, 5);
    assert.ok(plan.files.some((file) => file.path === 'src/App.tsx'));
  });

  it('identifies itself by client and model so runs are attributable', () => {
    const provider = new AnthropicModelProvider(stubClient({}), {
      model: 'claude-sonnet-5',
    });
    assert.equal(provider.id, 'stub:claude-sonnet-5');
  });

  it('sends the portability system prompt and the caller options', async () => {
    const client = stubClient({});
    const provider = new AnthropicModelProvider(client, {
      model: 'claude-opus-5',
      maxTokens: 4242,
      effort: 'max',
    });

    await provider.generate({ prompt: 'a coffee roaster site' });

    const [request] = client.requests;
    assert.equal(request?.system, PLAN_SYSTEM_PROMPT);
    assert.equal(request?.prompt, 'a coffee roaster site');
    assert.equal(request?.model, 'claude-opus-5');
    assert.equal(request?.maxTokens, 4242);
    assert.equal(request?.effort, 'max');
  });

  it('reports usage even when the run fails, so budgets stay honest', async () => {
    const seen: PlanUsage[] = [];
    const provider = new AnthropicModelProvider(
      stubClient({
        stopReason: 'refusal',
        refusal: { category: 'cyber', explanation: 'no' },
      }),
      { onUsage: (usage) => seen.push(usage) },
    );

    await assert.rejects(
      () => provider.generate({ prompt: 'something' }),
      ProviderRefusalError,
    );
    assert.deepEqual(seen, [USAGE]);
  });

  it('surfaces a refusal with its category rather than an empty plan', async () => {
    const provider = new AnthropicModelProvider(
      stubClient({
        plan: null,
        stopReason: 'refusal',
        refusal: { category: 'cyber', explanation: 'Declined.' },
      }),
    );

    await assert.rejects(
      () => provider.generate({ prompt: 'something' }),
      (error: unknown) => {
        assert.ok(error instanceof ProviderRefusalError);
        assert.equal(error.category, 'cyber');
        assert.match(error.message, /Declined\./);
        return true;
      },
    );
  });

  it('rejects a truncated project instead of accepting half a file', async () => {
    const provider = new AnthropicModelProvider(
      stubClient({ stopReason: 'max_tokens' }),
      {
        maxTokens: 900,
      },
    );

    await assert.rejects(
      () => provider.generate({ prompt: 'a large app' }),
      (error: unknown) => {
        assert.ok(error instanceof ProviderTruncationError);
        assert.match(error.message, /900-token output limit/);
        return true;
      },
    );
  });

  it('rejects a response that does not match the plan schema', async () => {
    const provider = new AnthropicModelProvider(
      stubClient({ plan: { summary: 'no files key' } }),
    );

    await assert.rejects(
      () => provider.generate({ prompt: 'anything' }),
      (error: unknown) => {
        assert.ok(error instanceof ProviderShapeError);
        assert.match(error.message, /files/);
        return true;
      },
    );
  });

  it('rejects a null parsed output', async () => {
    const provider = new AnthropicModelProvider(stubClient({ plan: null }));
    await assert.rejects(
      () => provider.generate({ prompt: 'anything' }),
      ProviderShapeError,
    );
  });
});

describe('buildUserPrompt', () => {
  it('passes a first-build prompt through unchanged', () => {
    assert.equal(
      buildUserPrompt({ prompt: 'a landing page' }),
      'a landing page',
    );
  });

  it('lists existing paths without stuffing file contents into context', () => {
    const prompt = buildUserPrompt({
      prompt: 'make the hero simpler',
      base: {
        revision: 'r0000abcd',
        files: [
          {
            path: 'src/App.tsx',
            content: 'const secret = "should not appear";',
          },
          { path: 'src/styles.css', content: 'body {}' },
        ],
      },
    });

    assert.match(prompt, /revision r0000abcd/);
    assert.match(prompt, /- src\/App\.tsx/);
    assert.match(prompt, /- src\/styles\.css/);
    assert.equal(prompt.includes('should not appear'), false);
    assert.match(prompt, /preserving anything/);
  });

  it('ignores an empty base snapshot', () => {
    const prompt = buildUserPrompt({
      prompt: 'start over',
      base: { revision: 'r00000000', files: [] },
    });
    assert.equal(prompt, 'start over');
  });
});
