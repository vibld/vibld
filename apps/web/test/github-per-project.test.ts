import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  handleGitHubBind,
  handleGitHubComplete,
  handleGitHubDisconnect,
  handleGitHubDisconnectAccount,
  handleGitHubPush,
  handleGitHubStatus,
} from '../worker/github-handlers.ts';
import { signState } from '../worker/github-connect.ts';
import { CREATE_REFUSED } from '../worker/github-create.ts';
import { GitHubStore } from '../worker/github-store.ts';
import { ProjectStore } from '../worker/project-store.ts';
import { InMemoryR2Bucket } from './fakes/memory-r2.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql, schemaSqlBetween } from './fakes/schema.ts';

/**
 * A repository per project, created or picked (docs/decisions.md, D72).
 *
 * The account used to be bound to one repository, so every project pushed
 * to the same place. These are the rules the change rests on: a binding is
 * looked up by project, disconnecting one project leaves the others alone,
 * disconnecting the account ends all of them, the old account-level row
 * moves onto the account's most recently worked-on project, and "Create a
 * new repository" either makes one the builder can push to or says plainly
 * why not, without losing the picker.
 */

const CHRIS = 'user_chris';
const OTHER = 'user_other';
const PRINCIPAL = { userId: CHRIS, policyIdentity: 'chris@example.com' };
const NOW = new Date('2026-09-29T12:00:00.000Z');

const CREDENTIALS = {
  clientId: 'Iv1.abc123',
  clientSecret: 'the-client-secret',
};

const PRIVATE_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs1', format: 'pem' })
  .toString();

