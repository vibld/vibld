import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  PASSED,
  SHARED_SECRETS,
  builderPort,
  devVars,
  settingsProblems,
  sharedSecrets,
  startPlan,
} from '../docker/start.mjs';
import {
  PORTS,
  dockerConfig,
  sandboxOn,
  vpsDomains,
} from './docker-config.mjs';
import { APPS, VIBLD_OWN, parseJsonc } from './self-host.mjs';

/** vibld under docker compose, with no Cloudflare account (D126, D137). */

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
const configs = Object.fromEntries(
  APPS.map((app) => [app, dockerConfig(app, base[app])]),
);

describe('the Workers’ configuration under Docker', () => {
  it('names nothing of vibld’s deployment and nothing Cloudflare hosts', () => {
    for (const app of APPS) {
      const text = JSON.stringify(configs[app]);
      for (const own of VIBLD_OWN)
        assert.ok(!text.includes(own), `${app}: ${own}`);
      for (const key of ['routes', 'workers_dev', 'observability', 'limits']) {
        assert.equal(configs[app][key], undefined, `${app}: ${key}`);
      }
    }
  });

  it('listens on each Worker’s own port, on every interface', () => {
    for (const app of APPS) {
      assert.deepEqual(configs[app].dev, { ip: '0.0.0.0', port: PORTS[app] });
    }
    assert.equal(new Set(Object.values(PORTS)).size, 3);
  });

  it('leaves the provider to .env, so a copy with only a local model uses it', () => {
    assert.equal(configs.web.vars.VIBLD_PROVIDER, undefined);
  });

  it('serves previews and published sites under localhost', () => {
    assert.equal(configs.preview.vars.PREVIEW_HOSTNAME, 'localhost:8788');
    assert.equal(configs.web.vars.PUBLISH_HOSTNAME, 'localhost:8789');
    assert.equal(configs.publish.vars.PUBLISH_HOSTNAME, 'localhost:8789');
  });

  it('keeps every binding, with the services renamed alike', () => {
    for (const app of APPS) {
      assert.equal(
        configs[app].d1_databases.length,
        base[app].d1_databases.length,
      );
      assert.equal(
        configs[app].d1_databases[0].database_name,
        'local-control-plane',
      );
    }
    // The builder keeps publishing: a docker copy has a host for it.
    assert.deepEqual(configs.web.services.map((s) => s.service).sort(), [
      'local-preview',
      'local-publish',
    ]);
    assert.equal(configs.web.workflows.length, base.web.workflows.length);
  });

  it('builds the preview sandbox from its own Dockerfile, without a cloud size', () => {
    const [sandbox] = configs.preview.containers;
    assert.equal(sandbox.image, './Dockerfile');
    assert.equal(sandbox.instance_type, undefined);
    // Left as the fleet's ceiling expects it (apps/preview capacity.ts).
    assert.equal(
      sandbox.max_instances,
      base.preview.containers[0].max_instances,
    );
  });
});

