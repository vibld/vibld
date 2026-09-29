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
import { requestedPaths } from '@vibld/ai';

import { CASES, stubPlan } from '../../src/cases.ts';

const testCase = CASES.find((entry) => entry.id === 'vibld-marketing')!;

/**
 * One project per run, different every time, so the runs genuinely disagree.
 *
 * Two accepted runs whose output differs, then one that omits a file the case
 * requires. A fake that returned the same thing three times would pass
 * whether or not the repeats were separated on disk.
 *
 * A run is several calls now, because the product builds in bounded steps:
 * an outline, then the files a few at a time. So the project is chosen by
 * which outline this is, and each later call answers from that project with
 * the files it was asked for.
 */
function planFor(run: number): {
  summary: string;
  files: { path: string; content: string }[];
} {
  const plan = stubPlan(testCase);
  if (run === 2) {
    return {
      ...plan,
      files: plan.files.map((file) =>
        file.path === 'src/App.tsx'
          ? { ...file, content: `${file.content}// second run\n` }
          : file,
      ),
    };
  }
  if (run >= 3) {
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
let runs = 0;

/**
 * The reply to one request, read off what it asked for: an outline (its
 * JSON instruction names a "manifest") plans every file of this run's
 * project, and a file-group request is answered with the files it names.
 */
function replyTo(body: {
  messages: { role: string; content: string }[];
}): unknown {
  const system = body.messages[0]?.content ?? '';
  const user = body.messages[1]?.content ?? '';
  if (system.includes('"manifest"')) {
    runs += 1;
    const plan = planFor(runs);
    return {
      summary: plan.summary,
      manifest: plan.files.map((file) => ({
        path: file.path,
        purpose: `The file at ${file.path}.`,
        dependsOn: [],
        size: 'small',
      })),
      delete: [],
    };
  }
  const wanted = requestedPaths(user);
  return {
    files: planFor(runs).files.filter((file) => wanted.includes(file.path)),
  };
}

globalThis.fetch = (async (
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.includes('/chat/completions')) {
    throw new Error(`the fake model service was asked for ${url}`);
  }
  calls += 1;
  process.stdout.write(`fake-model-service call ${calls}\n`);
  const body = JSON.parse(String(init?.body ?? '{}')) as {
    messages: { role: string; content: string }[];
  };
  return new Response(sse(replyTo(body)), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}) as typeof fetch;
