import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MOCKUP_FRAME_POLICY,
  mockupFrameDocument,
} from '../src/generation/mockup-frame.ts';

/**
 * The network policy `sandbox=""` does not provide (#189 review, P1).
 *
 * A fully sandboxed frame still fetches a remote image, stylesheet or font,
 * which discloses the viewer's IP to a host the model chose. The prompt
 * forbids those, and the whole argument for the sandbox was that a request
 * is not a guarantee, so the network could not be left on the prompt's good
 * behaviour either.
 *
 * What these can assert is that the policy is present, correct and ahead of
 * everything it governs. Enforcement is the browser's.
 */

describe('the policy a mockup frame carries', () => {
  it('forbids everything by default', () => {
    assert.match(MOCKUP_FRAME_POLICY, /default-src 'none'/);
  });

  it('allows the inline style a mockup is made of', () => {
    // Without this every direction renders as unstyled text, which is not a
    // direction at all.
    assert.match(MOCKUP_FRAME_POLICY, /style-src 'unsafe-inline'/);
  });

  it('allows an embedded image but not a fetched one', () => {
    // A data: image is self-contained and discloses nothing. A remote one
    // is a request to somebody else's server.
    assert.match(MOCKUP_FRAME_POLICY, /img-src data:/);
    assert.doesNotMatch(MOCKUP_FRAME_POLICY, /img-src[^;]*https?:/);
    assert.doesNotMatch(MOCKUP_FRAME_POLICY, /\*/);
  });

  it('names no remote host at all', () => {
    assert.doesNotMatch(MOCKUP_FRAME_POLICY, /https?:/);
  });
});

describe('where the policy lands', () => {
  it('leads the document, so nothing it governs is parsed first', () => {
    const framed = mockupFrameDocument(
      '<!doctype html><html><head><style>body{color:red}</style></head><body>hi</body></html>',
    );
    assert.ok(
      framed.indexOf('Content-Security-Policy') < framed.indexOf('<style>'),
      'the policy sits after content it is supposed to govern',
    );
  });

  it('keeps the doctype first, so the frame stays out of quirks mode', () => {
    const framed = mockupFrameDocument(
      '<!doctype html><html><body>x</body></html>',
    );
    assert.match(
      framed,
      /^<!doctype html><meta http-equiv="Content-Security-Policy"/i,
    );
  });

  it('leads a document that has no doctype at all', () => {
    const framed = mockupFrameDocument(
      '<body><img src="https://x/y.png"></body>',
    );
    assert.ok(framed.startsWith('<meta http-equiv="Content-Security-Policy"'));
    assert.ok(
      framed.indexOf('img') > framed.indexOf('Content-Security-Policy'),
    );
  });

  it('does not trust a head that is not where it claims to be', () => {
    // The reason placement moved off `<head>` (#189 review follow-up).
    // Searching for the head means trusting the document to be well
    // formed, and this function exists because it cannot be trusted. A
    // `<head` in a comment used to take the policy with it.
    const framed = mockupFrameDocument(
      '<!doctype html><!-- <head> --><html><head><style>body{color:red}</style></head><body>x</body></html>',
    );
    assert.ok(
      framed.indexOf('Content-Security-Policy') < framed.indexOf('<!--'),
      'a commented-out head moved the policy behind real content',
    );
    assert.ok(
      framed.indexOf('Content-Security-Policy') < framed.indexOf('<style>'),
    );
  });

  it('keeps the document it was given', () => {
    // The mockup is what the person chose. This adds a policy; it must not
    // quietly become a different page.
    const html =
      '<!doctype html><html><head></head><body><h1>Sourdough</h1></body></html>';
    const framed = mockupFrameDocument(html);
    assert.match(framed, /<h1>Sourdough<\/h1>/);
    assert.match(framed, /^<!doctype html>/i);
  });
});
