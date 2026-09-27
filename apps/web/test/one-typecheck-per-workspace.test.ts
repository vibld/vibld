import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * One task per workspace runs the type checker, and no more.
 *
 * Every workspace that had both declared `lint` and `typecheck` as the same
 * command, `tsc --noEmit`, so the gate ran the compiler twice over the same
 * files and called the second run a different kind of check. That is wasted
 * work everywhere, and in `apps/marketing` it was a bug: `typecheck` there
 * is `react-router typegen && tsc`, and typegen deletes and rewrites
 * `.react-router/types/`, which `lint`'s bare `tsc` reads through the same
 * tsconfig. Turbo had nothing ordering the two, so it ran them together and
 * the build failed intermittently with TS6053, a missing generated file.
 *
 * It read as flaky infrastructure, which is what made it expensive: it was
 * diagnosed as resource exhaustion twice before anybody noticed that the two
 * tasks share a directory one of them generates. `--concurrency=1` made it
 * pass, which confirmed the race rather than fixing it.
 *
 * CI never ran `lint` at all. So the duplicate task bought nothing anywhere
 * and cost a race in the one workspace where the two commands differed.
 *
 * The rule is the general form rather than a ban on the name `lint`: two
 * tasks running `tsc` over one tsconfig are either duplicated work or, when
 * one of them generates what the other reads, a race. Either way the second
 * one should not exist.
 */

const ROOT = new URL('../../../', import.meta.url).pathname;

/** Anything that ends up invoking the TypeScript compiler. */
function runsTsc(command: string): boolean {
  return /(^|\s|&&|\|\||;)tsc(\s|$)/.test(command);
}

async function workspaces(): Promise<string[]> {
  const found: string[] = [];
  for (const group of ['apps', 'packages']) {
    const dir = join(ROOT, group);
    for (const name of await readdir(dir)) {
      found.push(join(dir, name));
    }
  }
  return found;
}

async function scriptsOf(
  workspace: string,
): Promise<Record<string, string> | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(workspace, 'package.json'), 'utf8');
  } catch {
    return undefined;
  }
  return (
    (JSON.parse(raw) as { scripts?: Record<string, string> }).scripts ?? {}
  );
}

describe('the checks a workspace declares', () => {
  it('runs the type checker from one task, not two', async () => {
    const offenders: string[] = [];
    let checked = 0;

    for (const workspace of await workspaces()) {
      const scripts = await scriptsOf(workspace);
      if (scripts === undefined) continue;
      checked += 1;
      const checking = Object.entries(scripts)
        .filter(([name]) => name !== 'build' && name !== 'dev')
        .filter(([, command]) => runsTsc(command))
        .map(([name]) => name);
      if (checking.length > 1) {
        offenders.push(`${workspace}: ${checking.join(', ')}`);
      }
    }

    assert.ok(checked > 0, 'no workspaces were read, so this proved nothing');
    assert.deepEqual(
      offenders,
      [],
      'two tasks run the compiler over the same files: duplicated work, or a race when one generates what the other reads',
    );
  });

  it('is looking at workspaces that really do type-check', async () => {
    // Refuses to pass vacuously. The rule above is satisfied by a repository
    // where nothing type-checks at all, so this pins that the thing being
    // constrained exists.
    const typechecking: string[] = [];
    for (const workspace of await workspaces()) {
      const scripts = await scriptsOf(workspace);
      if (scripts?.typecheck !== undefined && runsTsc(scripts.typecheck)) {
        typechecking.push(workspace);
      }
    }
    assert.ok(
      typechecking.length >= 5,
      `only ${typechecking.length} workspaces type-check, so the rule is guarding almost nothing`,
    );
  });

  it('leaves no task pointing at a script that has gone', async () => {
    // `turbo.json` naming a task no workspace declares is how a check stops
    // running without anything going red: turbo has nothing to do and says
    // so cheerfully.
    const raw = await readFile(join(ROOT, 'turbo.json'), 'utf8');
    const { tasks } = JSON.parse(raw) as {
      tasks: Record<string, { dependsOn?: string[] }>;
    };

    const declared = new Set<string>();
    for (const workspace of await workspaces()) {
      for (const name of Object.keys((await scriptsOf(workspace)) ?? {})) {
        declared.add(name);
      }
    }

    // `check` is turbo's own aggregate and runs no script of its own.
    const orphans = Object.keys(tasks).filter(
      (name) => name !== 'check' && !declared.has(name),
    );
    assert.deepEqual(orphans, [], 'turbo.json names tasks nothing declares');

    const dangling = Object.values(tasks)
      .flatMap((task) => task.dependsOn ?? [])
      .filter((dep) => !dep.startsWith('^'))
      .filter((dep) => !(dep in tasks));
    assert.deepEqual(
      dangling,
      [],
      'a task depends on one that turbo.json does not define',
    );
  });
});
