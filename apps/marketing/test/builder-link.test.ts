import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { builderUrlFor } from '../app/builder-link.ts';
import { SITE } from '../app/site.ts';

describe("the home page's prompt box (D208)", () => {
  it('sends what was typed to the builder in the fragment', () => {
    const typed = '  A site for my pottery classes & a #booking page.\n';
    const url = new URL(builderUrlFor(typed));
    assert.equal(url.origin, SITE.appUrl);
    assert.equal(url.pathname, '/');
    assert.equal(url.search, '');
    assert.equal(
      new URLSearchParams(url.hash.slice(1)).get('prompt'),
      'A site for my pottery classes & a #booking page.',
    );
  });
});
