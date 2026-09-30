import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BACKDROPS,
  BACKDROP_DIR,
  backdropFiles,
  backdropGuidance,
  backdropPath,
  importedBackdrops,
  isBackdropPath,
  selectBackdrops,
} from '../src/backdrops.ts';
import { canvasFindings, checkDesign } from '../src/design-checks.ts';
import { buildUserPrompt } from '../src/plan-provider.ts';
import { isTemplatedPath, withScaffold } from '../src/scaffold.ts';

const EM_DASH = String.fromCodePoint(0x2014);
const byId = (id: string) => BACKDROPS.find((recipe) => recipe.id === id)!;

describe('the animated backgrounds (D75, D77)', () => {
  it('have distinct ids and components, and lowercase triggers', () => {
    assert.equal(new Set(BACKDROPS.map((r) => r.id)).size, BACKDROPS.length);
    assert.equal(
      new Set(BACKDROPS.map((r) => r.component)).size,
      BACKDROPS.length,
    );
    for (const recipe of BACKDROPS) {
      assert.ok(recipe.triggers.length > 0, recipe.id);
      for (const trigger of recipe.triggers) {
        assert.equal(trigger, trigger.toLowerCase(), trigger);
      }
    }
  });

  it('are each written with every convention the checks ask of a hand-written one', () => {
    for (const recipe of BACKDROPS) {
      const source = recipe.source;
      assert.match(
        source,
        new RegExp(`export function ${recipe.component}\\(`),
        recipe.id,
      );
      // React and nothing else: no package a project would have to add.
      const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      assert.deepEqual([...new Set(imports)], ['react'], recipe.id);
      assert.match(source, /aria-hidden/, recipe.id);
      assert.match(source, /absolute inset-0 -z-10/, recipe.id);
      assert.match(source, /prefers-reduced-motion: reduce/, recipe.id);
      assert.match(source, /visibilitychange/, recipe.id);
      assert.match(source, /IntersectionObserver/, recipe.id);
      assert.match(source, /Math\.min\(window\.devicePixelRatio/, recipe.id);
      assert.ok(!source.includes(EM_DASH), recipe.id);
      assert.ok(!source.includes('\r'), recipe.id);
    }
    // And so, read as if the model had written them, nothing is found.
    assert.deepEqual(
      canvasFindings(
        BACKDROPS.map((recipe) => ({
          path: `src/components/hero/${recipe.id}.tsx`,
          content: recipe.source,
        })),
      ),
      [],
    );
  });

  it('are templated files, in their own folder', () => {
    for (const recipe of BACKDROPS) {
      const path = backdropPath(recipe);
      assert.ok(path.startsWith(`${BACKDROP_DIR}/`), path);
      assert.equal(isBackdropPath(path), true);
      assert.equal(isTemplatedPath(path), true);
    }
    assert.equal(isBackdropPath('src/components/backdrop/other.tsx'), false);
    assert.equal(isTemplatedPath('src/App.tsx'), false);
  });
});

describe('choosing animated backgrounds for a request', () => {
  it('offers the ones a request names', () => {
    assert.deepEqual(
      selectBackdrops('A galaxy of particles behind the hero').map((r) => r.id),
      ['particle-field'],
    );
    assert.deepEqual(
      selectBackdrops('An aurora glow on the landing page').map((r) => r.id),
      ['aurora-mesh'],
    );
  });

  it('offers all of them for a moving background with no kind named', () => {
    assert.equal(
      selectBackdrops('A studio site. Heavy animation and fluid motion.')
        .length,
      BACKDROPS.length,
    );
    assert.equal(
      selectBackdrops('Give it an animated background').length,
      BACKDROPS.length,
    );
  });

  it('offers none to a request that asks for no moving background', () => {
    assert.deepEqual(selectBackdrops('A bakery website with a menu'), []);
    assert.equal(backdropGuidance('A bakery website with a menu'), null);
    // A word inside another word is not a trigger.
    assert.deepEqual(selectBackdrops('Our shaderless renderer docs'), []);
  });

  it('tells the model how to import one and never to write one', () => {
    const guidance = backdropGuidance('A hero with an aurora')!;
    assert.match(guidance, /^ANIMATED BACKGROUNDS\n/);
    assert.ok(
      guidance.includes(
        "import { AuroraMesh } from '@/components/backdrop/aurora-mesh'",
      ),
    );
    assert.ok(guidance.includes(`Never plan, write or edit`));
    assert.ok(guidance.includes('relative isolate overflow-hidden'));
    assert.ok(!guidance.includes('ParticleField'));
    assert.ok(!guidance.includes(EM_DASH));
  });

  it('reaches the build prompt only when the request asks', () => {
    assert.ok(
      buildUserPrompt({ prompt: 'A portfolio with heavy animation' }).includes(
        '\nANIMATED BACKGROUNDS\n',
      ),
    );
    assert.ok(
      !buildUserPrompt({ prompt: 'A bakery website' }).includes(
        'ANIMATED BACKGROUNDS',
      ),
    );
  });
});

describe('writing the animated backgrounds a project imports', () => {
  const app = (content: string) => ({ path: 'src/App.tsx', content });

  it('finds an import by alias, relative path or dynamic import', () => {
    const found = importedBackdrops([
      app("import { AuroraMesh } from '@/components/backdrop/aurora-mesh';"),
      {
        path: 'src/pages/Home.tsx',
        content:
          "import { FlowLines } from '../components/backdrop/flow-lines.tsx';\nconst P = lazy(() => import('@/components/backdrop/particle-field'));",
      },
      // Not a file Vibld writes, and a mention in copy is not an import.
      {
        path: 'src/pages/About.tsx',
        content:
          "import { Other } from '@/components/backdrop/other';\nconst copy = 'grain-blobs';",
      },
    ]);
    assert.deepEqual(
      found.map((recipe) => recipe.id),
      ['aurora-mesh', 'particle-field', 'flow-lines'],
    );
  });

  it('writes nothing for a project that imports none', () => {
    assert.deepEqual(
      backdropFiles([app('export default function App() {}')]),
      [],
    );
  });

  it('adds the imported one to a new project, and replaces one the model wrote', () => {
    const files = withScaffold(
      [
        app("import { GrainBlobs } from '@/components/backdrop/grain-blobs';"),
        {
          path: 'src/components/backdrop/grain-blobs.tsx',
          content: 'export const GrainBlobs = () => null;',
        },
        {
          path: 'src/components/backdrop/flow-lines.tsx',
          content: 'export const FlowLines = () => null;',
        },
      ],
      { title: 'Grain', description: 'A grainy site.' },
      false,
    );
    const backdrops = files.filter((file) => isBackdropPath(file.path));
    assert.deepEqual(backdrops, [
      {
        path: 'src/components/backdrop/grain-blobs.tsx',
        content: byId('grain-blobs').source,
      },
    ]);
    // It imports only React, so package.json needs nothing more for it.
    const pkg = JSON.parse(
      files.find((file) => file.path === 'package.json')!.content,
    ) as { dependencies: Record<string, string> };
    assert.ok(pkg.dependencies.react);
  });

  it("keeps a follow-up project's own copy, and adds one a file now imports", () => {
    const edited = {
      path: 'src/components/backdrop/aurora-mesh.tsx',
      content: '// edited by hand\nexport const AuroraMesh = () => null;',
    };
    const files = withScaffold(
      [
        app(
          "import { AuroraMesh } from '@/components/backdrop/aurora-mesh';\nimport { FlowLines } from '@/components/backdrop/flow-lines';",
        ),
        edited,
      ],
      { title: 'Site', description: 'A site.' },
      true,
    );
    assert.deepEqual(
      files.find((file) => file.path === edited.path),
      edited,
    );
    assert.equal(
      files.find(
        (file) => file.path === 'src/components/backdrop/flow-lines.tsx',
      )?.content,
      byId('flow-lines').source,
    );
  });
});

describe('the canvas conventions', () => {
  const loop = (body: string) => [
    { path: 'src/components/Hero.tsx', content: body },
  ];

  it('warns about an uncapped, unpaused, unchecked loop that ignores reduced motion', () => {
    const findings = canvasFindings(
      loop(`const gl = canvas.getContext('webgl');
canvas.width = innerWidth * window.devicePixelRatio;
function frame() { gl.clear(0); requestAnimationFrame(frame); }
frame();`),
    );
    assert.deepEqual(
      findings.map((finding) => [finding.severity, finding.check]),
      [
        ['warning', 'canvas'],
        ['warning', 'canvas'],
        ['warning', 'reduced-motion'],
        ['warning', 'canvas'],
      ],
    );
    assert.match(
      findings[0]!.detail,
      /Math\.min\(window\.devicePixelRatio, 2\)/,
    );
    assert.match(findings[3]!.detail, /context in gl without checking/);
  });

  it('finds nothing in one that keeps them', () => {
    assert.deepEqual(
      canvasFindings(
        loop(`const gl = canvas.getContext('webgl2', { alpha: true });
if (!gl) return;
const dpr = Math.min(window.devicePixelRatio || 1, 2);
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
document.addEventListener('visibilitychange', onVisibility);
requestAnimationFrame(frame);`),
      ),
      [],
    );
  });

  it('reads a cap written either way round, and a null check written as a guard', () => {
    assert.deepEqual(
      canvasFindings(
        loop(`const ctx: WebGLRenderingContext | null = el.getContext('webgl');
const ratio = Math.min(2, window.devicePixelRatio);
if (ctx === null) throw new Error('no webgl');`),
      ),
      [],
    );
  });

  it('leaves a 2D canvas drawn once alone, and never reads a templated file', () => {
    assert.deepEqual(
      canvasFindings(
        loop("const ctx = el.getContext('2d'); ctx.fillRect(0, 0, 1, 1);"),
      ),
      [],
    );
    assert.deepEqual(
      canvasFindings([
        {
          path: backdropPath(byId('aurora-mesh')),
          content:
            'requestAnimationFrame(f); el.getContext("2d"); devicePixelRatio;',
        },
      ]),
      [],
    );
  });

  it('are warnings in checkDesign, never errors', () => {
    const report = checkDesign(
      loop(
        `const c = el.getContext('2d'); c.scale(devicePixelRatio, devicePixelRatio); requestAnimationFrame(f);`,
      ),
    );
    assert.equal(
      report.errors.some((finding) => finding.check === 'canvas'),
      false,
    );
    assert.ok(report.warnings.some((finding) => finding.check === 'canvas'));
  });
});
