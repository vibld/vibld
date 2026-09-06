import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const roots = ['apps', 'packages', 'examples'];
const requiredTasks = ['lint', 'typecheck', 'test', 'build'];

/** @param {string} directory */
export function checkWorkspaces(directory) {
  let count = 0;
  for (const root of roots) {
    for (const entry of readdirSync(join(directory, root), {
      withFileTypes: true,
    })) {
      if (entry.name === 'README.md') continue;
      const location = join(root, entry.name);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error(
          `${location}: place workspace files in a package directory`,
        );
      }
      const manifest = join(directory, location, 'package.json');
      if (!existsSync(manifest))
        throw new Error(`${location}: missing package.json`);
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      if (typeof pkg.name !== 'string' || !pkg.name.trim()) {
        throw new Error(`${location}: missing package name`);
      }
      for (const task of requiredTasks) {
        if (
          typeof pkg.scripts?.[task] !== 'string' ||
          !pkg.scripts[task].trim()
        ) {
          throw new Error(`${location}: missing ${task} script`);
        }
      }
      count++;
    }
  }
  return count;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const count = checkWorkspaces(process.cwd());
  console.log(
    `${count} product workspaces checked. Root tooling checks run even when this is zero.`,
  );
}
