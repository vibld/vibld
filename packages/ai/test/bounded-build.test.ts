import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BoundedBuilder,
  BoundedPlanProvider,
  GROUP_CONTEXT_MAX_CHARS,
  GROUP_ESTIMATE_TOKENS,
  GROUP_MAX_TOKENS,
  MAX_PLANNED_FILES,
  OUTLINE_LABEL,
  OUTLINE_MAX_TOKENS,
  applyBoundedPatch,
  buildOutputBudgetFor,
  callCeilingFor,
  describeGroup,
  estimateTokens,
  groupLabel,
  normaliseOutline,
  orderManifest,
  partitionManifest,
  rankOf,
  runBoundedBuild,
  splitGroup,
} from '../src/bounded-build.ts';
import type {
  BoundedBuildHooks,
  BoundedBuildResult,
} from '../src/bounded-build.ts';
import { DESIGN_MD_PATH, readDesignSpec } from '../src/design-spec.ts';
import { BoundedBuildError, ProviderTruncationError } from '../src/errors.ts';
import { MODEL_CATALOGUE } from '../src/model-catalogue.ts';
import {
  GROUP_SYSTEM_PROMPT,
  MAX_PLANNED_ROUTES,
  OUTLINE_SYSTEM_PROMPT,
  PLAN_SYSTEM_PROMPT,
  REQUIRED_PROJECT_FILES,
} from '../src/plan-schema.ts';
import type { ManifestEntry } from '../src/plan-schema.ts';
import {
  PlanProvider,
  RUN_WALL_CLOCK_BUDGET_MS,
  maxTokensFor,
  outputTokensPerSecondFor,
} from '../src/plan-provider.ts';
import {
  createScriptedBuildClient,
  requestedPaths,
} from '../src/scripted-client.ts';
import type { ScriptedBuild, ScriptedFile } from '../src/scripted-client.ts';
import { SPEC } from './fixtures/design-spec.ts';

const MODEL = 'claude-opus-5-5';

function entry(
  path: string,
  size: ManifestEntry['size'] = 'small',
  dependsOn: string[] = [],
): ManifestEntry {
  return { path, purpose: `The file at ${path}.`, dependsOn, size };
}

function file(
  path: string,
  characters: number,
  size: ScriptedFile['size'] = 'small',
  dependsOn: string[] = [],
): ScriptedFile {
  return {
    path,
    content: `// ${path}\n${'x'.repeat(Math.max(0, characters))}`,
    size,
    dependsOn,
  };
}

/** Every required file, small, so a script is a whole project. */
function requiredFiles(): ScriptedFile[] {
  return REQUIRED_PROJECT_FILES.map((path) =>
    file(path, 400, path === 'src/styles.css' ? 'medium' : 'small'),
  );
}

/**
 * The shape of the build that failed on 2026-09-29 (trace `9eb10950`): a
 * full company site, six routes, shared glass components and motion, far
 * more output than one response can carry at the model's 128,000-token
 * ceiling.
 */
function companySite(): ScriptedBuild {
  const ui = [
    'button',
    'card',
    'sheet',
    'accordion',
    'tabs',
    'dialog',
    'badge',
    'input',
    'textarea',
    'tooltip',
  ].map((name) =>
    file(`src/components/ui/${name}.tsx`, 10_000, 'medium', [
      'src/lib/utils.ts',
    ]),
  );
  const shared = ['SiteLayout', 'Nav', 'Footer', 'GlassCard'].map((name) =>
    file(`src/components/${name}.tsx`, 10_000, 'medium', [
      'src/components/ui/button.tsx',
      'src/lib/motion.ts',
    ]),
  );
  const pages = [
    'Home',
    'Services',
    'Fractional',
    'Readiness',
    'Pentesting',
    'Contact',
  ].map((name) =>
    file(`src/pages/${name}Page.tsx`, 60_000, 'large', [
      'src/components/SiteLayout.tsx',
      'src/components/GlassCard.tsx',
      'src/styles.css',
    ]),
  );
  return {
    summary: 'A six-route site for North Star Systems.',
    spec: SPEC,
    files: [
      file('package.json', 1_500),
      file('index.html', 800),
      file('vite.config.ts', 600),
      file('tsconfig.json', 700),
      file('src/styles.css', 20_000, 'large'),
      file('src/lib/utils.ts', 300),
      file('src/lib/motion.ts', 8_000, 'medium'),
      ...ui,
      ...shared,
      ...pages,
      file(
        'src/App.tsx',
        6_000,
        'medium',
        pages.map((page) => page.path),
      ),
      file('src/main.tsx', 400, 'small', ['src/App.tsx']),
      file('README.md', 3_000),
    ],
  };
}

