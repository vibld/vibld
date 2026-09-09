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
describe('the exported project', () => {
  const files = buildProjectFiles(deriveBrief('a landing page for a bakery'));
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
