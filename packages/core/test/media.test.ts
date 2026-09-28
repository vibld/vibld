import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cleanAlt,
  isMediaPath,
  mediaPathFor,
  mediaResponse,
  parseRange,
  sniffMedia,
  unsatisfiableRange,
  referencedMedia,
  renameMediaReferences,
} from '../src/media.ts';

const bytes = (...parts: (number[] | string)[]): Uint8Array => {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      for (const char of part) out.push(char.charCodeAt(0));
    } else out.push(...part);
  }
  while (out.length < 16) out.push(0);
  return new Uint8Array(out);
};

describe('what a file is, from its own bytes', () => {
  it('recognises every accepted image and video type', () => {
    const cases: [Uint8Array, string][] = [
      [bytes([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
      [bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
      [bytes('GIF89a'), 'image/gif'],
      [bytes('RIFF', [0, 0, 0, 0], 'WEBP'), 'image/webp'],
      [bytes([0, 0, 0, 0x1c], 'ftypavif'), 'image/avif'],
      [bytes([0, 0, 0, 0x20], 'ftypisom'), 'video/mp4'],
      [bytes([0, 0, 0, 0x20], 'ftypmp42'), 'video/mp4'],
      [bytes([0x1a, 0x45, 0xdf, 0xa3]), 'video/webm'],
    ];
    for (const [file, type] of cases) {
      assert.equal(sniffMedia(file)?.contentType, type, type);
    }
  });

  it('refuses SVG, HTML, QuickTime and anything unrecognised, whatever it is called', () => {
    for (const file of [
      bytes('<svg xmlns="http://www.w3.org/2000/svg">'),
      bytes('<!doctype html><script>'),
      bytes([0, 0, 0, 0x14], 'ftypqt  '),
      bytes('MZ'),
      new Uint8Array([0xff, 0xd8]),
    ]) {
      assert.equal(sniffMedia(file), null);
    }
  });
});

describe('the path a stored file is served at', () => {
  it("reduces the uploader's name to something safe and readable", () => {
    assert.equal(
      mediaPathFor('Hero Loop (Final).MOV', 'mp4', new Set()),
      'media/hero-loop-final.mp4',
    );
    assert.equal(
      mediaPathFor('../../etc/passwd', 'png', new Set()),
      'media/passwd.png',
    );
    assert.equal(mediaPathFor('Café.jpg', 'jpg', new Set()), 'media/cafe.jpg');
    // An accent is dropped with its letter kept, not turned into a hyphen.
    assert.equal(
      mediaPathFor('Résumé Naïve.png', 'png', new Set()),
      'media/resume-naive.png',
    );
    assert.equal(mediaPathFor('???', 'webp', new Set()), 'media/media.webp');
  });

  it('never reuses a path already taken', () => {
    const taken = new Set(['media/hero.mp4', 'media/hero-2.mp4']);
    assert.equal(mediaPathFor('hero.mp4', 'mp4', taken), 'media/hero-3.mp4');
  });

  it('accepts only paths this feature could have written', () => {
    assert.equal(isMediaPath('media/hero.mp4'), true);
    for (const path of [
      'media/../secret.mp4',
      'media/sub/hero.mp4',
      'media/hero.svg',
      'media/Hero.mp4',
      'hero.mp4',
      'media/.mp4',
    ]) {
      assert.equal(isMediaPath(path), false, path);
    }
  });
});

describe('which media a project uses', () => {
  it('finds every library path its files name, however they are written', () => {
    assert.deepEqual(
      referencedMedia([
        {
          content:
            '<video src="/media/loop.mp4" poster="/media/loop-poster.jpg">',
        },
        { content: `.hero{background:url(/media/sky.webp)}` },
        { content: `const src = "media/pier.jpg";` },
      ]),
      [
        'media/loop-poster.jpg',
        'media/loop.mp4',
        'media/pier.jpg',
        'media/sky.webp',
      ],
    );
  });

  it('does not count a path that only ends like one, or lives elsewhere', () => {
    assert.deepEqual(
      referencedMedia([
        {
          content: [
            '/assets/media/nested.jpg',
            'https://cdn.example.com/media/remote.jpg',
            '/social-media/x.jpg',
            '/media/Upper.jpg',
            '/media/hero.jpeg',
            '/media/hero.mp4x',
            '/media/hero.jpg.map',
          ].join(' '),
        },
      ]),
      [],
    );
  });
});

describe('renaming what a project uses', () => {
  it('moves every reference to a renamed file, however it is written', () => {
    const files = [
      { path: 'src/App.tsx', content: '<img src="/media/hero.jpg">' },
      {
        path: 'src/styles.css',
        content: '.a{background:url(/media/hero.jpg)}',
      },
      { path: 'src/data.ts', content: 'const src = "media/hero.jpg";' },
      { path: 'README.md', content: 'Nothing here.' },
    ];
    const renamed = renameMediaReferences(
      files,
      new Map([['media/hero.jpg', 'media/hero-2.jpg']]),
    );
    assert.deepEqual(
      renamed.map((file) => file.content),
      [
        '<img src="/media/hero-2.jpg">',
        '.a{background:url(/media/hero-2.jpg)}',
        'const src = "media/hero-2.jpg";',
        'Nothing here.',
      ],
    );
    // A file with nothing to rename is the same object, untouched.
    assert.equal(renamed[3], files[3]);
    assert.deepEqual(referencedMedia(renamed), ['media/hero-2.jpg']);
  });

  it('touches nothing that only resembles a reference', () => {
    const content = [
      '/assets/media/hero.jpg',
      '/social-media/hero.jpg',
      '/media/hero.jpg.map',
      '/media/hero.jpgx',
    ].join(' ');
    const [file] = renameMediaReferences(
      [{ path: 'a', content }],
      new Map([['media/hero.jpg', 'media/hero-2.jpg']]),
    );
    assert.equal(file!.content, content);
  });

  it('renames all at once, so two renames never chain', () => {
    const [file] = renameMediaReferences(
      [{ path: 'a', content: '/media/a.jpg /media/b.jpg' }],
      new Map([
        ['media/a.jpg', 'media/b.jpg'],
        ['media/b.jpg', 'media/c.jpg'],
      ]),
    );
    assert.equal(file!.content, '/media/b.jpg /media/c.jpg');
  });
});

describe('alt text as it is kept', () => {
  it('is one line with no control characters and no lone surrogates', () => {
    assert.equal(cleanAlt('  A pier\n\tat dusk  '), 'A pier at dusk');
    assert.equal(cleanAlt('a\u0001b\u007fc\u0085d'), 'a b c d');
    assert.equal(cleanAlt('half \ud83d pair'), 'half pair');
    assert.equal(cleanAlt('whole \ud83c\udf05'), 'whole \ud83c\udf05');
  });

  it('is capped, and never quotes into more than it was allowed to be', () => {
    const stored = cleanAlt('\u0001x'.repeat(400));
    assert.ok(stored.length <= 300);
    // What a prompt carries is the JSON-quoted form: no character in it
    // may grow past two once quoted.
    assert.ok(JSON.stringify(stored).length <= 2 * 300 + 2);
    // A cap that lands inside a surrogate pair drops the half.
    const emoji = cleanAlt('x' + '\ud83c\udf05'.repeat(200));
    assert.ok(!/[\ud800-\udbff]$/.test(emoji));
  });
});

describe('ranges, which video playback depends on', () => {
  it('reads an open, a closed and a suffix range', () => {
    assert.deepEqual(parseRange('bytes=0-', 1000), { start: 0, end: 999 });
    assert.deepEqual(parseRange('bytes=100-199', 1000), {
      start: 100,
      end: 199,
    });
    assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
    assert.deepEqual(parseRange('bytes=900-5000', 1000), {
      start: 900,
      end: 999,
    });
  });

  it('sends the whole file for a header it does not understand', () => {
    assert.equal(parseRange(null, 1000), null);
    assert.equal(parseRange('bytes=0-1,5-9', 1000), null);
    assert.equal(parseRange('items=0-1', 1000), null);
  });

  it('refuses a range that starts past the end', () => {
    assert.equal(parseRange('bytes=1000-', 1000), 'unsatisfiable');
    assert.equal(unsatisfiableRange(1000).status, 416);
    assert.equal(
      unsatisfiableRange(1000).headers.get('content-range'),
      'bytes */1000',
    );
  });

  it('answers a range with a 206 and exactly that many bytes', async () => {
    const response = mediaResponse({
      body: new Uint8Array([3, 4, 5]),
      size: 10,
      contentType: 'video/mp4',
      range: { start: 3, end: 5 },
    });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 3-5/10');
    assert.equal(response.headers.get('content-length'), '3');
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(
      [...new Uint8Array(await response.arrayBuffer())],
      [3, 4, 5],
    );
  });

  it('sends headers and no body for a HEAD', async () => {
    const response = mediaResponse({
      body: new Uint8Array([1, 2]),
      size: 2,
      contentType: 'image/png',
      range: null,
      method: 'HEAD',
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-length'), '2');
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  });
});
