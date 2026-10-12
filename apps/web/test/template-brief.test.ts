import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_BRIEF_CHARS,
  TEMPLATE_BRIEF_KEY,
  captureTemplateBrief,
  readTemplateBrief,
  takeTemplateBrief,
} from '../src/templates/template-brief.ts';

function memory() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const hashFor = (template: string, brief: string) =>
  `#${new URLSearchParams({ template, brief }).toString()}`;

describe('a template brief from vibld.com (D106)', () => {
  it('reads the template and its brief from the fragment', () => {
    assert.deepEqual(
      readTemplateBrief(hashFor('loanlight', '## Loanlight\nBuild it.')),
      {
        template: 'loanlight',
        brief: '## Loanlight\nBuild it.',
        screens: [],
      },
    );
  });

  it('reads the screens chosen with it (D110), each once, and only ids', () => {
    const hash = `#${new URLSearchParams({
      template: 'loanlight',
      brief: 'Build it.',
      screens: 'mendwick,Bad Id!,relayon,mendwick,a,b,c,d,e',
    }).toString()}`;
    assert.deepEqual(readTemplateBrief(hash)?.screens, [
      'mendwick',
      'relayon',
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('keeps the screens through sign-in', () => {
    const storage = memory();
    storage.setItem(
      TEMPLATE_BRIEF_KEY,
      JSON.stringify({
        template: 'loanlight',
        brief: 'Build it.',
        screens: ['mendwick', 7, '../x'],
      }),
    );
    assert.deepEqual(takeTemplateBrief(storage)?.screens, ['mendwick']);
  });

  it('ignores a fragment without a usable brief', () => {
    assert.equal(readTemplateBrief(''), null);
    assert.equal(readTemplateBrief('#section-2'), null);
    assert.equal(readTemplateBrief(hashFor('loanlight', '   ')), null);
    assert.equal(readTemplateBrief(hashFor('Not An Id!', 'x')), null);
    assert.equal(
      readTemplateBrief(hashFor('big', 'x'.repeat(MAX_BRIEF_CHARS + 1))),
      null,
    );
  });

  it('keeps it through sign-in and takes it out of the address', () => {
    const storage = memory();
    const replaced: string[] = [];
    captureTemplateBrief(
      {
        hash: hashFor('loanlight', 'Build it.'),
        pathname: '/',
        search: '?ref=AB',
      },
      { replaceState: (_s, _t, url) => void replaced.push(String(url)) },
      storage,
    );
    assert.deepEqual(replaced, ['/?ref=AB']);
    assert.ok(storage.map.has(TEMPLATE_BRIEF_KEY));
  });

  it('leaves the address alone when there is no brief', () => {
    const replaced: string[] = [];
    captureTemplateBrief(
      { hash: '#pricing', pathname: '/', search: '' },
      { replaceState: () => void replaced.push('x') },
      memory(),
    );
    assert.deepEqual(replaced, []);
  });

  it('hands the brief to the composer once', () => {
    const storage = memory();
    storage.setItem(
      TEMPLATE_BRIEF_KEY,
      JSON.stringify({ template: 'loanlight', brief: 'Build it.' }),
    );
    assert.equal(takeTemplateBrief(storage)?.brief, 'Build it.');
    assert.equal(takeTemplateBrief(storage), null);
    assert.equal(takeTemplateBrief(null), null);
  });

  it('drops a kept value it cannot read', () => {
    const storage = memory();
    storage.setItem(TEMPLATE_BRIEF_KEY, '{not json');
    assert.equal(takeTemplateBrief(storage), null);
    assert.equal(storage.map.size, 0);
  });
});

describe("a prompt typed on vibld.com's home page (D208)", () => {
  const promptHash = (prompt: string) =>
    `#${new URLSearchParams({ prompt }).toString()}`;

  it('reads the prompt, with no template and no screens', () => {
    assert.deepEqual(
      readTemplateBrief(promptHash('  A site for my pottery classes.\n')),
      { template: null, brief: 'A site for my pottery classes.', screens: [] },
    );
  });

  it('ignores an empty or oversized prompt', () => {
    assert.equal(readTemplateBrief(promptHash(' \n ')), null);
    assert.equal(
      readTemplateBrief(promptHash('x'.repeat(MAX_BRIEF_CHARS + 1))),
      null,
    );
  });

  it('reads a template link as one, even with a prompt beside it', () => {
    const hash = `#${new URLSearchParams({
      template: 'loanlight',
      brief: 'Build it.',
      prompt: 'Something else.',
    }).toString()}`;
    assert.equal(readTemplateBrief(hash)?.brief, 'Build it.');
  });

  it('keeps it through sign-in and hands it to the composer once', () => {
    const storage = memory();
    const replaced: string[] = [];
    captureTemplateBrief(
      { hash: promptHash('A bakery site.'), pathname: '/', search: '' },
      { replaceState: (_s, _t, url) => void replaced.push(String(url)) },
      storage,
    );
    assert.deepEqual(replaced, ['/']);
    assert.deepEqual(takeTemplateBrief(storage), {
      template: null,
      brief: 'A bakery site.',
      screens: [],
    });
    assert.equal(takeTemplateBrief(storage), null);
  });

  it('drops a kept value with no template field at all', () => {
    const storage = memory();
    storage.setItem(TEMPLATE_BRIEF_KEY, JSON.stringify({ brief: 'x' }));
    assert.equal(takeTemplateBrief(storage), null);
  });
});