/** Records every step name and makes each call in this process. */
function inProcess(): BoundedBuildHooks & {
  names: string[];
  labels: string[];
} {
  const names: string[] = [];
  const labels: string[] = [];
  return {
    names,
    labels,
    step: async (name, run) => {
      names.push(name);
      return run();
    },
    beforeCall: (label) => {
      labels.push(label);
    },
  };
}

const BUDGET = {
  outputTokens: buildOutputBudgetFor(MODEL),
  inputChars: 4_000_000,
};

async function build(
  script: ScriptedBuild,
  hooks = inProcess(),
  options: Parameters<typeof createScriptedBuildClient>[1] = {},
  budget = BUDGET,
): Promise<{
  result: BoundedBuildResult;
  hooks: ReturnType<typeof inProcess>;
  client: ReturnType<typeof createScriptedBuildClient>;
}> {
  const client = createScriptedBuildClient(script, options);
  const builder = new BoundedBuilder(client, { model: MODEL });
  const result = await runBoundedBuild(
    builder,
    { prompt: 'A full website for North Star Systems.', budget },
    hooks,
  );
  return { result, hooks, client };
}

describe('the prompts a bounded build sends', () => {
  it('names every required file in the rules every build is held to', () => {
    const section = PLAN_SYSTEM_PROMPT.slice(
      PLAN_SYSTEM_PROMPT.indexOf('REQUIRED FILES'),
      PLAN_SYSTEM_PROMPT.indexOf('README.md is what'),
    );
    for (const path of REQUIRED_PROJECT_FILES) {
      assert.ok(section.includes(path), `${path} is not in REQUIRED FILES`);
    }
  });

  it('keeps the same rules in both steps, and drops the single-response limit', () => {
    for (const heading of [
      'STACK',
      'TYPESCRIPT',
      'REQUIRED FILES',
      'PATHS',
      'MOTION',
      'CONTENT',
      'PORTABILITY',
    ]) {
      assert.ok(OUTLINE_SYSTEM_PROMPT.includes(`\n${heading}\n`), heading);
      assert.ok(GROUP_SYSTEM_PROMPT.includes(`\n${heading}\n`), heading);
    }
    // The stopgap (internal PR 289) capped a large request at a home page and two
    // routes because the whole project had to fit in one reply. A bounded
    // build plans every page it is asked for, up to the cap.
    assert.ok(!OUTLINE_SYSTEM_PROMPT.includes('at most two further routes'));
    assert.ok(
      OUTLINE_SYSTEM_PROMPT.includes(`up to ${MAX_PLANNED_ROUTES} routes`),
    );
    assert.ok(!GROUP_SYSTEM_PROMPT.includes('\nSIZE\n'));
  });

  it('tells every file-group call to type Motion variants (try-generation run 36565229539)', async () => {
    // GPT-6 Luna wrote a whole site, then failed its own build twice with
    // TS2322: an untyped variants object whose easing array TypeScript had
    // widened to number[], passed to variants=.
    const { result, client } = await build({
      summary: 'A site.',
      spec: SPEC,
      files: requiredFiles(),
    });
    assert.equal(result.ok, true, result.failure?.message ?? '');
    const groups = client.requests.filter(
      (request) => requestedPaths(request.prompt).length > 0,
    );
    assert.ok(groups.length > 0);
    for (const request of groups) {
      assert.ok(
        request.system.includes("import type { Variants } from 'motion/react'"),
      );
      assert.ok(request.system.includes('src/lib/motion.ts'));
      assert.ok(request.system.includes('[0.23, 1, 0.32, 1] as const'));
      assert.match(request.system, /TS2322/);
      assert.match(request.system, /never WebkitBackdropFilter/);
      assert.match(request.system, /HTMLMotionProps<'div'>/);
    }
  });

  it('never uses the character the house rules ban', () => {
    for (const prompt of [OUTLINE_SYSTEM_PROMPT, GROUP_SYSTEM_PROMPT]) {
      assert.equal(prompt.includes(String.fromCharCode(0x2014)), false);
    }
  });
});

