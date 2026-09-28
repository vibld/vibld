import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * The container image and the SDK that talks to it are one version.
 *
 * `@cloudflare/sandbox` (the Worker side) and `cloudflare/sandbox` (the
 * image the container runs) are published together and speak one protocol.
 * Dependabot bumps the npm package and never the Dockerfile, so on
 * 2026-09-28 the package went to 0.12.10 with the image left on 0.12.9;
 * nothing but a reader of the Dockerfile's own comment would have noticed.
 */
const root = join(import.meta.dirname, '..');

describe('the sandbox image', () => {
  it('matches the @cloudflare/sandbox version the Worker is built with', () => {
    const pkg = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
    };
    const sdk = pkg.dependencies?.['@cloudflare/sandbox'];
    const image = /^FROM docker\.io\/cloudflare\/sandbox:(\S+)$/m.exec(
      readFileSync(join(root, 'Dockerfile'), 'utf8'),
    )?.[1];
    assert.ok(sdk, 'no @cloudflare/sandbox dependency');
    assert.ok(image, 'no cloudflare/sandbox base image');
    assert.equal(image, sdk);
  });
});
