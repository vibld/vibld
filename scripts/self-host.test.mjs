import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  APPS,
  VIBLD_OWN,
  namesFor,
  parseJsonc,
  selfHostConfig,
} from './self-host.mjs';

const base = Object.fromEntries(
  APPS.map((app) => [
    app,
    parseJsonc(
      readFileSync(
        new URL(`../apps/${app}/wrangler.jsonc`, import.meta.url),
        'utf8',
      ),
    ),
  ]),
);

const SETTINGS = {
  prefix: 'acme',
  d1DatabaseId: '00000000-1111-2222-3333-444444444444',
  clerkFrontendApiUrl: 'https://acme.clerk.accounts.dev',
  provider: 'deepseek',
  rateLimitNamespaceBase: 5001,
};

describe("a self-hosted copy's configuration (D115)", () => {
  it("reads vibld's own configuration, comments and all", () => {
    assert.equal(base.web.name, 'vibld-web-preview');
    assert.equal(base.preview.name, 'vibld-preview');
    assert.equal(base.publish.name, 'vibld-publish');
  });

  it("leaves nothing of vibld's deployment in any Worker", () => {
    for (const app of APPS) {
      const text = JSON.stringify(selfHostConfig(app, base[app], SETTINGS));
      for (const name of VIBLD_OWN)
        assert.ok(!text.includes(name), `${app}: ${name}`);
    }
  });

  it('names every Worker, the database, the bucket and the Workflow from the prefix', () => {
    const names = namesFor('acme');
    const web = selfHostConfig('web', base.web, SETTINGS);
    const preview = selfHostConfig('preview', base.preview, SETTINGS);
    const publish = selfHostConfig('publish', base.publish, SETTINGS);
    assert.equal(web.name, 'acme-web');
    assert.equal(preview.name, 'acme-preview');
    assert.equal(publish.name, 'acme-publish');
    for (const config of [web, preview, publish]) {
      assert.deepEqual(
        config.d1_databases.map((d) => [d.database_name, d.database_id]),
        [[names.database, SETTINGS.d1DatabaseId]],
      );
      assert.deepEqual(
        config.r2_buckets.map((b) => b.bucket_name),
        [names.bucket],
      );
    }
    // No preview domain: not bound to the publish Worker (see below).
    assert.deepEqual(web.services.map((s) => s.service).sort(), [
      'acme-preview',
    ]);
    assert.deepEqual(
      preview.services.map((s) => s.service),
      ['acme-publish'],
    );
    assert.equal(web.workflows[0].name, 'acme-generation');
  });

  it('serves from workers.dev without domains, and from yours with them', () => {
    const bare = selfHostConfig('web', base.web, SETTINGS);
    assert.equal(bare.routes, undefined);
    assert.equal(bare.workers_dev, true);
    assert.equal(
      bare.vars.CLERK_FRONTEND_API_URL,
      SETTINGS.clerkFrontendApiUrl,
    );
    assert.equal(bare.vars.VIBLD_PROVIDER, 'deepseek');
    assert.equal(bare.vars.VIBLD_MODEL, undefined);
    const sandbox = selfHostConfig('preview', base.preview, SETTINGS);
    assert.equal(sandbox.vars.PREVIEW_HOSTNAME, undefined);

    const domains = {
      ...SETTINGS,
      builderDomain: 'build.example.com',
      previewDomain: 'example-preview.dev',
    };
    const web = selfHostConfig('web', base.web, domains);
    assert.deepEqual(web.routes, [
      { pattern: 'build.example.com', custom_domain: true },
    ]);
    assert.equal(web.vars.PUBLISH_HOSTNAME, 'example-preview.dev');
    assert.equal(web.vars.VIBLD_REFERRAL_ORIGIN, 'https://build.example.com');
    const preview = selfHostConfig('preview', base.preview, domains);
    assert.deepEqual(preview.routes, [
      { pattern: '*.example-preview.dev/*', zone_name: 'example-preview.dev' },
    ]);
    assert.equal(preview.vars.PREVIEW_HOSTNAME, 'example-preview.dev');
    assert.equal(
      selfHostConfig('publish', base.publish, domains).vars.PUBLISH_HOSTNAME,
      'example-preview.dev',
    );
  });

  it("moves the rate limits to namespaces of their own, never vibld's", () => {
    // Codex review of internal PR 333: ids are account-wide, and defaulting to 1001
    // shared vibld's limits with a copy beside it.
    const web = selfHostConfig('web', base.web, SETTINGS);
    assert.deepEqual(
      web.ratelimits.map((r) => r.namespace_id),
      base.web.ratelimits.map((_, i) => String(5001 + i)),
    );
    const { rateLimitNamespaceBase: _, ...unset } = SETTINGS;
    assert.throws(() => selfHostConfig('web', base.web, unset), /not usable/);
    assert.throws(
      () =>
        selfHostConfig('web', base.web, {
          ...SETTINGS,
          rateLimitNamespaceBase: 1005,
        }),
      /one of vibld's own/,
    );
  });

  it('leaves publishing unavailable without a domain of its own', () => {
    // Codex review of internal PR 333: bound, it would publish under vibld-preview.dev.
    const bare = selfHostConfig('web', base.web, SETTINGS);
    assert.ok(!bare.services.some((b) => b.binding === 'PUBLISH'));
    const withDomain = selfHostConfig('web', base.web, {
      ...SETTINGS,
      previewDomain: 'example-preview.dev',
    });
    assert.deepEqual(
      withDomain.services.find((b) => b.binding === 'PUBLISH'),
      { binding: 'PUBLISH', service: 'acme-publish' },
    );
  });

  it('refuses settings that would name vibld or cannot work', () => {
    for (const bad of [
      { ...SETTINGS, prefix: 'vibld' },
      { ...SETTINGS, prefix: 'Acme' },
      { ...SETTINGS, d1DatabaseId: 'x' },
      { ...SETTINGS, clerkFrontendApiUrl: 'http://acme.clerk.accounts.dev' },
      { ...SETTINGS, provider: 'mistral' },
      { ...SETTINGS, builderDomain: 'https://build.example.com' },
    ]) {
      assert.throws(() => selfHostConfig('web', base.web, bad), /not usable/);
    }
  });
});
