import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FakeModelProvider } from '@vibld/core';

import { CASES } from '../src/cases.ts';
import { projectCode, runCase } from '../src/harness.ts';

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
    // #234: every word of the brief is in a README that restates it.
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
