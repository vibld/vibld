#!/usr/bin/env node
/**
 * Turn a generated project on disk into a project on somebody's account.
 *
 * The input is the `generated-project` artifact a Try a generation run
 * uploads: the files the model wrote, plus whatever the portability build
 * left beside them (node_modules, the build output, npm's lockfile and the
 * build log). Only the model's files are kept.
 *
 * Writes three things into the output directory, which the Import a
 * generated project workflow then hands to wrangler:
 *
 * - `snapshot.json`: the snapshot, in exactly the shape the generation store
 *   writes to `projects/{id}/snapshots/{revision}.json` (`generation-store.ts`);
 * - `import.sql`: the `projects` row and the `generation_projects` pointer;
 * - `import.env`: the new project's id, revision and R2 key, for later steps.
 *
 * Usage: node scripts/import-project.mjs <project dir> <out dir>
 * with IMPORT_OWNER (a Clerk user id) and IMPORT_NAME in the environment.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** What the portability build adds, and so what the model never wrote. */
const BUILD_LEFTOVERS = new Set([
  'node_modules',
  'dist',
  'build',
  'package-lock.json',
  'build.log',
]);

/** The same revision `GenerationMachine` gives a snapshot of these files. */
export function revisionFor(files) {
  const payload = JSON.stringify(files);
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `r${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Whether a path, relative to the project root, is one the model wrote. */
export function isGeneratedPath(path) {
  const top = path.split('/')[0];
  return !BUILD_LEFTOVERS.has(top);
}

export function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function isClerkUserId(value) {
  return /^user_[A-Za-z0-9]{10,64}$/.test(value);
}

/** The two rows, as one script D1 runs in order. */
export function importSql({ id, owner, name, revision, now }) {
  return [
    `INSERT INTO projects (id, user_id, name, created_at, updated_at, last_opened_at)`,
    `  VALUES (${[id, owner, name, now, now, now].map(sqlString).join(', ')});`,
    `INSERT INTO generation_projects (id, accepted_revision, created_at, updated_at)`,
    `  VALUES (${[id, revision, now, now].map(sqlString).join(', ')});`,
    '',
  ].join('\n');
}

async function walk(root, directory = root) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    const path = relative(root, full).split(sep).join('/');
    if (!isGeneratedPath(path)) continue;
    if (entry.isDirectory()) found.push(...(await walk(root, full)));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

export async function readProject(root) {
  const paths = (await walk(root)).sort();
  const files = [];
  for (const path of paths) {
    files.push({ path, content: await readFile(join(root, path), 'utf8') });
  }
  return files;
}

async function main() {
  const [root, out] = process.argv.slice(2);
  const owner = (process.env.IMPORT_OWNER ?? '').trim();
  const name = (process.env.IMPORT_NAME ?? '').trim();
  if (!root || !out) {
    throw new Error('Usage: import-project.mjs <project dir> <out dir>');
  }
  if (!isClerkUserId(owner)) {
    throw new Error('IMPORT_OWNER is not a Clerk user id.');
  }
  if (name.length === 0 || name.length > 120) {
    throw new Error('IMPORT_NAME must be 1 to 120 characters.');
  }
  const files = await readProject(root);
  if (!files.some((file) => file.path === 'package.json')) {
    throw new Error('No package.json: this is not a generated project.');
  }
  const id = randomUUID();
  const revision = revisionFor(files);
  const now = new Date().toISOString();
  await mkdir(out, { recursive: true });
  await writeFile(
    join(out, 'snapshot.json'),
    JSON.stringify({ revision, files }),
  );
  await writeFile(
    join(out, 'import.sql'),
    importSql({ id, owner, name, revision, now }),
  );
  await writeFile(
    join(out, 'import.env'),
    `PROJECT_ID=${id}\nREVISION=${revision}\nSNAPSHOT_KEY=projects/${id}/snapshots/${revision}.json\n`,
  );
  console.log(`${files.length} files, revision ${revision}, project ${id}`);
  for (const file of files) console.log(`  ${file.path}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