describe('ordering the manifest', () => {
  it('writes configuration and shared files first, then pages, then the shell', () => {
    const ordered = orderManifest([
      entry('README.md'),
      entry('src/App.tsx', 'medium'),
      entry('src/pages/About.tsx', 'large'),
      entry('src/components/Nav.tsx'),
      entry('src/components/ui/button.tsx'),
      entry('src/lib/utils.ts'),
      entry('src/styles.css'),
      entry('package.json'),
    ]).map((item) => item.path);
    assert.deepEqual(ordered, [
      'package.json',
      'src/lib/utils.ts',
      'src/styles.css',
      'src/components/ui/button.tsx',
      'src/components/Nav.tsx',
      'src/pages/About.tsx',
      'src/App.tsx',
      'README.md',
    ]);
    assert.ok(rankOf('src/main.tsx') > rankOf('src/App.tsx'));
  });

  it('puts every file after the files it declares it needs', () => {
    const manifest = [
      entry('src/components/Hero.tsx', 'medium', ['src/lib/motion.ts']),
      entry('src/lib/motion.ts', 'small', ['src/lib/easing.ts']),
      entry('src/lib/easing.ts'),
    ];
    const ordered = orderManifest(manifest).map((item) => item.path);
    assert.deepEqual(ordered, [
      'src/lib/easing.ts',
      'src/lib/motion.ts',
      'src/components/Hero.tsx',
    ]);
  });

  it('breaks a cycle rather than refusing it', () => {
    const ordered = orderManifest([
      entry('src/components/A.tsx', 'small', ['src/components/B.tsx']),
      entry('src/components/B.tsx', 'small', ['src/components/A.tsx']),
    ]);
    assert.equal(ordered.length, 2);
  });
});

describe('partitioning the manifest', () => {
  it('keeps every group inside its budget, and every dependency in the same or an earlier group', () => {
    const manifest = companySite().files.map((item) =>
      entry(item.path, item.size, item.dependsOn),
    );
    const groups = partitionManifest(manifest);
    const seen = new Set<string>();
    for (const group of groups) {
      assert.ok(estimateTokens(group) <= GROUP_ESTIMATE_TOKENS);
      const here = new Set(group.map((item) => item.path));
      for (const item of group) {
        for (const needed of item.dependsOn) {
          assert.ok(
            seen.has(needed) || here.has(needed),
            `${item.path} is written before ${needed}`,
          );
        }
      }
      for (const path of here) seen.add(path);
    }
    assert.equal(seen.size, manifest.length);
    // Shared files are written first.
    assert.equal(groups[0]![0]!.path, 'package.json');
  });

  it('gives a file estimated past the budget a group of its own', () => {
    const groups = partitionManifest(
      [entry('a.ts', 'large'), entry('b.ts', 'large'), entry('c.ts', 'large')],
      7_000,
    );
    assert.deepEqual(
      groups.map((group) => group.map((item) => item.path)),
      [['a.ts'], ['b.ts'], ['c.ts']],
    );
  });
});

describe('splitting a group that ran out of room', () => {
  it('halves it by estimate, keeping the order', () => {
    const [first, second] = splitGroup([
      entry('a.ts', 'large'),
      entry('b.ts', 'small'),
      entry('c.ts', 'small'),
      entry('d.ts', 'large'),
    ]);
    assert.deepEqual(
      first.map((item) => item.path),
      ['a.ts', 'b.ts'],
    );
    assert.deepEqual(
      second.map((item) => item.path),
      ['c.ts', 'd.ts'],
    );
  });

  it('refuses to split one file', () => {
    assert.throws(() => splitGroup([entry('a.ts')]), RangeError);
  });
});

describe('what a group is called while it is written', () => {
  it('names pages, components and setup in plain words', () => {
    assert.equal(
      describeGroup([entry('src/pages/ServicesPage.tsx', 'large')]),
      'services page',
    );
    assert.equal(
      describeGroup([
        entry('src/pages/about-us.tsx', 'large'),
        entry('src/pages/Contact.tsx', 'large'),
      ]),
      'about us and contact pages',
    );
    assert.equal(
      describeGroup([
        entry('src/components/ui/button.tsx'),
        entry('src/components/ui/card.tsx'),
      ]),
      'interface components',
    );
    assert.equal(
      describeGroup([entry('package.json'), entry('src/styles.css')]),
      'project setup',
    );
    assert.equal(
      groupLabel(3, 6, [entry('src/pages/ServicesPage.tsx')]),
      'Writing 3 of 6: services page',
    );
  });

  it('reduces a path the model chose to plain letters', () => {
    const label = describeGroup([
      entry('src/pages/<img src=x onerror=alert(1)>.tsx', 'large'),
    ]);
    assert.match(label, /^[a-z0-9 ]+$/);
  });
});