describe('starting vibld in its container', () => {
  it('makes the shared secrets once and keeps them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibld-docker-'));
    let made = 0;
    const make = () => `secret-${(made += 1)}`;
    const first = sharedSecrets(dir, make);
    assert.deepEqual(
      Object.keys(first).sort(),
      Object.keys(SHARED_SECRETS).sort(),
    );
    const again = sharedSecrets(dir, make);
    assert.deepEqual(again, first);
    assert.equal(made, Object.keys(SHARED_SECRETS).length);
    // A secret missing from the file is made; the others are left alone.
    const kept = JSON.parse(readFileSync(join(dir, 'secrets.json'), 'utf8'));
    delete kept.PUBLISH_INTERNAL_SECRET;
    writeFileSync(join(dir, 'secrets.json'), JSON.stringify(kept));
    const healed = sharedSecrets(dir, make);
    assert.equal(healed.PREVIEW_INTERNAL_SECRET, first.PREVIEW_INTERNAL_SECRET);
    assert.equal(
      healed.VIBLD_KEY_ENCRYPTION_KEY,
      first.VIBLD_KEY_ENCRYPTION_KEY,
    );
    assert.notEqual(
      healed.PUBLISH_INTERNAL_SECRET,
      first.PUBLISH_INTERNAL_SECRET,
    );
  });

  it('gives each Worker only its own settings and secrets', () => {
    const secrets = {
      PREVIEW_INTERNAL_SECRET: 'p',
      PUBLISH_INTERNAL_SECRET: 'q',
      PREVIEW_SHARE_SECRET: 's',
      VIBLD_KEY_ENCRYPTION_KEY: 'k',
    };
    const env = {
      VIBLD_OWNER_PASSWORD: 'correct "horse" battery',
      OPENAI_API_KEY: 'sk-1',
      VIBLD_MODEL: '',
      UNRELATED: 'x',
    };
    const web = devVars('web', env, secrets);
    assert.match(web, /^VIBLD_OWNER_PASSWORD="correct \\"horse\\" battery"$/m);
    assert.match(web, /^OPENAI_API_KEY="sk-1"$/m);
    assert.match(web, /^VIBLD_AUTH="owner"$/m);
    assert.match(web, /^VIBLD_KEY_ENCRYPTION_KEY="k"$/m);
    assert.doesNotMatch(web, /VIBLD_MODEL=|UNRELATED/);
    const preview = devVars('preview', env, secrets);
    assert.equal(
      preview,
      'PREVIEW_INTERNAL_SECRET="p"\nPUBLISH_INTERNAL_SECRET="q"\nPREVIEW_SHARE_SECRET="s"\n',
    );
    assert.equal(
      devVars('publish', env, secrets),
      'PUBLISH_INTERNAL_SECRET="q"\n',
    );
    assert.deepEqual(Object.keys(PASSED).sort(), [...APPS].sort());
  });

  it('hands the builder a GitHub App key on one line', () => {
    // A .pem is several lines. `.dev.vars` is one setting a line, and
    // wrangler turns \n back into a line break inside double quotes.
    const web = devVars(
      'web',
      {
        VIBLD_GITHUB_APP_ID: '123',
        VIBLD_GITHUB_PRIVATE_KEY:
          '-----BEGIN RSA PRIVATE KEY-----\nAAAA\nBBBB\n-----END RSA PRIVATE KEY-----\n',
        VIBLD_GITHUB_CLIENT_ID: 'Iv1.x',
        VIBLD_GITHUB_CLIENT_SECRET: 'c',
      },
      {},
    );
    assert.match(web, /^VIBLD_GITHUB_APP_ID="123"$/m);
    assert.match(
      web,
      /^VIBLD_GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\\nAAAA\\nBBBB\\n-----END RSA PRIVATE KEY-----\\n"$/m,
    );
    assert.match(web, /^VIBLD_GITHUB_CLIENT_ID="Iv1.x"$/m);
    assert.match(web, /^VIBLD_GITHUB_CLIENT_SECRET="c"$/m);
  });

  it('refuses to start without a password, and says when there is no key', () => {
    assert.equal(settingsProblems({}).length, 2);
    assert.match(settingsProblems({})[0], /VIBLD_OWNER_PASSWORD/);
    assert.deepEqual(
      settingsProblems({
        VIBLD_OWNER_PASSWORD: 'twelve chars',
        DEEPSEEK_API_KEY: 'd',
      }),
      [],
    );
    assert.equal(
      settingsProblems({ VIBLD_OWNER_PASSWORD: 'short', OPENAI_API_KEY: 'o' })
        .length,
      1,
    );
  });

  it('takes a model on the owner’s own machine in place of a key (D124)', () => {
    const local = {
      VIBLD_OWNER_PASSWORD: 'twelve chars',
      VIBLD_LOCAL_BASE_URL: 'http://localhost:11434/v1',
      VIBLD_LOCAL_MODEL: 'qwen3-coder:30b',
    };
    assert.deepEqual(settingsProblems(local), []);
    // An address with no model is no model, and a blank is no model either.
    for (const blank of ['', '  ']) {
      assert.equal(
        settingsProblems({ ...local, VIBLD_LOCAL_MODEL: blank }).length,
        1,
      );
      assert.equal(
        settingsProblems({ ...local, VIBLD_LOCAL_BASE_URL: blank }).length,
        1,
      );
    }
    const web = devVars('web', local, {
      PREVIEW_INTERNAL_SECRET: 'p',
      PUBLISH_INTERNAL_SECRET: 'q',
      PREVIEW_SHARE_SECRET: 's',
      VIBLD_KEY_ENCRYPTION_KEY: 'k',
    });
    assert.match(web, /^VIBLD_LOCAL_BASE_URL="http:\/\/localhost:11434\/v1"$/m);
    assert.match(web, /^VIBLD_LOCAL_MODEL="qwen3-coder:30b"$/m);
  });

  it('migrates first, then runs the three Workers on their ports and one state', () => {
    const plan = startPlan('/data', 'wrangler');
    assert.deepEqual(plan.migrate.slice(0, 6), [
      'wrangler',
      'd1',
      'migrations',
      'apply',
      'local-control-plane',
      '--local',
    ]);
    assert.ok(plan.migrate.includes('/data/state'));
    assert.deepEqual(
      plan.workers.map((w) => [w.app, w.port]),
      [
        ['publish', 8789],
        ['preview', 8788],
        ['web', 8787],
      ],
    );
    const inspectors = new Set();
    for (const { command } of plan.workers) {
      assert.equal(command[command.indexOf('--persist-to') + 1], '/data/state');
      inspectors.add(command[command.indexOf('--inspector-port') + 1]);
    }
    assert.equal(inspectors.size, 3);
  });

  it('runs the builder alone on the host’s port with the sandbox off (D141)', () => {
    assert.equal(sandboxOn({}), true);
    assert.equal(sandboxOn({ VIBLD_SANDBOX: ' OFF ' }), false);
    assert.equal(builderPort({ PORT: '10000' }), PORTS.web);
    assert.equal(builderPort({ VIBLD_SANDBOX: 'off', PORT: '10000' }), 10000);
    assert.equal(builderPort({ VIBLD_SANDBOX: 'off' }), PORTS.web);
    const plan = startPlan('/data', 'wrangler', {
      sandbox: false,
      port: 10000,
    });
    assert.deepEqual(
      plan.workers.map((w) => [w.app, w.port]),
      [['web', 10000]],
    );
    const { command } = plan.workers[0];
    assert.equal(command[command.indexOf('--port') + 1], '10000');

    const web = dockerConfig('web', base.web, { sandbox: false });
    assert.deepEqual(
      web.services.filter((b) => ['PREVIEW', 'PUBLISH'].includes(b.binding)),
      [],
    );
    assert.equal(web.vars.VIBLD_PREVIEW, 'browser');
    assert.equal(web.vars.PUBLISH_HOSTNAME, undefined);
    assert.ok(configs.web.services.some((b) => b.binding === 'PREVIEW'));
    assert.equal(configs.web.vars.VIBLD_PREVIEW, undefined);
  });

  it('answers on two domains of its own behind the proxy on a server (D141)', () => {
    assert.equal(vpsDomains({}), null);
    const domains = vpsDomains({
      VIBLD_DOMAIN: ' Build.Example.com ',
      VIBLD_PREVIEW_DOMAIN: 'example-preview.dev',
    });
    assert.deepEqual(domains, {
      builder: 'build.example.com',
      preview: 'example-preview.dev',
    });
    // Both or neither, bare host names, and previews never under the
    // builder's domain or the other way round (L8).
    for (const env of [
      { VIBLD_DOMAIN: 'build.example.com' },
      { VIBLD_PREVIEW_DOMAIN: 'example-preview.dev' },
      {
        VIBLD_DOMAIN: 'https://build.example.com',
        VIBLD_PREVIEW_DOMAIN: 'p.dev',
      },
      {
        VIBLD_DOMAIN: 'example.com',
        VIBLD_PREVIEW_DOMAIN: 'preview.example.com',
      },
      {
        VIBLD_DOMAIN: 'build.example.com',
        VIBLD_PREVIEW_DOMAIN: 'example.com',
      },
      { VIBLD_DOMAIN: 'example.com', VIBLD_PREVIEW_DOMAIN: 'example.com' },
      // Beside it: either can set cookies for example.com.
      {
        VIBLD_DOMAIN: 'build.example.com',
        VIBLD_PREVIEW_DOMAIN: 'preview.example.com',
      },
      {
        VIBLD_DOMAIN: 'build.example.co.uk',
        VIBLD_PREVIEW_DOMAIN: 'p.example.co.uk',
      },
      // Short country and generic top-level domains are no suffix of two.
      { VIBLD_DOMAIN: 'build.foo.de', VIBLD_PREVIEW_DOMAIN: 'preview.foo.de' },
      { VIBLD_DOMAIN: 'build.foo.io', VIBLD_PREVIEW_DOMAIN: 'preview.foo.io' },
      { VIBLD_DOMAIN: 'a.foo.dev', VIBLD_PREVIEW_DOMAIN: 'b.foo.dev' },
    ]) {
      assert.throws(() => vpsDomains(env), JSON.stringify(env));
    }

    // Different registered domains, a country's second level included.
    assert.ok(
      vpsDomains({
        VIBLD_DOMAIN: 'build.example.co.uk',
        VIBLD_PREVIEW_DOMAIN: 'example-preview.co.uk',
      }),
    );
    const on = Object.fromEntries(
      APPS.map((app) => [app, dockerConfig(app, base[app], { domains })]),
    );
    for (const app of APPS) {
      // Only the proxy reaches the Workers.
      assert.deepEqual(
        { ip: on[app].dev.ip, port: on[app].dev.port },
        { ip: '127.0.0.1', port: PORTS[app] },
      );
    }
    // The builder takes itself to be the https address the browser uses, so
    // its origin checks pass behind a proxy that ends TLS.
    assert.equal(on.web.dev.host, 'build.example.com');
    assert.equal(on.web.dev.upstream_protocol, 'https');
    // The proxy names the client; a client-sent CF-Connecting-IP does not.
    assert.equal(on.web.vars.VIBLD_CLIENT_IP_HEADER, 'X-Real-Ip');
    assert.equal(configs.web.vars.VIBLD_CLIENT_IP_HEADER, undefined);
    // Previews keep the host they were asked for: it says which preview.
    assert.equal(on.preview.dev.host, undefined);
    assert.equal(on.preview.vars.PREVIEW_HOSTNAME, 'example-preview.dev');
    assert.equal(on.web.vars.PUBLISH_HOSTNAME, 'example-preview.dev');
    assert.equal(on.publish.vars.PUBLISH_HOSTNAME, 'example-preview.dev');
    assert.equal(configs.web.dev.host, undefined);
    // `wrangler dev` is told the address on its command line too, which
    // wins over the config.
    for (const { command } of startPlan('/data', 'wrangler', {
      ip: '127.0.0.1',
    }).workers) {
      assert.equal(command[command.indexOf('--ip') + 1], '127.0.0.1');
    }
    for (const { command } of startPlan('/data', 'wrangler').workers) {
      assert.equal(command[command.indexOf('--ip') + 1], '0.0.0.0');
    }
  });
});
