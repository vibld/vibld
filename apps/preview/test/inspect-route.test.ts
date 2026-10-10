import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { INSPECTOR_PATH, INSPECTOR_SCRIPT } from '@vibld/core';
import {
  INSPECTOR_TAG,
  forBrowser,
  inspectorResponse,
  isInspectorRequest,
  shouldAddInspector,
  toSandbox,
} from '../worker/inspect-route.ts';

/** Select and Annotate on a sandbox preview (D188). */
describe('the preview inspector', () => {
  it('is served on the preview origin as a script', async () => {
    assert.equal(
      isInspectorRequest(
        new URL(`https://5173-user-abc-tok.vibld-preview.dev${INSPECTOR_PATH}`),
      ),
      true,
    );
    assert.equal(
      isInspectorRequest(
        new URL('https://5173-user-abc-tok.vibld-preview.dev/'),
      ),
      false,
    );
    const response = inspectorResponse();
    assert.match(
      response.headers.get('content-type') ?? '',
      /^text\/javascript/,
    );
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await response.text(), INSPECTOR_SCRIPT);
  });

  it('loads it from a file, which a project allowing only self still runs', () => {
    assert.equal(INSPECTOR_TAG, `<script src="${INSPECTOR_PATH}"></script>`);
  });

  it('is added to HTML pages and nothing else', () => {
    const page = (type: string, status = 200) =>
      new Response('x', { status, headers: { 'content-type': type } });
    const get = new Request('https://5173-user-abc-tok.vibld-preview.dev/', {
      headers: { 'sec-fetch-dest': 'iframe' },
    });
    assert.equal(
      shouldAddInspector(get, page('text/html; charset=utf-8')),
      true,
    );
    assert.equal(shouldAddInspector(get, page('text/javascript')), false);
    assert.equal(shouldAddInspector(get, page('text/css')), false);
    assert.equal(shouldAddInspector(get, page('text/html', 404)), false);
    assert.equal(
      shouldAddInspector(
        new Request(get.url, { method: 'POST', body: 'x' }),
        page('text/html'),
      ),
      false,
    );
    // The app's own fetch of an HTML file is data, left as it is.
    const fetched = (headers: Record<string, string>) =>
      shouldAddInspector(
        new Request(`${get.url}template.html`, { headers }),
        page('text/html'),
      );
    assert.equal(fetched({ 'sec-fetch-dest': 'empty' }), false);
    assert.equal(fetched({ accept: '*/*' }), false);
    assert.equal(fetched({ 'sec-fetch-dest': 'document' }), true);
    assert.equal(fetched({ accept: 'text/html,application/xhtml+xml' }), true);
  });

  it('asks the dev server for the whole page on a navigation', () => {
    const url = 'https://5173-user-abc-tok.vibld-preview.dev/';
    const cached = { 'if-none-match': 'W/"1"', 'if-modified-since': 'x' };
    const page = toSandbox(
      new Request(url, { headers: { ...cached, 'sec-fetch-dest': 'iframe' } }),
    );
    assert.equal(page.headers.get('if-none-match'), null);
    assert.equal(page.headers.get('if-modified-since'), null);
    const script = new Request(`${url}src/main.tsx`, {
      headers: { ...cached, 'sec-fetch-dest': 'script' },
    });
    assert.equal(toSandbox(script), script);
  });

  it('keeps every HTML response out of the browser cache, served either way', () => {
    const asData = new Request(
      'https://5173-user-abc-tok.vibld-preview.dev/template.html',
      { headers: { 'sec-fetch-dest': 'empty' } },
    );
    const html = forBrowser(
      asData,
      new Response('<p>x</p>', {
        headers: {
          'content-type': 'text/html',
          'cache-control': 'max-age=60',
          etag: 'W/"1"',
        },
      }),
    );
    assert.equal(html.headers.get('cache-control'), 'no-store');
    assert.equal(html.headers.get('etag'), null);
    assert.match(html.headers.get('vary') ?? '', /Sec-Fetch-Dest/);
    const script = new Response('1', {
      headers: { 'content-type': 'text/javascript', etag: 'W/"2"' },
    });
    assert.equal(forBrowser(asData, script), script);
  });
});
