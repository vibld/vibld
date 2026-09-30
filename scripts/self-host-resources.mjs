#!/usr/bin/env node
/**
 * Creates, and afterwards removes, the stored state and Workers of a
 * prefixed copy (docs/decisions.md, D115 and D117), for the Self-host check
 * workflow.
 *
 *   node scripts/self-host-resources.mjs create <prefix>
 *   node scripts/self-host-resources.mjs teardown <prefix>
 *
 * `create` finds or makes the D1 database and R2 bucket `<prefix>-control-plane`
 * and prints the database id (and writes `d1_database_id` to
 * $GITHUB_OUTPUT when it is set). `teardown` deletes the three Workers, the
 * sandbox's container application, the Workflow, the database and the
 * bucket, and treats anything already gone as done.
 *
 * Every name is derived from the prefix by scripts/self-host.mjs, which
 * refuses a prefix starting with "vibld", so neither command can reach
 * vibld's own deployment. Uses the Cloudflare API directly with
 * CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID: `wrangler delete` also
 * lists KV namespaces, which a token scoped to Workers, D1 and R2 cannot.
 */
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { namesFor } from './self-host.mjs';

const PREFIX = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/;

/** The names a prefix owns, or an error for one that could reach vibld's. */
export function resourcesFor(prefix) {
  if (!PREFIX.test(prefix ?? '') || prefix.startsWith('vibld')) {
    throw new Error(
      `"${prefix}" is not a usable prefix: lowercase letters, digits and hyphens, never starting with "vibld"`,
    );
  }
  const names = namesFor(prefix);
  return {
    workers: [names.web, names.preview, names.publish],
    // Wrangler names a container application `<worker>-<class>`.
    containerPrefix: `${names.preview}-`,
    workflow: names.workflow,
    database: names.database,
    bucket: names.bucket,
  };
}

function client() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) {
    throw new Error(
      'CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are both needed',
    );
  }
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
  return async (method, path, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, ...json };
  };
}

const gone = (r) =>
  r.status === 404 || (r.errors ?? []).some((e) => e.code === 10007);

function must(label, r) {
  if (r.success === false || r.status >= 400) {
    throw new Error(`${label}: ${JSON.stringify(r.errors ?? r.status)}`);
  }
  return r;
}

async function create(prefix) {
  const want = resourcesFor(prefix);
  const api = client();
  const found = must(
    'list databases',
    await api('GET', `/d1/database?name=${encodeURIComponent(want.database)}`),
  ).result.find((d) => d.name === want.database);
  const id =
    found?.uuid ??
    must(
      'create database',
      await api('POST', '/d1/database', { name: want.database }),
    ).result.uuid;
  console.log(`${found ? 'found' : 'created'} database ${want.database}`);

  const bucket = await api('GET', `/r2/buckets/${want.bucket}`);
  if (bucket.success) console.log(`found bucket ${want.bucket}`);
  else {
    must(
      'create bucket',
      await api('POST', '/r2/buckets', { name: want.bucket }),
    );
    console.log(`created bucket ${want.bucket}`);
  }

  console.log(id);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `d1_database_id=${id}\n`);
  }
}

export async function teardown(prefix) {
  const want = resourcesFor(prefix);
  const api = client();
  const failures = [];
  const step = async (label, run) => {
    try {
      const r = await run();
      console.log(
        `${label}: ${r === 'gone' ? 'already gone' : (r ?? 'deleted')}`,
      );
    } catch (error) {
      failures.push(`${label}: ${error.message}`);
    }
  };
  const del = async (label, path) => {
    const r = await api('DELETE', path);
    if (gone(r)) return 'gone';
    must(label, r);
  };

  for (const worker of want.workers) {
    await step(`Worker ${worker}`, () =>
      del(worker, `/workers/scripts/${worker}?force=true`),
    );
  }
  // A failed listing is a failure, never an empty list: read as "nothing
  // there", it would skip what it could not see and report success.
  await step('container applications', async () => {
    const apps = must(
      'list container applications',
      await api('GET', '/containers/applications'),
    ).result;
    for (const app of apps.filter((a) =>
      a.name.startsWith(want.containerPrefix),
    )) {
      await step(`container ${app.name}`, () =>
        del(app.name, `/containers/applications/${app.id}`),
      );
    }
    return 'listed';
  });
  await step(`Workflow ${want.workflow}`, () =>
    del(want.workflow, `/workflows/${want.workflow}`),
  );
  await step(`database ${want.database}`, async () => {
    const db = must(
      'list databases',
      await api(
        'GET',
        `/d1/database?name=${encodeURIComponent(want.database)}`,
      ),
    ).result.find((d) => d.name === want.database);
    return db ? del(want.database, `/d1/database/${db.uuid}`) : 'gone';
  });
  await step(`bucket ${want.bucket}`, () =>
    del(want.bucket, `/r2/buckets/${want.bucket}`),
  );

  if (failures.length > 0) {
    throw new Error(`Not everything was removed:\n- ${failures.join('\n- ')}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, prefix] = process.argv.slice(2);
  const run = { create, teardown }[command];
  if (!run) {
    console.error(
      'usage: node scripts/self-host-resources.mjs create|teardown <prefix>',
    );
    process.exit(2);
  }
  run(prefix).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
