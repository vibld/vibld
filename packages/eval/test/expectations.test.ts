import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FakeModelProvider } from '@vibld/core';

import { CASES, stubPlan } from '../src/cases.ts';
import {
  expectationProblems,
  expectationText,
  meetsExpectation,
  projectCode,
  runCase,
} from '../src/harness.ts';

const MANIFEST = JSON.stringify({
  name: 'app',
  scripts: { dev: 'vite', build: 'tsc --noEmit && vite build' },
  devDependencies: { vite: '8.3.0', typescript: '7.0.2' },
});

const booking = CASES.find((c) => c.id === 'pottery-booking')!;

function project(app: string, readme = '# app\n') {
  return new FakeModelProvider([
    {
      summary: 'an app',
      files: [
        { path: 'package.json', content: MANIFEST },
        { path: 'tsconfig.json', content: '{}' },
        { path: 'README.md', content: readme },
        { path: 'index.html', content: '<!doctype html><div id="root"></div>' },
        { path: 'src/App.tsx', content: app },
      ],
    },
  ]);
}

const WORKING = `export default function App() {
  const saved = localStorage.getItem('booking');
  localStorage.setItem('booking', saved ?? '[]');
  return <main>Pick a slot. Cancel any time. Saved in this browser. {saved}</main>;
}`;

describe('what an app case accepts', () => {
  it('accepts an app whose code does the things', async () => {
    const result = await runCase(booking, project(WORKING));
    assert.deepEqual(result.problems, []);
    assert.equal(result.outcome, 'accepted');
  });

  it('does not count a README that repeats the brief', async () => {
    // internal PR 234: every word of the brief is in a README that restates it.
    const result = await runCase(
      booking,
      project(
        'export default function App() { return <main>Pottery</main>; }',
        `# Booking\n\n${booking.prompt}\n\nlocalStorage.getItem('x')\n`,
      ),
    );
    assert.equal(result.outcome, 'failed-expectations');
    assert.ok(result.problems.some((p) => p.includes('"slot"')));
  });

  it('does not count words inside comments', async () => {
    const result = await runCase(
      booking,
      project(`/* booking slot cancel browser */
// localStorage.getItem('booking')
export default function App() {
  return <main>{/* localStorage.setItem('x', 'y') */}Pottery</main>;
}`),
    );
    assert.equal(result.outcome, 'failed-expectations');
    assert.ok(result.problems.some((p) => p.includes('"slot"')));
  });
});

describe('the code expectations are read from', () => {
  it('keeps a URL on a line with code', () => {
    const code = projectCode([
      { path: 'src/a.ts', content: "const u = 'https://example.com/csv';" },
    ]);
    assert.match(code, /https:\/\/example\.com\/csv/);
  });

  it('leaves Markdown out entirely', () => {
    assert.doesNotMatch(
      projectCode([{ path: 'NOTES.md', content: 'booking' }]),
      /booking/,
    );
  });
});

describe('an expectation with several wordings (1.8.0)', () => {
  const marketing = CASES.find((c) => c.id === 'vibld-marketing')!;
  const portability = marketing.expects.content.find(
    (expectation) => typeof expectation !== 'string',
  )!;

  /** The page's code, with `claim` as its only portability copy. */
  const page = (claim: string) => [
    { path: 'index.html', content: '<!doctype html><div id="root"></div>' },
    {
      path: 'src/App.tsx',
      content: `export default function App() {\n  return <main className="block inset-0">Vibld. Join the waitlist. ${claim}</main>;\n}\n`,
    },
  ];

  it('is met by any one of its wordings', () => {
    for (const claim of [
      'A portable codebase.',
      'No lock-in, ever.',
      'Your code is yours: take it with you.',
      'Take your code anywhere.',
    ]) {
      assert.equal(
        meetsExpectation(expectationText(page(claim)), portability),
        true,
        claim,
      );
    }
  });

  it('reads a typeset hyphen or a non-breaking space as the plain one', () => {
    // "lock-in" with a non-breaking hyphen, so it never wraps, and "take it
    // with you" with non-breaking spaces: the same claim, typed differently.
    const nbHyphen = String.fromCharCode(0x2011);
    const nbsp = String.fromCharCode(0xa0);
    for (const claim of [`No lock${nbHyphen}in.`, `Take it with${nbsp}you.`]) {
      assert.equal(
        meetsExpectation(expectationText(page(claim)), portability),
        true,
        claim,
      );
    }
  });

  it('is not met by code that merely contains the letters', () => {
    // Every component says `export`, and Tailwind's `block inset-0`
    // contains "lock in". Neither is the claim, and the page above has both.
    assert.equal(
      meetsExpectation(expectationText(page('Ship faster.')), portability),
      false,
    );
  });

  it('is not met by a README or a comment that makes the claim', () => {
    const files = [
      { path: 'README.md', content: 'Portable, no lock-in.' },
      {
        path: 'src/App.tsx',
        content:
          '// portable, no lock-in\nexport default function App() { return <main>Vibld</main>; }\n',
      },
    ];
    assert.equal(meetsExpectation(expectationText(files), portability), false);
  });

  it('names the idea and every wording that would have met it', () => {
    const [problem] = expectationProblems(
      { ...marketing, expects: { files: [], content: [portability] } },
      page('Ship faster.'),
    );
    assert.ok(problem);
    assert.match(
      problem,
      /^the project never mentions "portable", nor says it as /,
    );
    assert.match(problem, /"lock-in"/);
    assert.match(problem, /"take it with you"/);
  });

  it('still reports a single wording the way it always has', () => {
    assert.deepEqual(
      expectationProblems(
        { ...marketing, expects: { files: [], content: ['waitlist'] } },
        page('').map((file) => ({
          ...file,
          content: file.content.replace('waitlist', 'list'),
        })),
      ),
      ['the project never mentions "waitlist"'],
    );
  });

  it('never has an empty list, which no project could meet', () => {
    for (const testCase of CASES) {
      for (const expectation of testCase.expects.content) {
        assert.ok(expectation.length > 0, `${testCase.id} has an empty one`);
      }
    }
  });

  it('accepts a vibld-marketing page that says it in other words', async () => {
    // The 2026-09-27 bakeoff lost one run per model to exactly this.
    const plan = stubPlan(marketing);
    const files = plan.files.map((file) =>
      file.path === 'index.html'
        ? {
            ...file,
            content: file.content.replace(
              /content="[^"]*"/,
              'content="vibld waitlist. no lock-in: take it with you."',
            ),
          }
        : file,
    );
    const result = await runCase(
      marketing,
      new FakeModelProvider([{ ...plan, files }]),
    );
    assert.deepEqual(result.problems, []);
    assert.equal(result.outcome, 'accepted');
  });
});
