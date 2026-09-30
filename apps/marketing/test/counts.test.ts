import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { approxCount } from '../app/counts.ts';
import { ROUTES } from '../app/site.ts';

describe('approxCount (D105)', () => {
  it('rounds a count down to a friendly N+', () => {
    assert.equal(approxCount(0), '0');
    assert.equal(approxCount(4), '4');
    assert.equal(approxCount(9), '9');
    assert.equal(approxCount(10), '10+');
    assert.equal(approxCount(14), '10+');
    assert.equal(approxCount(24), '20+');
    assert.equal(approxCount(99), '90+');
    assert.equal(approxCount(100), '100+');
    assert.equal(approxCount(207), '200+');
    assert.equal(approxCount(1656), '1,600+');
  });

  it('refuses what is not a count', () => {
    assert.throws(() => approxCount(-1));
    assert.throws(() => approxCount(2.5));
  });
});

const CLIENT = new URL('../build/client', import.meta.url).pathname;
const built = existsSync(join(CLIENT, 'index.html'));

describe('counts on vibld.com', { skip: !built && 'no build' }, () => {
  /**
   * Any exact count of ten or more of what the product has, in a page's
   * text or its metadata. A count written straight into copy, or a
   * `.length` rendered without approxCount, shows up here.
   */
  const EXACT = new RegExp(
    String.raw`(?<![\d,.$+])\b(?:[1-9]\d{1,2}|[1-9],\d{3})\b(?![+\d,.:%])\s+` +
      String.raw`(?:app and website )?(?:templates|designs|palettes|styles|named styles|directions|presets|style presets|surface treatments|moving backgrounds|backgrounds|checks|design checks|examples|pairs|type pairings|fonts|layers|use cases|with a color system|more:)`,
    'g',
  );

  it('states no count of ten or more exactly', () => {
    const found: string[] = [];
    for (const route of ROUTES) {
      const file = join(
        CLIENT,
        route.path === '/' ? '' : route.path.slice(1),
        'index.html',
      );
      if (!existsSync(file)) continue;
      const text = readFileSync(file, 'utf8')
        .replace(/<script[\s\S]*?<\/script>/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ');
      for (const match of text.matchAll(EXACT)) {
        found.push(`${route.path}: ${match[0]}`);
      }
    }
    assert.deepEqual(found, [], found.join('\n'));
  });
});
