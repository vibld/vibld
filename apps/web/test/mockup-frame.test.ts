import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { Window } from 'happy-dom';

/**
 * The frame a mockup renders in, and what it is not allowed to do.
 *
 * Mockup HTML is model output. `sandbox=""` denies capabilities, the meta
 * policy below denies fetches, and the removal pass denies navigation.
 * Every one of those three was claimed before it was true, which is what
 * the module's own header is about.
 *
 * ## Why this test builds a DOM
 *
 * `mockup-frame.ts` parses with `DOMParser` rather than matching markup,
 * after five rounds in which a regex was defeated by something the real
 * tokenizer does and I did not predict: a `<head` in a comment, an
 * entity-encoded attribute value, a quoted `>` before the attribute. The
 * point of the module is that the parser decides, so the point of this
 * file is to check it against a parser rather than against my reading.
 *
 * Installed here instead of by `test/harness/components.mjs`, which only
 * fires for `*.test.tsx`. That rule is deliberate and worth keeping: it is
 * what stops Worker code reaching for a browser global and passing here.
 * This file is one process, this global is its own, and the module under
 * test genuinely is browser-only -- it is called from `MockupChooser`.
 *
 * happy-dom was checked against all three bypasses before being trusted
 * with them: it keeps a quoted `>` inside the attribute value, decodes
 * `&#x72;` to `r`, and reports `http-equiv="refresh"` in each case, which
 * is what a browser does.
 */
before(() => {
  const window = new Window({ url: 'https://app.vibld.test/' });
  Object.defineProperty(globalThis, 'DOMParser', {
    configurable: true,
    value: window.DOMParser,
  });
});

const { MOCKUP_FRAME_POLICY, mockupFrameDocument } =
  await import('../src/generation/mockup-frame.ts');

describe('what a mockup frame is allowed to load', () => {
  it('forbids everything by default', () => {
    assert.match(MOCKUP_FRAME_POLICY, /default-src 'none'/);
  });

  it('allows the inline style a mockup is made of', () => {
    assert.match(MOCKUP_FRAME_POLICY, /style-src 'unsafe-inline'/);
  });

  it('allows an embedded image but not a fetched one', () => {
    assert.match(MOCKUP_FRAME_POLICY, /img-src data:/);
    assert.doesNotMatch(MOCKUP_FRAME_POLICY, /img-src[^;]*https?:/);
    assert.doesNotMatch(MOCKUP_FRAME_POLICY, /\*/);
  });

  it('names no host at all', () => {
    assert.doesNotMatch(MOCKUP_FRAME_POLICY, /https?:/);
  });
});

describe('where the policy lands', () => {
  it('leads the head, ahead of anything the head contains', () => {
    // A meta CSP governs only what the parser meets after it, so being
    // second is the same as being absent.
    const framed = mockupFrameDocument(
      '<!doctype html><html><head><link rel="stylesheet" href="https://evil.example/x.css"></head><body>x</body></html>',
    );
    const policyAt = framed.indexOf('Content-Security-Policy');
    const linkAt = framed.indexOf('stylesheet');
    assert.ok(policyAt > -1, 'no policy in the framed document');
    assert.ok(linkAt > -1, 'the test fixture lost its link');
    assert.ok(policyAt < linkAt, 'the policy landed after what it governs');
  });

  it('gives a document with no head of its own a head with the policy in it', () => {
    const framed = mockupFrameDocument('<p>just a fragment</p>');
    assert.match(framed, /Content-Security-Policy/);
    assert.match(framed, /just a fragment/);
  });

  it('does not trust a head that is not where it claims to be', () => {
    // The finding against the first fix: searching for `<head` means
    // trusting the document to be well formed, in a function that exists
    // because it is not.
    const framed = mockupFrameDocument(
      '<!doctype html><!-- <head> --><html><head><link rel="stylesheet" href="https://evil.example/x.css"></head><body>x</body></html>',
    );
    const policyAt = framed.indexOf('Content-Security-Policy');
    const linkAt = framed.indexOf('stylesheet');
    assert.ok(policyAt < linkAt, 'a commented head moved the policy');
  });

  it('keeps the doctype first, so the frame stays out of quirks mode', () => {
    assert.match(mockupFrameDocument('<p>x</p>'), /^<!doctype html>/i);
    assert.match(
      mockupFrameDocument('<!doctype html><p>x</p>'),
      /^<!doctype html>/i,
    );
    // A document whose own doctype was malformed still gets a real one,
    // because this emits one rather than preserving whatever was there.
    assert.match(
      mockupFrameDocument('<!docstype htm><p>x</p>'),
      /^<!doctype html>/i,
    );
  });
});

/**
 * Where the frame may go, which neither the sandbox nor the policy governs.
 *
 * `default-src 'none'` restricts what a document fetches. `sandbox=""`
 * stops a frame navigating anything *else*. Neither stops it replacing
 * itself, and `navigate-to` was dropped from the spec, so the lever is the
 * markup -- and the markup has to be read by a parser, not a pattern.
 */
