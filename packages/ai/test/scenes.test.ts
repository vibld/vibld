import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BACKDROPS, VIBLD_MARK, backdropPath } from '../src/backdrops.ts';
import { canvasFindings } from '../src/design-checks.ts';
import { buildUserPrompt } from '../src/plan-provider.ts';
import {
  extraDependencies,
  isTemplatedPath,
  ownedTemplatePaths,
  withImportedDependencies,
  withScaffold,
} from '../src/scaffold.ts';
import {
  SCENE_EXAMPLES,
  STAGE_PATH,
  STAGE_SOURCE,
  importsStage,
  isScenePath,
  sceneExample,
  sceneFiles,
  sceneGuidance,
  selectScenes,
} from '../src/scenes.ts';
import { OPTIONAL_PACKAGES } from '../src/stack.ts';

const EM_DASH = String.fromCodePoint(0x2014);
const app = (content: string) => ({ path: 'src/App.tsx', content });
/** A scene file as the model writes one, on the stage. */
const HERO =
  "import { ThreeScene, type SceneProps, type Stage } from '@/components/scene/stage';\nexport function HeroScene(props: SceneProps) { return <ThreeScene {...props} build={build} />; }\nfunction build({ THREE, scene }: Stage) { scene.add(new THREE.Mesh()); return { update() {} }; }\n";

describe('the 3D stage (D205)', () => {
  it('is written with the conventions of the animated backgrounds', () => {
    const source = STAGE_SOURCE;
    // React, and three's types; three itself only by dynamic import, so
    // the first paint carries none of it.
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(imports)], ['react', 'three/webgpu']);
    assert.match(source, /import type \* as Three from 'three\/webgpu'/);
    assert.match(source, /await import\('three\/webgpu'\)/);
    // WebGL 2 when WebGPU is missing or throws on the first frame.
    assert.match(source, /forceWebGL/);
    assert.match(source, /aria-hidden/);
    assert.match(source, /pointer-events-none absolute inset-0/);
    assert.match(source, /prefers-reduced-motion: reduce/);
    assert.match(source, /visibilitychange/);
    assert.match(source, /IntersectionObserver/);
    assert.match(source, /Math\.min\(window\.devicePixelRatio/);
    // Colors resolve inside the scene's box, so a token scoped to its
    // section counts, and a theme change there rebuilds it.
    assert.match(source, /host\.appendChild\(probe\)/);
    assert.ok(!source.includes('document.body.appendChild'));
    assert.match(
      source,
      /useThemeKey\(\[\.\.\.colors, 'var\(--background\)'\], boxRef\)/,
    );
    // A theme set on the box or any element around it rebuilds the scene.
    assert.match(source, /element = element\.parentElement/);
    for (const name of [
      'ThreeScene',
      'seeded',
      'spherePoints',
      'noise3',
      'mendSeams',
    ]) {
      assert.match(source, new RegExp(`export function ${name}\\(`), name);
    }
    for (const name of ['Stage', 'SceneHandle', 'SceneProps']) {
      assert.match(source, new RegExp(`export interface ${name} `), name);
    }
    assert.ok(source.includes(VIBLD_MARK));
    assert.ok(!source.includes(EM_DASH));
    assert.ok(!source.includes('\r'));
  });

  it('is the one templated scene file, which the canvas checks skip', () => {
    assert.equal(isScenePath(STAGE_PATH), true);
    assert.equal(isTemplatedPath(STAGE_PATH), true);
    assert.equal(isScenePath('src/components/scene/globe.tsx'), false);
    assert.equal(isTemplatedPath('src/components/HeroScene.tsx'), false);
    assert.deepEqual(
      canvasFindings([{ path: STAGE_PATH, content: STAGE_SOURCE }]),
      [],
    );
  });

  it('has examples written on it, as the model would write a scene', () => {
    assert.equal(SCENE_EXAMPLES.length, 4);
    for (const example of SCENE_EXAMPLES) {
      const source = example.source;
      // three only as types; everything else from the stage.
      const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      assert.deepEqual(
        [...new Set(imports)],
        ['three/webgpu', '@/components/scene/stage'],
        example.id,
      );
      assert.match(source, /import type \* as Three from 'three\/webgpu'/);
      assert.match(source, /<ThreeScene\s/, example.id);
      assert.match(source, /update\(t\)/, example.id);
      // Nothing the stage already does.
      for (const forbidden of [
        'requestAnimationFrame',
        'devicePixelRatio',
        'WebGPURenderer',
        'getContext',
      ]) {
        assert.ok(!source.includes(forbidden), example.id + ' ' + forbidden);
      }
      assert.deepEqual(
        canvasFindings([
          { path: 'src/components/' + example.id + '.tsx', content: source },
        ]),
        [],
        example.id,
      );
      assert.ok(!source.includes(EM_DASH), example.id);
      assert.ok(!source.includes('\r'), example.id);
    }
  });

  it("counts as Vibld's at its path only when it carries the mark", () => {
    for (const recipe of BACKDROPS) {
      assert.ok(recipe.source.includes(VIBLD_MARK), recipe.id);
    }
    const aurora = backdropPath(BACKDROPS[0]!);
    const own =
      "export const Stage = () => { const c = document.createElement('canvas').getContext('2d'); const f = () => requestAnimationFrame(f); f(); return null; };";
    const files = [
      { path: STAGE_PATH, content: own },
      { path: aurora, content: BACKDROPS[0]!.source },
      app('export const App = () => null;'),
    ];
    assert.deepEqual(ownedTemplatePaths(files), [STAGE_PATH]);
    const owned = new Set(ownedTemplatePaths(files));
    assert.equal(isTemplatedPath(STAGE_PATH, owned), false);
    assert.equal(isTemplatedPath(aurora, owned), true);
    assert.equal(
      isTemplatedPath('package.json', new Set(['package.json'])),
      true,
    );
    // The project's own file is read like any other.
    assert.ok(
      canvasFindings(files).some((finding) =>
        finding.detail.startsWith(STAGE_PATH),
      ),
    );
    // A follow-up keeps it, though a file now imports the stage.
    const kept = withScaffold(
      [
        ...files.slice(0, 2),
        app("import { HeroScene } from '@/components/HeroScene';"),
        { path: 'src/components/HeroScene.tsx', content: HERO },
        { path: 'package.json', content: '{"name":"x","dependencies":{}}' },
      ],
      { title: 'X', description: 'A site.' },
      true,
    );
    assert.equal(kept.find((file) => file.path === STAGE_PATH)?.content, own);
  });

  it('flags a file that imports three.js as a value', () => {
    const findings = canvasFindings([
      {
        path: 'src/components/Hero3D.tsx',
        content:
          "import * as THREE from 'three';\nimport { OrbitControls } from 'three/addons/controls/OrbitControls.js';",
      },
      {
        path: 'src/components/Fine.tsx',
        content: "import type * as Three from 'three/webgpu';",
      },
    ]);
    assert.equal(findings.length, 1);
    assert.ok(findings[0]!.detail.startsWith('src/components/Hero3D.tsx'));
    assert.equal(findings[0]!.severity, 'warning');
  });
});

