/**
 * A model service that answers from this process instead of the network.
 *
 * Loaded with `--import` so `bin/eval.ts` runs its real live path: the real
 * client, the real streaming parser, the real repeat loop, the real writes.
 * Only the socket is replaced. That matters because the bugs worth catching
 * here are in the wiring, and a test that called the loop's pieces directly
 * would assert around exactly the part that has been wrong before.
 *
 * Never reached by a real run: nothing imports this outside the test that
 * passes it on the command line.
 */
import { CASES, stubPlan } from '../../src/cases.ts';

const testCase = CASES.find((entry) => entry.id === 'vibld-marketing')!;

/**
 * One reply per call, different every time, so the runs genuinely disagree.
 *
 * Two accepted runs whose output differs, then one that omits a file the case
 * requires. A fake that returned the same thing three times would pass
 * whether or not the repeats were separated on disk.
 */
function planFor(call: number): unknown {
  const plan = stubPlan(testCase);
  if (call === 2) {
    return {
      ...plan,
      files: plan.files.map((file) =>
        file.path === 'src/App.tsx'
          ? { ...file, content: `${file.content}// second run\n` }
          : file,
      ),
    };
  }
  if (call >= 3) {
    return {
      ...plan,
      files: plan.files.filter((file) => file.path !== 'DESIGN.md'),
    };
  }
  return plan;
}

function sse(plan: unknown): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const body = JSON.stringify(plan);
  const chunk = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          chunk({
            choices: [{ delta: { content: body }, finish_reason: null }],
          }),
        ),
      );
      controller.enqueue(
        encoder.encode(
          chunk({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
        ),
      );
      controller.enqueue(
        encoder.encode(
          chunk({
            choices: [],
            usage: { prompt_tokens: 1000, completion_tokens: 2000 },
          }),
        ),
      );
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

let calls = 0;

globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.includes('/chat/completions')) {
    throw new Error(`the fake model service was asked for ${url}`);
  }
  calls += 1;
  process.stdout.write(`fake-model-service call ${calls}\n`);
  return new Response(sse(planFor(calls)), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}) as typeof fetch;