describe('completing an outline', () => {
  const outline = {
    summary: 'A site.',
    spec: SPEC,
    manifest: [
      entry('src/App.tsx', 'medium'),
      entry('src/App.tsx', 'large'),
      entry(DESIGN_MD_PATH),
      entry('src/pages/Home.tsx', 'large', ['src/pages/Home.tsx']),
    ],
    delete: [],
  };

  it('plans each file once, never DESIGN.md when there is a spec, and never a self-dependency', () => {
    const plan = normaliseOutline(outline, []);
    const paths = plan.manifest.map((item) => item.path);
    assert.equal(paths.filter((path) => path === 'src/App.tsx').length, 1);
    assert.ok(!paths.includes(DESIGN_MD_PATH));
    assert.deepEqual(
      plan.manifest.find((item) => item.path === 'src/pages/Home.tsx')
        ?.dependsOn,
      [],
    );
  });

  it('lets the model write DESIGN.md itself when there is no spec', () => {
    const { spec: _spec, ...specless } = outline;
    const plan = normaliseOutline(specless, []);
    assert.ok(plan.manifest.some((item) => item.path === DESIGN_MD_PATH));
  });

  it('adds every required file a new project would lack', () => {
    const plan = normaliseOutline(outline, []);
    const paths = new Set(plan.manifest.map((item) => item.path));
    for (const path of REQUIRED_PROJECT_FILES) assert.ok(paths.has(path), path);
  });

  it('deletes only existing files, never one it writes or one every project needs', () => {
    const plan = normaliseOutline(
      {
        ...outline,
        manifest: [entry('src/pages/Home.tsx', 'large')],
        delete: [
          'src/pages/Blog.tsx',
          'src/pages/Home.tsx',
          'package.json',
          'not-there.ts',
          DESIGN_MD_PATH,
        ],
      },
      [
        'package.json',
        'src/pages/Blog.tsx',
        'src/pages/Home.tsx',
        DESIGN_MD_PATH,
      ],
    );
    assert.deepEqual(plan.deletions, ['src/pages/Blog.tsx']);
    assert.ok(plan.kept.includes('package.json'));
    assert.ok(plan.kept.includes(DESIGN_MD_PATH));
  });
});

describe('a large request, as it failed on 2026-09-29', () => {
  it('truncates when asked for in one response, and completes in bounded steps', async () => {
    const script = companySite();

    // The old shape: one response, the model's whole ceiling. Exactly what
    // ran nineteen minutes and came back with nothing.
    const single = new PlanProvider(createScriptedBuildClient(script), {
      model: MODEL,
      maxTokens: maxTokensFor(MODEL),
    });
    await assert.rejects(
      single.generate({ prompt: 'A full website for North Star Systems.' }),
      ProviderTruncationError,
    );

    // The same model and the same money, in bounded steps.
    const { result, hooks, client } = await build(script);
    assert.equal(result.ok, true, result.failure?.message ?? '');
    const written = new Map(
      result.patch!.files.map((item) => [item.path, item.content]),
    );
    for (const item of script.files) {
      assert.equal(written.get(item.path), item.content, item.path);
    }

    // No call was allowed anything like the ceiling that failed.
    const [outline, ...groups] = client.requests;
    assert.ok(outline!.maxTokens <= OUTLINE_MAX_TOKENS);
    for (const request of groups) {
      assert.ok(request.maxTokens <= GROUP_MAX_TOKENS);
      assert.ok(requestedPaths(request.prompt).length > 0);
    }
    assert.equal(result.calls, client.requests.length);

    // What the builder shows while it works.
    assert.equal(hooks.labels[0], OUTLINE_LABEL);
    const total = hooks.labels.length - 1;
    assert.equal(hooks.labels[1], `Writing 1 of ${total}: project setup`);
    assert.ok(
      hooks.labels.includes(
        `Writing ${total - 2} of ${total}: fractional and readiness pages`,
      ),
      hooks.labels.join('\n'),
    );

    // And as a whole project, DESIGN.md rendered from the spec.
    const plan = applyBoundedPatch(result.patch!, undefined);
    const record = plan.files.find((item) => item.path === DESIGN_MD_PATH);
    assert.deepEqual(readDesignSpec(record!.content), SPEC);
    assert.equal(plan.files.length, script.files.length + 1);
  });

  it('shares one cached prefix across every file-writing step', async () => {
    const { result, client } = await build(companySite());
    const groups = client.requests.slice(1);
    const prefixes = new Set(groups.map((request) => request.cachePrefix));
    assert.equal(prefixes.size, 1);
    assert.ok([...prefixes][0]!.includes('--- BEGIN PLAN ---'));
    // Written once, read by every step after the first.
    assert.ok(result.usage.cacheReadInputTokens > 0);
    assert.ok(result.usage.cacheWriteInputTokens > 0);
    assert.ok(
      result.usage.cacheReadInputTokens > result.usage.cacheWriteInputTokens,
    );
  });

  it('sends each step the files it depends on, and not the whole project', async () => {
    const { client } = await build(companySite());
    const pageStep = client.requests.find((request) =>
      requestedPaths(request.prompt).includes('src/pages/HomePage.tsx'),
    )!;
    assert.ok(pageStep.prompt.includes('// src/components/SiteLayout.tsx'));
    assert.ok(!pageStep.prompt.includes('// src/components/ui/tabs.tsx'));
  });

  it('names the dependencies too large to send rather than sending them', async () => {
    // App.tsx imports every page. It needs their exports, which the
    // manifest states, not their contents.
    const { client } = await build(companySite());
    const appStep = client.requests.find((request) =>
      requestedPaths(request.prompt).includes('src/App.tsx'),
    )!;
    assert.ok(appStep.prompt.length < GROUP_CONTEXT_MAX_CHARS + 2_000);
    assert.match(appStep.prompt, /exist but are not shown/);
    assert.ok(appStep.prompt.includes('"src/pages/ContactPage.tsx"'));
  });
});

