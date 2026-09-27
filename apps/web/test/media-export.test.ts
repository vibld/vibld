import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { planMediaExport, toBase64 } from '../worker/media-export.ts';
import type { MediaEntry } from '../worker/media-store.ts';

/**
 * Which uploads a pushed project carries, and where they go, so it shows
 * the same images and video without Vibld.
 */
function entry(path: string, bytes: number): MediaEntry {
  return {
    id: path,
    path,
    kind: path.endsWith('.mp4') ? 'video' : 'image',
    contentType: 'x',
    bytes,
    alt: '',
    gitSha: 'g',
    createdAt: '2026-09-24',
  };
}

const FILES = [
  {
    path: 'src/Hero.tsx',
    content: '<video src="/media/loop.mp4" poster="/media/loop-poster.jpg" />',
  },
  {
    path: 'src/styles.css',
    content: '.a { background: url(/media/grain.png) }',
  },
];

describe('planMediaExport', () => {
  it('carries what the code references, into public/, and nothing else', () => {
    const plan = planMediaExport(FILES, [
      entry('media/loop.mp4', 1000),
      entry('media/loop-poster.jpg', 100),
      entry('media/grain.png', 10),
      entry('media/unused.png', 10),
    ]);
    assert.deepEqual(plan.include.map((item) => item.path).sort(), [
      'public/media/grain.png',
      'public/media/loop-poster.jpg',
      'public/media/loop.mp4',
    ]);
    assert.deepEqual(plan.skipped, []);
  });

  it('leaves out, and names, whatever would pass the size bound', () => {
    const plan = planMediaExport(
      FILES,
      [entry('media/loop.mp4', 900), entry('media/loop-poster.jpg', 200)],
      1000,
    );
    assert.deepEqual(
      plan.include.map((item) => item.entry.path),
      ['media/loop.mp4'],
    );
    assert.deepEqual(plan.skipped, ['/media/loop-poster.jpg']);
  });

  it('leaves out, and names, a single file past the per-file bound', () => {
    // A push holds the file it is sending in memory several times over, so
    // one large video is refused even when the total has room for it.
    const plan = planMediaExport(
      FILES,
      [entry('media/loop.mp4', 600), entry('media/grain.png', 10)],
      10_000,
      500,
    );
    assert.deepEqual(
      plan.include.map((item) => item.entry.path),
      ['media/grain.png'],
    );
    assert.deepEqual(plan.skipped, ['/media/loop.mp4']);
  });

  it('never overwrites a file the project shipped itself', () => {
    const plan = planMediaExport(
      [...FILES, { path: 'public/media/grain.png', content: 'mine' }],
      [entry('media/grain.png', 10)],
    );
    assert.deepEqual(plan.include, []);
  });
});

describe('toBase64', () => {
  it('matches the platform encoding, across chunk boundaries', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 7).map((_, at) => at % 256);
    assert.equal(toBase64(bytes), Buffer.from(bytes).toString('base64'));
  });
});
