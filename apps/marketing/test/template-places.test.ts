import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { placeHref, placeOf, placePath } from '../app/template-places.ts';

describe('template gallery places (D161)', () => {
  it('reads a category and subcategory from a path, and writes it back', () => {
    for (const path of [
      '/templates',
      '/templates/websites',
      '/templates/websites/ecommerce',
      '/templates/apps/internal-tools',
      '/templates/screens',
    ])
      assert.equal(placePath(placeOf(path)), path);
    assert.deepEqual(placeOf('/templates/websites/nothing'), {
      group: '',
      sub: '',
    });
  });

  it('carries the filters to another place', () => {
    assert.equal(
      placeHref({ group: 'websites', sub: 'ecommerce' }, '?q=shop&sort=new'),
      '/templates/websites/ecommerce?q=shop&sort=new',
    );
    assert.equal(placeHref({ group: 'apps', sub: '' }, ''), '/templates/apps');
  });

  it('drops a screen type where no screens are listed', () => {
    assert.equal(
      placeHref({ group: 'websites', sub: '' }, '?screen=dashboard&q=x'),
      '/templates/websites?q=x',
    );
    assert.equal(
      placeHref({ group: 'apps', sub: 'saas' }, '?screen=dashboard'),
      '/templates/apps/saas',
    );
    assert.equal(
      placeHref({ group: 'screens', sub: '' }, '?screen=dashboard'),
      '/templates/screens?screen=dashboard',
    );
    assert.equal(
      placeHref({ group: '', sub: '' }, '?screen=dashboard'),
      '/templates?screen=dashboard',
    );
  });
});