describe('a group that runs out of room', () => {
  const tight: ScriptedBuild = {
    summary: 'A site.',
    files: [
      ...requiredFiles(),
      // Planned as small and far larger: about 40,000 tokens in one group,
      // past the 32,000 a group is given, where each alone fits.
      file('src/components/One.tsx', 80_000),
      file('src/components/Two.tsx', 80_000),
    ],
  };

  it('is split in two and asked again, down to what fits', async () => {
    const { result, hooks } = await build(tight);
    assert.equal(result.ok, true, result.failure?.message ?? '');
    const truncated = hooks.names.find((name) =>
      hooks.names.includes(`${name}.1`),
    );
    assert.ok(truncated, hooks.names.join(', '));
    assert.ok(hooks.names.includes(`${truncated}.2`));
    const paths = result.patch!.files.map((item) => item.path);
    for (const name of ['One', 'Two']) {
      assert.ok(paths.includes(`src/components/${name}.tsx`));
    }
  });

  it('fails naming the file when one file alone does not fit, and keeps the bill', async () => {
    const { result, client } = await build({
      summary: 'A site.',
      files: [
        ...requiredFiles(),
        file('src/pages/Everything.tsx', 200_000, 'large'),
      ],
    });
    assert.equal(result.ok, false);
    assert.equal(result.failure?.stop, 'model-truncated');
    assert.match(result.failure!.message, /src\/pages\/Everything\.tsx/);
    // Every call that was made is in the usage, the cut-off one included.
    assert.equal(result.calls, client.requests.length);
    assert.ok(result.usage.outputTokens >= GROUP_MAX_TOKENS);
  });

  it('keeps what earlier groups wrote when a later one fails', async () => {
    const hooks = inProcess();
    const { result } = await build(
      {
        summary: 'A site.',
        files: [
          ...requiredFiles(),
          file('src/pages/Last.tsx', 200_000, 'large'),
        ],
      },
      hooks,
    );
    assert.equal(result.ok, false);
    // The groups before the failure were made once and not repeated.
    assert.equal(new Set(hooks.names).size, hooks.names.length);
    assert.ok(hooks.names.includes('write-1'));
  });
});