describe('choosing 3D guidance for a request', () => {
  it('fits the example a request names', () => {
    assert.deepEqual(
      selectScenes('A logistics startup with a spinning globe').map(
        (r) => r.id,
      ),
      ['globe'],
    );
    assert.equal(
      sceneExample('An AI app with an iridescent orb in the hero')?.id,
      'liquid-orb',
    );
  });

  it('picks among all of them for 3D with no subject named, by the text', () => {
    assert.equal(
      selectScenes('A 3D landing page').length,
      SCENE_EXAMPLES.length,
    );
    assert.equal(
      selectScenes('Built with Three.js and WebGPU').length,
      SCENE_EXAMPLES.length,
    );
    const picked = new Set(
      [
        'A 3D landing page',
        'A 3D portfolio for an architect',
        'A coffee roaster with a 3D hero',
        'A fintech app with 3D visuals',
        'A music festival site in 3D',
        'A 3D site for a running club',
        'A 3D studio site',
        'A climbing gym with a 3D hero',
      ].map((prompt) => sceneExample(prompt)!.id),
    );
    assert.ok(picked.size >= 3, [...picked].join(', '));
    assert.equal(
      sceneExample('A 3D landing page')!.id,
      sceneExample('A 3D landing page')!.id,
    );
  });

  it('offers none to a request that asks for no 3D', () => {
    assert.deepEqual(selectScenes('A bakery website with a menu'), []);
    assert.equal(sceneGuidance('A bakery website with a menu'), null);
    // A word inside another word is not a trigger.
    assert.deepEqual(selectScenes('Our orbit tracker and 3dprint shop'), []);
    // Nor 3D that names a business.
    assert.deepEqual(
      selectScenes('A 3D printing service and a 3-D printer catalog'),
      [],
    );
    assert.deepEqual(
      selectScenes(
        'A three-dimensional printing service and a three dimensional scanner shop',
      ),
      [],
    );
    assert.equal(
      selectScenes('A 3D printing studio with a 3D hero').length,
      SCENE_EXAMPLES.length,
    );
    // Nor a word that names something other than a look.
    assert.deepEqual(
      selectScenes(
        'A Chrome extension for liquid staking, backed by blob storage, selling iridescent nail polish and holographic stickers',
      ),
      [],
    );
    assert.deepEqual(
      selectScenes(
        'A planet-friendly logistics platform with worldwide shipping, all-terrain bikes and an Earth Day sale',
      ),
      [],
    );
  });

  it('tells the model to design its own scene on the stage', () => {
    const guidance = sceneGuidance('A hero with a globe')!;
    assert.match(guidance, /^3D SCENES\n/);
    assert.ok(guidance.includes('write it yourself'));
    assert.ok(guidance.includes(STAGE_PATH));
    assert.ok(guidance.includes('never plan, write or edit it'));
    assert.ok(guidance.includes('not to copy'));
    assert.ok(guidance.includes('ShaderMaterial'));
    // One example: the one it named.
    assert.ok(guidance.includes('export function Globe('));
    assert.ok(!guidance.includes('export function LiquidOrb('));
    assert.ok(!guidance.includes(EM_DASH));
  });

  it('reaches the build prompt only when the request asks', () => {
    assert.ok(
      buildUserPrompt({ prompt: 'A studio site with 3D visuals' }).includes(
        '\n3D SCENES\n',
      ),
    );
    assert.ok(
      !buildUserPrompt({ prompt: 'A bakery website' }).includes('3D SCENES'),
    );
  });
});

