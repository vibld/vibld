/**
 * Read a project back off disk as a snapshot, so a follow-up generation can
 * be given the project it is editing.
 *
 * This exists to make ADR-0009's decision checkable against a real model
 * rather than only against tests. Nothing in CI calls it; the plan CLI does,
 * when it is asked to iterate.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { ProjectSnapshot } from '@vibld/core';

/** Directories that are build output or dependencies, never project source. */
const SKIP = new Set(['node_modules', 'dist', '.git', '.turbo', 'build']);

async function walk(root: string, dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) paths.push(...(await walk(root, full)));
    else if (entry.isFile())
      paths.push(relative(root, full).split(sep).join('/'));
  }
  return paths.sort();
}

export async function readProject(
  directory: string,
  revision = 'r-local',
): Promise<ProjectSnapshot> {
  const root = resolve(directory);
  const paths = await walk(root, root);
  const files = await Promise.all(
    paths.map(async (path) => ({
      path,
      content: await readFile(join(root, path), 'utf8'),
    })),
  );
  return { revision, files };
}

export interface ProjectDiff {
  kept: string[];
  changed: string[];
  added: string[];
  removed: string[];
}

/**
 * What a follow-up generation did to the project it was given.
 *
 * `removed` is the number that matters. The generation machine replaces the
 * file set with whatever comes back, so a file the model left out is deleted
 * -- which is exactly what sending paths alone used to cause on every turn.
 */
export function diffProjects(
  before: ProjectSnapshot,
  after: { files: { path: string; content: string }[] },
): ProjectDiff {
  const beforeByPath = new Map(before.files.map((f) => [f.path, f.content]));
  const afterByPath = new Map(after.files.map((f) => [f.path, f.content]));
  const diff: ProjectDiff = { kept: [], changed: [], added: [], removed: [] };

  for (const [path, content] of afterByPath) {
    if (!beforeByPath.has(path)) diff.added.push(path);
    else if (beforeByPath.get(path) === content) diff.kept.push(path);
    else diff.changed.push(path);
  }
  for (const path of beforeByPath.keys()) {
    if (!afterByPath.has(path)) diff.removed.push(path);
  }
  return diff;
}