describe('a group that comes back short', () => {
  it('asks again for the files it left out, and only those', async () => {
    const { result, hooks, client } = await build(
      { summary: 'A site.', files: requiredFiles() },
      inProcess(),
      { omitOnce: ['README.md'] },
    );
    assert.equal(result.ok, true, result.failure?.message ?? '');
    const rest = hooks.names.find((name) => name.endsWith('.rest'));
    assert.ok(rest, hooks.names.join(', '));
    assert.deepEqual(requestedPaths(client.requests.at(-1)!.prompt), [
      'README.md',
    ]);
  });

  it('asks once more when the reply is the wrong shape, then gives up', async () => {
    const { result, hooks } = await build(
      { summary: 'A site.', files: requiredFiles() },
      inProcess(),
      { malformOnce: 'file_group' },
    );
    assert.equal(result.ok, true, result.failure?.message ?? '');
    assert.ok(hooks.names.includes('write-1.again'));
  });

  it('stops at a refusal', async () => {
    const { result } = await build(
      { summary: 'A site.', files: requiredFiles() },
      inProcess(),
      { refuse: 'file_group' },
    );
    assert.equal(result.failure?.stop, 'model-refused');
    assert.ok(result.usage.inputTokens > 0);
  });
});

describe('the outline', () => {
  it('is asked for again more briefly when it runs out of room, then fails plainly', async () => {
    const huge: ScriptedBuild = {
      summary: 'A site.',
      files: Array.from({ length: 50 }, (_, index) => ({
        ...file(`src/components/C${index}.tsx`, 100),
        purpose: 'y'.repeat(2_000),
      })),
    };
    const { result, hooks, client } = await build(huge);
    assert.deepEqual(hooks.names, ['outline', 'outline.again']);
    assert.equal(client.requests[1]!.effort, 'low');
    assert.equal(result.failure?.stop, 'model-truncated');
    assert.match(result.failure!.message, /Ask for fewer pages/);
  });

  it('fits on the retry when thinking, not the plan, filled the first reply', async () => {
    // Try-generation run 36565232849: DeepSeek Flash thought through the
    // whole 16,000 on both attempts of a full site's outline. The retry is
    // asked at low effort, and a model that honours it thinks less there,
    // so the same plan fits the second time.
    const { result, hooks, client } = await build(
      { summary: 'A site.', spec: SPEC, files: requiredFiles() },
      inProcess(),
      { thinking: { high: OUTLINE_MAX_TOKENS, low: 2_000 } },
    );
    assert.equal(result.ok, true, result.failure?.message ?? '');
    assert.deepEqual(hooks.names.slice(0, 2), ['outline', 'outline.again']);
    assert.equal(client.requests[0]!.effort, 'high');
    assert.equal(client.requests[1]!.effort, 'low');
  });

  it('refuses a plan with more files than a project may hold, before writing any', async () => {
    const { result, client } = await build({
      summary: 'A site.',
      files: Array.from({ length: MAX_PLANNED_FILES + 1 }, (_, index) =>
        file(`src/components/C${index}.tsx`, 10),
      ),
    });
    assert.equal(result.failure?.stop, 'validation-failed');
    assert.equal(client.requests.length, 1);
  });
});

