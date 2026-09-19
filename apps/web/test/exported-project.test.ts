import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveBrief } from '../src/generation/brief.ts';
import { buildProjectFiles } from '../src/generation/plan-builder.ts';

/**
 * ADR-0002 says the output installs and builds with ordinary npm commands.
 *
 * It did not. The manifest declared `tsc --noEmit && vite build` and shipped
 * no tsconfig.json, so `npm run build` on a downloaded project stopped at tsc
 * printing its own usage; with that fixed it stopped again on TS7026 for
 * every JSX element, because React ships no types and @types/react was not a
 * dependency. Both were found by extracting a real download and running the
 * commands, which is the only way this claim can be checked.
 *
 * These assertions are the cheap standing guard for what that proved.
 */
const files = buildProjectFiles(deriveBrief('a landing page for a bakery'));

describe('the exported project', () => {
  const paths = new Set(files.map((file) => file.path));
  const manifest = JSON.parse(
    files.find((file) => file.path === 'package.json')!.content,
  ) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it('ships the config every script it declares needs', () => {
    assert.ok(
      manifest.scripts.build?.includes('tsc'),
      'this test is about a build that runs tsc',
    );
    assert.ok(paths.has('tsconfig.json'), 'tsc with no project prints usage');
    assert.ok(paths.has('vite.config.ts'));
  });

  it('can typecheck the JSX it contains', () => {
    // React ships no types. Without these every element is a TS7026 error,
    // and `build` runs the typecheck before it reaches the bundler.
    assert.ok(manifest.dependencies.react);
    assert.ok(manifest.devDependencies['@types/react']);
    assert.ok(manifest.devDependencies['@types/react-dom']);
  });

  it('configures the build plugin it depends on', () => {
    assert.ok(manifest.devDependencies['@vitejs/plugin-react']);
    const config = files.find((file) => file.path === 'vite.config.ts')!;
    assert.match(config.content, /@vitejs\/plugin-react/);
    assert.match(config.content, /plugins:\s*\[react\(\)\]/);
  });

  it('lets tsc resolve the .tsx imports the sources actually write', () => {
    // src/main.tsx imports './App.tsx' with the extension, which tsc rejects
    // unless allowImportingTsExtensions is set.
    const main = files.find((file) => file.path === 'src/main.tsx')!;
    assert.match(main.content, /from '\.\/App\.tsx'/);
    const tsconfig = JSON.parse(
      files.find((file) => file.path === 'tsconfig.json')!.content,
    ) as { compilerOptions: Record<string, unknown> };
    assert.equal(tsconfig.compilerOptions.allowImportingTsExtensions, true);
    assert.equal(tsconfig.compilerOptions.jsx, 'react-jsx');
  });

  it("still depends on nothing of Vibld's", () => {
    for (const name of [
      ...Object.keys(manifest.dependencies),
      ...Object.keys(manifest.devDependencies),
    ]) {
      assert.equal(name.startsWith('@vibld/'), false, name);
    }
  });
});

/**
 * That the settings the project ships are the ones the prompt is written for.
 *
 * Found the same way the two failures above were, by running the commands:
 * a real generation produced a project that failed `npm run build`, a second
 * run from the identical prompt built cleanly, so the difference was in what
 * the model happened to write rather than in the scaffold.
 *
 * Reproduced without a model, against this exact tsconfig:
 *
 *   import { ReactNode } from 'react';
 *   TS1484: 'ReactNode' is a type and must be imported using a type-only
 *   import when 'verbatimModuleSyntax' is enabled.
 *
 * The first fix turned that setting off here. Wrong place (#193 review):
 * this scaffold only ever feeds `FakeModelProvider`, and a reader's project
 * comes from `RemoteModelProvider`, which returns the model's own files with
 * the model's own tsconfig. Turning a setting off here cannot stop a build
 * failure over there, and `npm create vite@latest` turns it on.
 *
 * So both settings stay, and the rule they impose is stated in the system
 * prompt instead, where it reaches the files a reader is actually given.
 * Keeping them here means the deterministic path compiles under the same
 * rules the model's own projects will, rather than under looser ones that
 * would hide the failure.
 *
 * Asserted against the compiler options rather than by compiling a fixture,
 * which would need a real `tsc` and a real `node_modules` inside a unit test.
 * The compiling was done by hand: the scaffold written out, `npm install`
 * and `npm run build` clean, and one ordinary type import added to it
 * failing with TS1484.
 */
describe('the settings the exported project compiles under', () => {
  const options = (
    JSON.parse(
      files.find((file) => file.path === 'tsconfig.json')!.content,
    ) as { compilerOptions: Record<string, unknown> }
  ).compilerOptions;

  it('keeps the setting that decides how a type is imported', () => {
    assert.equal(
      options.verbatimModuleSyntax,
      true,
      'the scaffold has to compile under the same rule the prompt gives the model, or it stops being evidence that the rule is followable',
    );
  });

  it('keeps the setting Vite actually needs', () => {
    // esbuild compiles one file at a time and needs this to be correct. It
    // costs the project one rule -- `export type` when re-exporting a type --
    // and the system prompt states that rule rather than leaving the model to
    // discover it.
    assert.equal(options.isolatedModules, true);
  });
});