function env(db: SqliteD1Database) {
  return {
    DB: db as unknown as D1Database,
    VIBLD_GITHUB_APP_ID: '123',
    VIBLD_GITHUB_PRIVATE_KEY: PRIVATE_KEY,
    VIBLD_GITHUB_CLIENT_ID: CREDENTIALS.clientId,
    VIBLD_GITHUB_CLIENT_SECRET: CREDENTIALS.clientSecret,
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function exec(db: SqliteD1Database, sql: string, ...values: unknown[]) {
  await db
    .prepare(sql)
    .bind(...values)
    .run();
}

async function project(
  db: SqliteD1Database,
  id: string,
  userId: string,
  name: string,
  updatedAt: string,
  archivedAt: string | null = null,
) {
  await exec(
    db,
    `INSERT INTO projects
       (id, user_id, name, archived_at, created_at, updated_at, last_opened_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5)`,
    id,
    userId,
    name,
    archivedAt,
    updatedAt,
  );
}

const GRANT = {
  userId: CHRIS,
  projectId: 'north-star',
  installationId: 42,
  owner: 'chris',
  repo: 'north-star',
  defaultBranch: 'main',
  grantedAt: '2026-09-20T00:00:00.000Z',
  grantedByEmail: 'chris@example.com',
  expiresAt: '2026-12-20T00:00:00.000Z',
};

describe('0039: moving each account binding onto a project', () => {
  /** The database as it stood before 0039, with the rows it has to move. */
  async function before() {
    const db = new SqliteD1Database(schemaSqlBetween('', '0039'));
    // Chris: three projects. North Star was built in most recently (its
    // build pointer moved, its own row did not); "Sketches" was renamed
    // later than North Star's row but built in long before; "Old" was
    // archived last of all, which moves its row, and must not win.
    await project(
      db,
      'north-star',
      CHRIS,
      'North Star',
      '2026-09-10T00:00:00Z',
    );
    await exec(
      db,
      `INSERT INTO generation_projects VALUES ('north-star', 'r9', ?1, ?2)`,
      '2026-09-01T00:00:00Z',
      '2026-09-28T00:00:00Z',
    );
    await project(db, 'sketches', CHRIS, 'Sketches', '2026-09-20T00:00:00Z');
    await project(
      db,
      'old',
      CHRIS,
      'Old',
      '2026-09-29T00:00:00Z',
      '2026-09-29T00:00:00Z',
    );
    await exec(
      db,
      `INSERT INTO github_bindings VALUES
         (?1, 42, 'chris', 'north-star', 'main', '2026-09-20T00:00:00Z',
          'chris@example.com', '2026-12-20T00:00:00Z', NULL)`,
      CHRIS,
    );
    await exec(
      db,
      `INSERT INTO github_pushes
         (user_id, owner, repo, revision, base_sha, branch, started_at,
          pull_request_url)
       VALUES (?1, 'chris', 'north-star', 'r9', 'b', 'vibld/r9', ?2, ?3),
              (?1, 'chris', 'retired', 'r1', 'b', 'vibld/r1', ?2, ?4)`,
      CHRIS,
      '2026-09-21T00:00:00Z',
      'https://github.com/chris/north-star/pull/3',
      'https://github.com/chris/retired/pull/1',
    );
    // Another account whose grant was revoked before the move, and one
    // with a binding and no project at all.
    await project(db, 'theirs', OTHER, 'Theirs', '2026-09-15T00:00:00Z');
    await exec(
      db,
      `INSERT INTO github_bindings VALUES
         (?1, 77, 'acme', 'site', 'main', '2026-09-01T00:00:00Z',
          'other@example.com', '2026-12-01T00:00:00Z',
          '2026-09-05T00:00:00Z')`,
      OTHER,
    );
    await exec(
      db,
      `INSERT INTO github_bindings VALUES
         ('user_no_projects', 88, 'solo', 'repo', 'main',
          '2026-09-01T00:00:00Z', 'solo@example.com',
          '2026-12-01T00:00:00Z', NULL)`,
    );
    db.exec(schemaSqlBetween('0039', '￿'));
    return { db, store: new GitHubStore(db as unknown as D1Database) };
  }

  it('puts the binding on the most recently worked-on project', async () => {
    const { store } = await before();
    const moved = await store.usableBinding(CHRIS, 'north-star', NOW);
    assert.equal(moved.usable, true);
    if (moved.usable) {
      assert.equal(moved.binding.owner, 'chris');
      assert.equal(moved.binding.repo, 'north-star');
      assert.equal(moved.binding.installationId, 42);
      // The grant is the same grant, not a fresh one.
      assert.equal(moved.binding.grantedAt, '2026-09-20T00:00:00Z');
      assert.equal(moved.binding.expiresAt, '2026-12-20T00:00:00Z');
    }
  });

  it('leaves every other project unbound, archived or not', async () => {
    const { store } = await before();
    for (const other of ['sketches', 'old']) {
      const state = await store.usableBinding(CHRIS, other, NOW);
      assert.equal(state.usable, false);
      if (!state.usable) assert.equal(state.reason, 'none');
    }
  });

  it('keeps the account connected, as the binding was', async () => {
    const { store } = await before();
    const connection = await store.connection(CHRIS);
    assert.equal(connection?.revokedAt, null);
    assert.equal(connection?.grantedByEmail, 'chris@example.com');
    // Never recorded before 0039, so not invented by it.
    assert.equal(connection?.login, null);
  });

  it('moves a revoked grant as revoked, account and project both', async () => {
    const { store } = await before();
    const state = await store.usableBinding(OTHER, 'theirs', NOW);
    assert.equal(state.usable, false);
    if (!state.usable) assert.equal(state.reason, 'revoked');
    assert.equal(
      (await store.connection(OTHER))?.revokedAt,
      '2026-09-05T00:00:00Z',
    );
  });

  it('keeps the connection of an account with nowhere to put the binding', async () => {
    const { db, store } = await before();
    assert.ok(await store.connection('user_no_projects'));
    const rows = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM github_project_bindings WHERE user_id = ?1`,
      )
      .bind('user_no_projects')
      .first<{ n: number }>();
    assert.equal(rows?.n, 0);
  });

  it('keeps reporting the last pull request of the repository that moved', async () => {
    const { store } = await before();
    const last = await store.lastPullRequest(CHRIS, 'north-star');
    assert.equal(
      last?.pullRequestUrl,
      'https://github.com/chris/north-star/pull/3',
    );
    // A push to a repository the account had already moved away from is
    // nobody's news, and stays unattributed.
    const retired = await store.push({
      userId: CHRIS,
      owner: 'chris',
      repo: 'retired',
      revision: 'r1',
    });
    assert.equal(retired?.projectId, null);
  });

  it('leaves the old table in place', async () => {
    // Additive: dropping it is a later migration's business.
    const { db } = await before();
    const rows = await db
      .prepare(`SELECT COUNT(*) AS n FROM github_bindings`)
      .first<{ n: number }>();
    assert.equal(rows?.n, 3);
  });
});

/** Chris with two projects, only one of which has a repository. */
async function twoProjects() {
  const db = new SqliteD1Database(schemaSql());
  await project(db, 'north-star', CHRIS, 'North Star', '2026-09-28T00:00:00Z');
  await project(db, 'sketches', CHRIS, 'Sketches', '2026-09-27T00:00:00Z');
  await project(db, 'theirs', OTHER, 'Theirs', '2026-09-27T00:00:00Z');
  const store = new GitHubStore(db as unknown as D1Database);
  await store.connect({
    userId: CHRIS,
    login: 'chris',
    installationId: 42,
    connectedAt: '2026-09-20T00:00:00.000Z',
    grantedByEmail: 'chris@example.com',
  });
  await store.bind(GRANT);
  return { db, store };
}

function statusRequest(project?: string): Request {
  return new Request(
    `https://app.vibld.com/api/github/status${project ? `?project=${project}` : ''}`,
  );
}

describe('the routes, per project', () => {
  it('reports each project’s own repository, and the account beside it', async () => {
    const { db } = await twoProjects();
    const bound = (await (
      await handleGitHubStatus(
        statusRequest('north-star'),
        env(db),
        PRINCIPAL,
        NOW,
      )
    ).json()) as Record<string, unknown>;
    assert.equal(bound.connected, true);
    assert.equal(bound.repo, 'north-star');
    assert.equal(bound.projectId, 'north-star');
    assert.deepEqual(bound.account, { connected: true, login: 'chris' });

    const unbound = (await (
      await handleGitHubStatus(
        statusRequest('sketches'),
        env(db),
        PRINCIPAL,
        NOW,
      )
    ).json()) as Record<string, unknown>;
    assert.equal(unbound.connected, false);
    assert.equal(unbound.reason, 'none');
    assert.deepEqual(unbound.account, { connected: true, login: 'chris' });
  });

  it('refuses a status for something that is not a project id', async () => {
    const { db } = await twoProjects();
    const response = await handleGitHubStatus(
      statusRequest('..%2Fetc'),
      env(db),
      PRINCIPAL,
      NOW,
    );
    assert.equal(response.status, 400);
  });

  it('asks a project with no repository to choose one before pushing', async () => {
    const { db } = await twoProjects();
    const response = await handleGitHubPush(
      new Request('https://app.vibld.com/api/github/push', {
        method: 'POST',
        body: JSON.stringify({
          projectId: 'sketches',
          files: [{ path: 'index.html', content: '<h1>hi</h1>' }],
          revision: 'r1',
          owner: 'chris',
          repo: 'north-star',
        }),
      }),
      env(db),
      PRINCIPAL,
      (async () => json({}, 500)) as unknown as typeof fetch,
      NOW,
    );
    // North Star's repository is not Sketches' repository.
    assert.equal(response.status, 409);
    const body = (await response.json()) as { reconnect?: boolean };
    assert.equal(body.reconnect, true);
  });

  it('tells a page that names no project to reload, rather than guessing one', async () => {
    const { db } = await twoProjects();
    const response = await handleGitHubPush(
      new Request('https://app.vibld.com/api/github/push', {
        method: 'POST',
        body: JSON.stringify({
          files: [{ path: 'index.html', content: '<h1>hi</h1>' }],
          revision: 'r1',
          owner: 'chris',
          repo: 'north-star',
        }),
      }),
      env(db),
      PRINCIPAL,
      (async () => json({}, 500)) as unknown as typeof fetch,
      NOW,
    );
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /Reload/);
  });

  it('will not bind a repository to somebody else’s project', async () => {
    const { db, store } = await twoProjects();
    const offer = (await (await complete(db, fakeGitHub().doFetch)).json()) as {
      ticket: string;
    };
    const response = await handleGitHubBind(
      new Request('https://app.vibld.com/api/github/bind', {
        method: 'POST',
        body: JSON.stringify({
          ticket: offer.ticket,
          projectId: 'theirs',
          owner: 'chris',
          repo: 'north-star',
        }),
      }),
      env(db),
      PRINCIPAL,
      NOW,
    );
    assert.equal(response.status, 404);
    assert.equal(await store.binding(OTHER, 'theirs'), null);
    assert.equal(await store.binding(CHRIS, 'theirs'), null);
  });

  it('binds a second project to its own repository, leaving the first', async () => {
    const { db, store } = await twoProjects();
    const offer = (await (await complete(db, fakeGitHub().doFetch)).json()) as {
      ticket: string;
    };
    const response = await handleGitHubBind(
      new Request('https://app.vibld.com/api/github/bind', {
        method: 'POST',
        body: JSON.stringify({
          ticket: offer.ticket,
          projectId: 'sketches',
          owner: 'chris',
          repo: 'sketches',
        }),
      }),
      env(db),
      PRINCIPAL,
      NOW,
    );
    assert.equal(response.status, 200);
    assert.equal((await store.binding(CHRIS, 'sketches'))?.repo, 'sketches');
    assert.equal(
      (await store.binding(CHRIS, 'north-star'))?.repo,
      'north-star',
    );
  });

  it('disconnects one project and no other', async () => {
    const { db, store } = await twoProjects();
    // Sketches pushes to the same repository, which is the case a looser
    // disconnect would take down with North Star.
    await store.bind({ ...GRANT, projectId: 'sketches' });

    const response = await handleGitHubDisconnect(
      new Request('https://app.vibld.com/api/github/disconnect', {
        method: 'POST',
        body: JSON.stringify({
          projectId: 'north-star',
          owner: 'chris',
          repo: 'north-star',
        }),
      }),
      env(db),
      PRINCIPAL,
      NOW,
    );
    assert.equal(response.status, 200);
    assert.equal(
      (await store.usableBinding(CHRIS, 'north-star', NOW)).usable,
      false,
    );
    assert.equal(
      (await store.usableBinding(CHRIS, 'sketches', NOW)).usable,
      true,
    );
    // And the account is still connected.
    assert.equal((await store.connection(CHRIS))?.revokedAt, null);
  });

  it('disconnects every project when GitHub is disconnected from the account', async () => {
    const { db, store } = await twoProjects();
    await store.bind({ ...GRANT, projectId: 'sketches', repo: 'sketches' });

    const response = await handleGitHubDisconnectAccount(
      new Request('https://app.vibld.com/api/github/disconnect-account', {
        method: 'POST',
        body: '{}',
      }),
      env(db),
      PRINCIPAL,
      NOW,
    );
    assert.equal(response.status, 200);
    for (const each of ['north-star', 'sketches']) {
      const state = await store.usableBinding(CHRIS, each, NOW);
      assert.equal(state.usable, false);
      if (!state.usable) assert.equal(state.reason, 'revoked');
    }
    const status = (await (
      await handleGitHubStatus(
        statusRequest('north-star'),
        env(db),
        PRINCIPAL,
        NOW,
      )
    ).json()) as { account: { connected: boolean } };
    assert.equal(status.account.connected, false);
  });

  it('drops a deleted project’s binding with the project', async () => {
    const { db, store } = await twoProjects();
    await new ProjectStore(
      db as unknown as D1Database,
      new InMemoryR2Bucket(),
    ).remove('north-star');
    assert.equal(await store.binding(CHRIS, 'north-star'), null);
  });
});

/**
 * A GitHub where Chris has the App on his own account (installation 42),
 * with one repository already, and can create more.
 */
function fakeGitHub(
  options: {
    create?: (body: Record<string, unknown>) => Response;
    /** Names already taken on Chris's account, for the suggestion. */
    taken?: string[];
    /** What minting a token for the new repository answers. */
    mint?: () => Response;
    installations?: { id: number; account: { login: string } }[];
  } = {},
) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const doFetch = (async (url: string, init?: RequestInit) => {
    const target = new URL(url);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: target.pathname, body });
    if (target.pathname === '/login/oauth/access_token') {
      return json({ access_token: 'ghu_user' });
    }
    if (target.pathname === '/user/installations') {
      return json({
        installations: options.installations ?? [
          { id: 42, account: { login: 'chris' } },
        ],
      });
    }
    if (target.pathname === '/user/installations/42/repositories') {
      return json({
        repositories: ['north-star', 'sketches'].map((name) => ({
          name,
          default_branch: 'main',
          owner: { login: 'chris' },
          permissions: { push: true },
        })),
      });
    }
    if (target.pathname.startsWith('/user/installations/')) {
      return json({ repositories: [] });
    }
    if (target.pathname === '/user') return json({ login: 'chris' });
    if (method === 'POST' && target.pathname === '/user/repos') {
      return options.create
        ? options.create(body)
        : json(
            {
              name: body.name,
              default_branch: 'main',
              owner: { login: 'chris' },
              private: body.private,
            },
            201,
          );
    }
    const repo = target.pathname.match(/^\/repos\/chris\/([^/]+)$/);
    if (method === 'GET' && repo) {
      return (options.taken ?? []).includes(decodeURIComponent(repo[1]!))
        ? json({ name: repo[1] })
        : json({ message: 'Not Found' }, 404);
    }
    if (target.pathname.endsWith('/access_tokens')) {
      return options.mint
        ? options.mint()
        : json({ token: 'ghs_x', expires_at: '2026-09-29T13:00:00Z' }, 201);
    }
    return json({ message: 'unexpected' }, 500);
  }) as unknown as typeof fetch;
  return { doFetch, calls };
}