describe('the run budget', () => {
  it('never gives a call more output than is left, and stops before a call that cannot help', async () => {
    const { result, client } = await build(
      companySite(),
      inProcess(),
      {},
      {
        outputTokens: 40_000,
        inputChars: 4_000_000,
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.failure?.stop, 'run-budget-exceeded');
    assert.ok(result.usage.outputTokens <= 40_000);
    // Each call was given at most what was left, and none was started with
    // less than a call can use.
    for (const request of client.requests) {
      assert.ok(request.maxTokens <= 40_000);
      assert.ok(request.maxTokens >= 4_000);
    }
  });

  it('makes no call whose prompt would pass what is left of the input budget', async () => {
    const { result, client } = await build(
      companySite(),
      inProcess(),
      {},
      {
        outputTokens: buildOutputBudgetFor(MODEL),
        inputChars: 200_000,
      },
    );
    assert.equal(result.failure?.stop, 'run-budget-exceeded');
    const sent = client.requests.reduce(
      (sum, request) =>
        sum +
        request.system.length +
        (request.cachePrefix?.length ?? 0) +
        request.prompt.length,
      0,
    );
    assert.ok(sent <= 200_000);
  });

  it('gives every model a per-call ceiling it can write inside the wall-clock budget', () => {
    for (const model of MODEL_CATALOGUE) {
      const ceiling = callCeilingFor(model.id, GROUP_MAX_TOKENS);
      assert.ok(ceiling <= model.maxOutputTokens, model.id);
      assert.ok(
        ceiling / outputTokensPerSecondFor(model.id) <=
          RUN_WALL_CLOCK_BUDGET_MS / 1000,
        model.id,
      );
    }
  });
});

describe('what each call says before and after it is made (D65)', () => {
  it('names the step and its ceilings before the call, and its record after, inside the step', async () => {
    const events: string[] = [];
    const started: {
      name: string;
      maxTokens: number;
      maxInputTokens: number;
    }[] = [];
    const finished = new Map<string, number>();
    let inside = false;
    const hooks = {
      ...inProcess(),
      step: async <T>(name: string, run: () => Promise<T>) => {
        inside = true;
        events.push(`step ${name}`);
        try {
          return await run();
        } finally {
          inside = false;
        }
      },
      beforeCall: (
        _label: string,
        _before: number,
        call: { name: string; maxTokens: number; maxInputTokens: number },
      ) => {
        assert.ok(inside, 'said outside its step');
        events.push(`before ${call.name}`);
        started.push(call);
      },
      afterCall: (
        name: string,
        record: { usage: { outputTokens: number } },
      ) => {
        assert.ok(inside, 'recorded outside its step');
        events.push(`after ${name}`);
        finished.set(name, record.usage.outputTokens);
      },
    };
    const { result, client } = await build(companySite(), hooks);
    assert.ok(result.ok);
    assert.equal(started.length, client.requests.length);
    assert.deepEqual(
      started.map((call) => call.name),
      [...finished.keys()],
    );
    // Each call is given what it said it would be given.
    for (const [at, call] of started.entries()) {
      assert.equal(call.maxTokens, client.requests[at]!.maxTokens);
      assert.ok(call.maxInputTokens > 0);
    }
    assert.deepEqual(events.slice(0, 3), [
      'step outline',
      'before outline',
      'after outline',
    ]);
  });
});

describe('a durable run replayed from its stored steps', () => {
  it('calls the model for nothing already done, and comes to the same result', async () => {
    const stored = new Map<string, unknown>();
    const durable = (): BoundedBuildHooks & { names: string[] } => {
      const names: string[] = [];
      return {
        names,
        step: async <T>(name: string, run: () => Promise<T>): Promise<T> => {
          names.push(name);
          if (stored.has(name)) {
            return JSON.parse(JSON.stringify(stored.get(name))) as T;
          }
          const value = await run();
          // As a Workflow stores it: plain JSON.
          stored.set(name, JSON.parse(JSON.stringify(value)));
          return value;
        },
      };
    };
    const script = companySite();
    const first = durable();
    const firstRun = await build(script, first as ReturnType<typeof inProcess>);
    const second = durable();
    const replay = await build(script, second as ReturnType<typeof inProcess>);

    assert.equal(replay.client.requests.length, 0);
    assert.deepEqual(second.names, first.names);
    assert.equal(new Set(first.names).size, first.names.length);
    assert.deepEqual(replay.result, firstRun.result);
  });
});

describe('a follow-up, as a patch', () => {
  const base = {
    revision: 'r0000base',
    files: [
      { path: 'package.json', content: '{"name":"site"}' },
      { path: 'index.html', content: '<!doctype html>' },
      { path: 'vite.config.ts', content: 'export default {};' },
      { path: 'tsconfig.json', content: '{}' },
      { path: 'src/main.tsx', content: 'import "./styles.css";' },
      {
        path: 'src/App.tsx',
        content: 'export function App() { return <Home />; }',
      },
      { path: 'src/styles.css', content: ':root { --primary: #000; }' },
      { path: 'src/lib/utils.ts', content: 'export const cn = () => "";' },
      { path: 'README.md', content: '# Site' },
      {
        path: 'src/pages/Home.tsx',
        content: 'export const Home = () => null;',
      },
      {
        path: 'src/pages/Blog.tsx',
        content: 'export const Blog = () => null;',
      },
      { path: DESIGN_MD_PATH, content: '# the old record' },
    ],
  };

  it('adds, replaces and deletes what it names, and carries every other file over', async () => {
    const client = createScriptedBuildClient({
      summary: 'Added a pricing page and dropped the blog.',
      spec: SPEC,
      files: [
        file('src/pages/Pricing.tsx', 2_000, 'medium', ['src/styles.css']),
        {
          path: 'src/App.tsx',
          content: 'export function App() { return <Pricing />; }',
          size: 'small',
          dependsOn: ['src/pages/Pricing.tsx'],
        },
      ],
      delete: ['src/pages/Blog.tsx'],
    });
    const provider = new BoundedPlanProvider(client, { model: MODEL });
    const plan = await provider.generate({ prompt: 'Add pricing', base });
    const byPath = new Map(plan.files.map((item) => [item.path, item.content]));

    assert.ok(byPath.has('src/pages/Pricing.tsx'));
    assert.equal(
      byPath.get('src/App.tsx'),
      'export function App() { return <Pricing />; }',
    );
    assert.equal(byPath.has('src/pages/Blog.tsx'), false);
    for (const kept of ['package.json', 'src/pages/Home.tsx', 'README.md']) {
      assert.equal(
        byPath.get(kept),
        base.files.find((item) => item.path === kept)!.content,
        kept,
      );
    }
    // The record follows the spec, as it always has.
    assert.deepEqual(readDesignSpec(byPath.get(DESIGN_MD_PATH)!), SPEC);

    // The outline saw the whole project; the step that rewrote App.tsx saw
    // its current content and what it imports, and not the whole project.
    assert.ok(client.requests[0]!.prompt.includes('src/pages/Blog.tsx'));
    const appStep = client.requests.find((request) =>
      requestedPaths(request.prompt).includes('src/App.tsx'),
    )!;
    assert.ok(appStep.prompt.includes('return <Home />'));
    assert.ok(!appStep.prompt.includes('export const Blog'));
  });

  it('keeps the design record it had when the outline has no spec', async () => {
    const client = createScriptedBuildClient({
      summary: 'A tweak.',
      files: [{ path: 'README.md', content: '# Site, updated' }],
    });
    const plan = await new BoundedPlanProvider(client, {
      model: MODEL,
    }).generate({ prompt: 'Update the README', base });
    assert.equal(
      plan.files.find((item) => item.path === DESIGN_MD_PATH)?.content,
      '# the old record',
    );
    assert.equal(plan.files.length, base.files.length);
  });

  it('stops without spending more once the project it edits has moved on', async () => {
    const client = createScriptedBuildClient({
      summary: 'A tweak.',
      files: [{ path: 'README.md', content: '# Site, updated' }],
    });
    let reads = 0;
    const result = await runBoundedBuild(
      new BoundedBuilder(client, { model: MODEL }),
      {
        prompt: 'Update the README',
        baseRevision: base.revision,
        // The first read is the revision asked for; after that another tab
        // has promoted something else.
        loadBase: async () =>
          reads++ === 0 ? base : { ...base, revision: 'r0000next' },
        budget: BUDGET,
      },
      inProcess(),
    );
    assert.equal(result.failure?.stop, 'conflict');
    assert.equal(client.requests.length, 1);
  });

  it('is never applied onto a project other than the one it was planned against', () => {
    assert.throws(
      () =>
        applyBoundedPatch(
          {
            summary: 's',
            files: [],
            delete: [],
            baseRevision: 'r0000base',
          },
          { ...base, revision: 'r0000next' },
        ),
      (error: unknown) =>
        error instanceof BoundedBuildError && error.stop === 'conflict',
    );
  });

  it('replaces the whole project on a new build, whatever was there', () => {
    const plan = applyBoundedPatch(
      {
        summary: 's',
        files: [{ path: 'package.json', content: '{}' }],
        delete: [],
      },
      base,
    );
    assert.deepEqual(
      plan.files.map((item) => item.path),
      ['package.json'],
    );
  });
});

describe('BoundedPlanProvider', () => {
  it('reports the usage of every call once, summed, failed calls included', async () => {
    const reports: number[] = [];
    const client = createScriptedBuildClient(
      { summary: 'A site.', files: requiredFiles() },
      { refuse: 'file_group' },
    );
    const provider = new BoundedPlanProvider(client, {
      model: MODEL,
      onUsage: (usage) => reports.push(usage.outputTokens),
    });
    await assert.rejects(
      provider.generate({ prompt: 'A site' }),
      (error: unknown) =>
        error instanceof BoundedBuildError && error.stop === 'model-refused',
    );
    assert.equal(reports.length, 1);
    assert.ok(reports[0]! > 0);
  });

  it('reports progress counted across the whole run, not per call', async () => {
    const seen: number[] = [];
    const steps: string[] = [];
    const provider = new BoundedPlanProvider(
      createScriptedBuildClient(companySite()),
      {
        model: MODEL,
        onProgress: (progress) => seen.push(progress.characters),
        onStep: (label) => steps.push(label),
      },
    );
    await provider.generate({ prompt: 'A site' });
    for (let at = 1; at < seen.length; at += 1) {
      assert.ok(seen[at]! >= seen[at - 1]!, 'the count went backwards');
    }
    assert.equal(steps[0], OUTLINE_LABEL);
    assert.equal(steps.length, seen.length);
  });
});