describe('where a mockup frame may go', () => {
  it('removes a refresh that would navigate with nobody touching it', () => {
    // The one that matters: no click, so a mockup carrying one contacts the
    // host the instant it renders.
    const framed = mockupFrameDocument(
      '<!doctype html><html><head><meta http-equiv="refresh" content="0;url=https://evil.example/"></head><body>x</body></html>',
    );
    assert.doesNotMatch(framed, /refresh/i);
    assert.doesNotMatch(framed, /evil\.example/);
  });

  it('removes a refresh however it is spelled', () => {
    for (const markup of [
      "<meta http-equiv='REFRESH' content='0;url=https://evil.example/'>",
      '<META HTTP-EQUIV="Refresh" CONTENT="2">',
      '<meta content="0;url=https://evil.example/" http-equiv=refresh>',
      '<meta http-equiv = "refresh" content="0">',
    ]) {
      assert.doesNotMatch(
        mockupFrameDocument(markup),
        /refresh/i,
        `survived: ${markup}`,
      );
    }
  });

  it('removes a refresh whose value never says refresh', () => {
    // Round four's bypass. The parser decodes `&#x72;` to `r` and
    // navigates; a pattern reading the source compares against a string the
    // browser never sees.
    for (const markup of [
      '<meta http-equiv="ref&#x72;esh" content="0;url=https://evil.example/">',
      '<meta http-equiv="&#114;efresh" content="0;url=https://evil.example/">',
      '<meta http-equiv="refres&#104;" content="0">',
    ]) {
      const framed = mockupFrameDocument(markup);
      assert.doesNotMatch(framed, /refresh/i, `survived: ${markup}`);
      assert.doesNotMatch(framed, /evil\.example/, `survived: ${markup}`);
    }
  });

  it('removes a refresh hidden behind a quoted angle bracket', () => {
    // Round five's bypass, and the one that ended the pattern-matching
    // approach. The tokenizer keeps that `>` inside `data-x` and reads the
    // whole tag; `[^>]*` stopped at it and the tag survived untouched.
    for (const markup of [
      '<meta data-x=">" http-equiv="refresh" content="0;url=https://evil.example">',
      "<meta data-x='>>>' http-equiv=refresh content='0;url=https://evil.example'>",
      '<meta data-x="a>b" data-y=">" http-equiv="refresh" content="0">',
    ]) {
      const framed = mockupFrameDocument(markup);
      assert.doesNotMatch(framed, /refresh/i, `survived: ${markup}`);
      assert.doesNotMatch(framed, /evil\.example/, `survived: ${markup}`);
    }
  });

  it('removes a nested document the query cannot see into', () => {
    // The sixth finding, and the first that parsing alone did not close
    // (#189 review). The refresh lives inside an *attribute value* until
    // the browser makes a document of it, so a query over this document
    // never visits it. The nested context inherits the CSP, which does not
    // govern navigation, and the sandbox lets it replace itself.
    const framed = mockupFrameDocument(
      `<iframe srcdoc="<meta http-equiv=refresh content='0;url=https://evil.example'>"></iframe>`,
    );
    assert.doesNotMatch(framed, /evil\.example/);
    assert.doesNotMatch(framed, /srcdoc/i);
  });

  it('removes every other way to open a nested context', () => {
    for (const markup of [
      '<object data="https://evil.example/x"></object>',
      '<embed src="https://evil.example/x">',
      '<frame src="https://evil.example/x">',
    ]) {
      assert.doesNotMatch(
        mockupFrameDocument(markup),
        /evil\.example/,
        `survived: ${markup}`,
      );
    }
  });

  it('removes a template, whose content this query also cannot see', () => {
    // Not a known live path: template content does not render, and it
    // cannot be cloned without script, which the sandbox denies. It is
    // removed because it is a second place the query is blind, and this
    // file's record on places I could not see is five for five.
    const framed = mockupFrameDocument(
      '<template><meta http-equiv="refresh" content="0;url=https://evil.example"></template>',
    );
    assert.doesNotMatch(framed, /refresh/i);
    assert.doesNotMatch(framed, /evil\.example/);
  });

  it('removes a base the document tries to set for itself', () => {
    // Ours leads the head and wins on `target`, but sets no `href` -- so a
    // later `<base href>` would be the first with one, and would become
    // what every relative URL resolves against.
    const framed = mockupFrameDocument(
      '<base href="https://evil.example/"><a href="/go">x</a>',
    );
    assert.doesNotMatch(framed, /evil\.example/);
    assert.match(framed, /href="\/go"/);
  });

  it('points links at a context the sandbox will not open', () => {
    const framed = mockupFrameDocument(
      '<!doctype html><body><a href="https://x/">go</a></body>',
    );
    assert.match(framed, /<base target="_blank">/);
  });

  it('strips an explicit target that would defeat that', () => {
    // `target="_self"` on an external link is the click-driven half: the
    // frame replaces itself and the host learns the viewer's address.
    const framed = mockupFrameDocument(
      '<a href="https://evil.example/" target="_self">go</a>',
    );
    assert.doesNotMatch(framed, /target="_self"/i);
    assert.match(framed, /href="https:\/\/evil\.example\/"/);
    // Ours is the only target left standing.
    assert.equal(framed.match(/target=/g)?.length, 1);
  });

  it('keeps the content policy, which is added after the removal pass', () => {
    // Ours is an `http-equiv` meta too, so the order is the whole of why it
    // survives. Reversing it would leave a frame with no policy at all and
    // nothing saying so.
    const framed = mockupFrameDocument(
      '<!doctype html><html><head><meta http-equiv="refresh" content="0"></head><body>x</body></html>',
    );
    assert.match(framed, /Content-Security-Policy/);
    assert.match(framed, /<base target="_blank">/);
  });

  it('leaves the document otherwise as it was', () => {
    const framed = mockupFrameDocument(
      '<!doctype html><html><body><h1>Sourdough</h1><p>Baked daily.</p><img src="data:image/gif;base64,R0lGOD"></body></html>',
    );
    assert.match(framed, /<h1>Sourdough<\/h1>/);
    assert.match(framed, /Baked daily\./);
    assert.match(framed, /data:image\/gif/);
  });
});
