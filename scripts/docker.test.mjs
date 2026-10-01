import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  PASSED,
  SHARED_SECRETS,
  devVars,
  settingsProblems,
  sharedSecrets,
  startPlan,
} from '../docker/start.mjs';
import { PORTS, dockerConfig } from './docker-config.mjs';
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
});
