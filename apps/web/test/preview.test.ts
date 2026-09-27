import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveBrief } from '../src/generation/brief.ts';
import { buildProjectFiles } from '../src/generation/plan-builder.ts';
import { buildPreviewDocument, escapeHtml } from '../src/generation/preview.ts';

describe('local mock preview', () => {
  const brief = deriveBrief('a security landing page with pricing and an faq');
  const document = buildPreviewDocument(brief, {
    revision: 'r00000000',
    files: buildProjectFiles(brief),
  });

  it('renders the plan structure as static HTML', () => {
    assert.ok(document.startsWith('<!doctype html>'));
    assert.ok(document.includes('<h1'));
    assert.ok(document.includes('Pricing'));
    assert.ok(document.includes('Frequently asked questions'));
  });

  it('contains no script element', () => {
    assert.equal(/<script/i.test(document), false);
  });

  it('escapes text taken from the prompt', () => {
    assert.equal(
      escapeHtml('<img src=x onerror="a">'),
      '&lt;img src=x onerror=&quot;a&quot;&gt;',
    );
    const hostile = deriveBrief('<script>alert(1)</script> shop page');
    const rendered = buildPreviewDocument(hostile, {
      revision: 'r00000000',
      files: buildProjectFiles(hostile),
    });
    assert.equal(/<script/i.test(rendered), false);
  });

  it('strips imports and url() from the inlined stylesheet', () => {
    const rendered = buildPreviewDocument(brief, {
      revision: 'r00000000',
      files: [
        {
          path: 'src/styles.css',
          content:
            '@import url("https://example.com/x.css"); body { background: url(javascript:1); }',
        },
      ],
    });
    assert.equal(rendered.includes('@import'), false);
    assert.equal(rendered.includes('url('), false);
  });
});