async function complete(
  db: SqliteD1Database,
  doFetch: typeof fetch,
  create?: { name: string; private?: boolean },
) {
  const state = await signState(CREDENTIALS, CHRIS, NOW.getTime());
  return handleGitHubComplete(
    new Request('https://app.vibld.com/api/github/complete', {
      method: 'POST',
      body: JSON.stringify({
        code: 'the-code',
        state,
        ...(create ? { create } : {}),
      }),
    }),
    env(db),
    PRINCIPAL,
    doFetch,
    NOW,
  );
}

interface Completed {
  repositories: { owner: string; repo: string; installationId: number }[];
  ticket: string;
  login?: string;
  created?: {
    owner: string;
    repo: string;
    defaultBranch: string;
    installationId: number;
  };
  createProblem?: { error: string; suggestion?: string; install?: boolean };
}

describe('"Create a new repository"', () => {
  it('creates it private on the account, and offers it for binding', async () => {
    const { db, store } = await twoProjects();
    const github = fakeGitHub();
    const response = await complete(db, github.doFetch, { name: 'sketches-2' });
    assert.equal(response.status, 200);
    const body = (await response.json()) as Completed;

    const made = github.calls.find(
      (call) => call.method === 'POST' && call.path === '/user/repos',
    );
    // Private by default, and with a first commit to push onto.
    assert.deepEqual(made?.body, {
      name: 'sketches-2',
      private: true,
      auto_init: true,
    });
    assert.deepEqual(body.created, {
      owner: 'chris',
      repo: 'sketches-2',
      defaultBranch: 'main',
      installationId: 42,
    });
    assert.ok(
      body.repositories.some((each) => each.repo === 'sketches-2'),
      'the created repository is not in the signed offer',
    );
    assert.equal(body.createProblem, undefined);
    // The App was asked whether it can push there before anyone is told
    // it is ready.
    assert.ok(
      github.calls.some((call) => call.path.endsWith('/access_tokens')),
    );

    // And the ticket lets the builder bind it to the project.
    const bound = await handleGitHubBind(
      new Request('https://app.vibld.com/api/github/bind', {
        method: 'POST',
        body: JSON.stringify({
          ticket: body.ticket,
          projectId: 'sketches',
          owner: 'chris',
          repo: 'sketches-2',
        }),
      }),
      env(db),
      PRINCIPAL,
      NOW,
    );
    assert.equal(bound.status, 200);
    assert.equal((await store.binding(CHRIS, 'sketches'))?.repo, 'sketches-2');
  });

  it('makes it public when asked', async () => {
    const { db } = await twoProjects();
    const github = fakeGitHub();
    await complete(db, github.doFetch, { name: 'open', private: false });
    const made = github.calls.find((call) => call.path === '/user/repos');
    assert.equal((made?.body as { private: boolean }).private, false);
  });

  it('records who signed in, for the account half of the connection', async () => {
    const db = new SqliteD1Database(schemaSql());
    const store = new GitHubStore(db as unknown as D1Database);
    await complete(db, fakeGitHub().doFetch);
    const connection = await store.connection(CHRIS);
    assert.equal(connection?.login, 'chris');
    assert.equal(connection?.installationId, 42);
    assert.equal(connection?.revokedAt, null);
  });

  it('says why when GitHub refuses the App, and still offers the picker', async () => {
    // What happens until the App holds Administration: write.
    const { db } = await twoProjects();
    const github = fakeGitHub({
      create: () =>
        json({ message: 'Resource not accessible by integration' }, 403),
    });
    const response = await complete(db, github.doFetch, { name: 'new-one' });
    assert.equal(response.status, 200);
    const body = (await response.json()) as Completed;
    assert.equal(body.created, undefined);
    assert.equal(body.createProblem?.error, CREATE_REFUSED);
    assert.match(body.createProblem?.error ?? '', /Use an existing repository/);
    // The other half of the choice is still there.
    assert.deepEqual(
      body.repositories.map((each) => each.repo),
      ['north-star', 'sketches'],
    );
  });

  it('offers a free name in place of a taken one', async () => {
    const { db } = await twoProjects();
    const github = fakeGitHub({
      create: () =>
        json(
          {
            message: 'Repository creation failed.',
            errors: [
              {
                resource: 'Repository',
                code: 'custom',
                field: 'name',
                message: 'name already exists on this account',
              },
            ],
          },
          422,
        ),
      taken: ['north-star', 'north-star-2'],
    });
    const body = (await (
      await complete(db, github.doFetch, { name: 'north-star' })
    ).json()) as Completed;
    assert.equal(body.created, undefined);
    assert.equal(body.createProblem?.suggestion, 'north-star-3');
    assert.match(body.createProblem?.error ?? '', /already a repository/);
  });

  it('says so when the App cannot reach the repository it just made', async () => {
    // An installation limited to selected repositories does not gain one
    // because the App created it, so it exists and every push would fail.
    const { db } = await twoProjects();
    const github = fakeGitHub({
      mint: () => json({ message: 'Unprocessable' }, 422),
    });
    const body = (await (
      await complete(db, github.doFetch, { name: 'fresh' })
    ).json()) as Completed;
    assert.equal(body.created, undefined);
    assert.match(
      body.createProblem?.error ?? '',
      /https:\/\/github\.com\/settings\/installations\/42/,
    );
  });

  it('asks for the App on the person’s own account before creating there', async () => {
    const { db } = await twoProjects();
    const github = fakeGitHub({
      installations: [{ id: 77, account: { login: 'acme' } }],
    });
    const body = (await (
      await complete(db, github.doFetch, { name: 'fresh' })
    ).json()) as Completed;
    assert.equal(body.createProblem?.install, true);
    assert.equal(
      github.calls.some((call) => call.path === '/user/repos'),
      false,
      'it tried to create a repository with nowhere to push it from',
    );
  });

  it('refuses a name GitHub would rewrite, without asking GitHub', async () => {
    const { db } = await twoProjects();
    const github = fakeGitHub();
    const body = (await (
      await complete(db, github.doFetch, { name: 'my site!' })
    ).json()) as Completed;
    assert.match(body.createProblem?.error ?? '', /letters, numbers/);
    assert.equal(
      github.calls.some((call) => call.path === '/user/repos'),
      false,
    );
  });
});