describe('writing the stage a project imports', () => {
  it('finds an import by alias, relative path or dynamic import', () => {
    assert.equal(importsStage([app(HERO)]), true);
    assert.equal(
      importsStage([
        {
          path: 'src/components/Hero.tsx',
          content: "import { ThreeScene } from './scene/stage';",
        },
      ]),
      true,
    );
    assert.equal(
      importsStage([
        {
          path: 'src/components/home/Band.tsx',
          content: "const S = lazy(() => import('../scene/stage.tsx'));",
        },
      ]),
      true,
    );
    assert.equal(
      importsStage([
        {
          path: 'src/lib/elsewhere.ts',
          content: "import { ThreeScene } from './scene/stage';",
        },
        app("import { Other } from '@/components/scene/other';"),
      ]),
      false,
    );
    assert.deepEqual(sceneFiles([app('export default function App() {}')]), []);
  });

  it('adds it to a new project with three and its types, over any the model wrote', () => {
    const files = withScaffold(
      [
        app("import { HeroScene } from '@/components/HeroScene';"),
        { path: 'src/components/HeroScene.tsx', content: HERO },
        { path: STAGE_PATH, content: 'export const ThreeScene = () => null;' },
      ],
      { title: 'Globe', description: 'A global site.' },
      false,
    );
    assert.deepEqual(
      files.filter((file) => isScenePath(file.path)),
      [{ path: STAGE_PATH, content: STAGE_SOURCE }],
    );
    const pkg = JSON.parse(
      files.find((file) => file.path === 'package.json')!.content,
    ) as { dependencies: Record<string, string> };
    assert.equal(pkg.dependencies.three, OPTIONAL_PACKAGES.three);
    assert.equal(
      pkg.dependencies['@types/three'],
      OPTIONAL_PACKAGES['@types/three'],
    );
  });

  it('adds three and its types to a follow-up that now imports it', () => {
    const files = withScaffold(
      [
        { path: 'package.json', content: '{"name":"site"}' },
        app("import { HeroScene } from '@/components/HeroScene';"),
        { path: 'src/components/HeroScene.tsx', content: HERO },
      ],
      { title: 'Site', description: 'A site.' },
      true,
    );
    assert.equal(
      files.find((file) => file.path === STAGE_PATH)?.content,
      STAGE_SOURCE,
    );
    const pkg = JSON.parse(
      files.find((file) => file.path === 'package.json')!.content,
    ) as { dependencies: Record<string, string> };
    assert.equal(pkg.dependencies.three, OPTIONAL_PACKAGES.three);
    assert.equal(
      pkg.dependencies['@types/three'],
      OPTIONAL_PACKAGES['@types/three'],
    );
  });

  it('matches the types to a three range the outline or project chose', () => {
    const files = [app("import * as THREE from 'three';")];
    assert.deepEqual(
      extraDependencies(files, [{ name: 'three', version: '^0.180.0' }]),
      { three: '^0.180.0', '@types/three': '~0.180.0' },
    );
    const pkg = JSON.parse(
      withImportedDependencies(
        '{"name":"site","dependencies":{"three":"0.179.1"}}',
        files,
      ),
    ) as { dependencies: Record<string, string> };
    assert.equal(pkg.dependencies['@types/three'], '~0.179.0');
    const optional = JSON.parse(
      withImportedDependencies(
        '{"name":"site","optionalDependencies":{"three":"^0.178.0"}}',
        files,
      ),
    ) as { dependencies: Record<string, string> };
    assert.equal(optional.dependencies['@types/three'], '~0.178.0');
    // Types already declared, without the runtime: three of that release.
    const typesOnly = JSON.parse(
      withImportedDependencies(
        '{"name":"site","devDependencies":{"@types/three":"^0.177.0"}}',
        files,
      ),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    assert.equal(typesOnly.dependencies.three, '~0.177.0');
    assert.equal(typesOnly.devDependencies['@types/three'], '^0.177.0');
  });

  it('moves a three from before three/webgpu existed to the default release', () => {
    const stage = [{ path: STAGE_PATH, content: STAGE_SOURCE }, app(HERO)];
    const pkg = JSON.parse(
      withImportedDependencies(
        '{"name":"site","dependencies":{"three":"^0.160.0"},"devDependencies":{"@types/three":"^0.160.1"}}',
        stage,
      ),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    assert.equal(pkg.dependencies.three, OPTIONAL_PACKAGES.three);
    assert.equal(
      pkg.devDependencies['@types/three'],
      OPTIONAL_PACKAGES['@types/three'],
    );
    // Types alone, from before it: the runtime added is the default too.
    const typesOnly = JSON.parse(
      withImportedDependencies(
        '{"name":"site","devDependencies":{"@types/three":"^0.150.0"}}',
        stage,
      ),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    assert.equal(typesOnly.dependencies.three, OPTIONAL_PACKAGES.three);
    assert.equal(
      typesOnly.devDependencies['@types/three'],
      OPTIONAL_PACKAGES['@types/three'],
    );
    // An outline's old three, for a new project on the stage.
    assert.deepEqual(
      extraDependencies(stage, [{ name: 'three', version: '^0.160.0' }]),
      {
        three: OPTIONAL_PACKAGES.three,
        '@types/three': OPTIONAL_PACKAGES['@types/three'],
      },
    );
    // A range that may install an old release is treated as old.
    for (const range of ['0.166.x', '>=0.160.0 <0.167.0']) {
      const loose = JSON.parse(
        withImportedDependencies(
          JSON.stringify({ name: 'site', dependencies: { three: range } }),
          stage,
        ),
      ) as { dependencies: Record<string, string> };
      assert.equal(loose.dependencies.three, OPTIONAL_PACKAGES.three, range);
    }
    // Types of another release than the runtime follow the runtime.
    const mismatched = JSON.parse(
      withImportedDependencies(
        '{"name":"site","dependencies":{"three":"^0.170.0"},"devDependencies":{"@types/three":"^0.186.0"}}',
        stage,
      ),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    assert.equal(mismatched.dependencies.three, '^0.170.0');
    assert.equal(mismatched.devDependencies['@types/three'], '~0.170.0');
    // r167 and later are kept, and so is an old three nothing loads
    // three/webgpu from.
    const recent = JSON.parse(
      withImportedDependencies(
        '{"name":"site","dependencies":{"three":"^0.170.0"}}',
        stage,
      ),
    ) as { dependencies: Record<string, string> };
    assert.equal(recent.dependencies.three, '^0.170.0');
    const unrelated =
      '{"name":"site","dependencies":{"three":"^0.160.0","@types/three":"^0.160.0"}}';
    assert.equal(
      withImportedDependencies(unrelated, [
        app("import * as THREE from 'three';"),
      ]),
      unrelated,
    );
  });

  it('declares three in a package.json a follow-up has to rewrite', () => {
    const files = withScaffold(
      [
        app("import { HeroScene } from '@/components/HeroScene';"),
        {
          path: 'src/components/HeroScene.tsx',
          content: HERO,
        },
      ],
      { title: 'Site', description: 'A site.' },
      true,
    );
    const pkg = JSON.parse(
      files.find((file) => file.path === 'package.json')!.content,
    ) as { dependencies: Record<string, string> };
    assert.equal(pkg.dependencies.three, OPTIONAL_PACKAGES.three);
    assert.equal(
      pkg.dependencies['@types/three'],
      OPTIONAL_PACKAGES['@types/three'],
    );
  });

  it('adds the types for a file that imports three directly, too', () => {
    const files = [app("import * as THREE from 'three';")];
    assert.deepEqual(extraDependencies(files), {
      three: OPTIONAL_PACKAGES.three,
      '@types/three': OPTIONAL_PACKAGES['@types/three'],
    });
    const pkg = JSON.parse(
      withImportedDependencies('{"name":"site"}', files),
    ) as { dependencies: Record<string, string> };
    assert.equal(pkg.dependencies.three, OPTIONAL_PACKAGES.three);
    assert.equal(
      pkg.dependencies['@types/three'],
      OPTIONAL_PACKAGES['@types/three'],
    );
  });
});
