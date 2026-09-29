import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAIN_TSX,
  PROJECT_SCRIPTS,
  SCAFFOLD_PATHS,
  SCAFFOLD_SECTION,
  TSCONFIG,
  UTILS_TS,
  VITE_CONFIG,
  extraDependencies,
  importedPackages,
  indexHtml,
  retitledIndexHtml,
  isSimpleRange,
  packageNameFor,
  packageOf,
  scaffoldFiles,
  scaffoldText,
  withImportedDependencies,
  withScaffold,
} from '../src/scaffold.ts';
import { OPTIONAL_PACKAGES, stackDependencies } from '../src/stack.ts';
import {
  GROUP_SYSTEM_PROMPT,
  OUTLINE_SYSTEM_PROMPT,
  REQUIRED_PROJECT_FILES,
} from '../src/plan-schema.ts';

const APP = {
  path: 'src/App.tsx',
  content: `import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { Hero } from './components/Hero.tsx';

export default function App() {
  return <motion.main className={cn('min-h-dvh')}><Hero /></motion.main>;
}
`,
};
const STYLES = {
  path: 'src/styles.css',
  content: `@import url('https://fonts.googleapis.com/css2?family=Fraunces');
@import "tailwindcss";
@import "tw-animate-css";
`,
};

function parsed(content: string): Record<string, Record<string, string>> {
  return JSON.parse(content) as Record<string, Record<string, string>>;
}

describe("Vibld's own files (D71)", () => {
  it('are the required files the model no longer writes', () => {
    for (const path of SCAFFOLD_PATHS) {
      assert.ok(
        (REQUIRED_PROJECT_FILES as readonly string[]).includes(path),
        path,
      );
    }
    const left = REQUIRED_PROJECT_FILES.filter(
      (path) => !(SCAFFOLD_PATHS as readonly string[]).includes(path),
    );
    assert.deepEqual(left, ['src/App.tsx', 'src/styles.css']);
  });

  it('are written in full for a new project, from the stack and the plan', () => {
    const files = scaffoldFiles(
      {
        title: 'Crumb & Co. Bakery',
        description: 'Bread on Elm Street, "daily".',
      },
      [APP, STYLES],
    );
    assert.deepEqual(
      files.map((file) => file.path),
      [...SCAFFOLD_PATHS],
    );
    const byPath = new Map(files.map((file) => [file.path, file.content]));

    const pkg = parsed(byPath.get('package.json')!);
    const stack = stackDependencies();
    assert.equal(pkg.name as unknown as string, 'crumb-co-bakery');
    assert.deepEqual(pkg.scripts, { ...PROJECT_SCRIPTS });
    assert.deepEqual(pkg.dependencies, stack.dependencies);
    assert.deepEqual(pkg.devDependencies, stack.devDependencies);

    const html = byPath.get('index.html')!;
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<meta name="viewport"/);
    assert.match(html, /<title>Crumb &amp; Co\. Bakery<\/title>/);
    assert.match(html, /content="Bread on Elm Street, &quot;daily&quot;\."/);
    assert.match(html, /src="\/src\/main\.tsx"/);

    assert.deepEqual(JSON.parse(byPath.get('tsconfig.json')!), TSCONFIG);
    assert.equal(byPath.get('vite.config.ts'), VITE_CONFIG);
    assert.equal(byPath.get('src/main.tsx'), MAIN_TSX);
    assert.equal(byPath.get('src/lib/utils.ts'), UTILS_TS);

    const readme = byPath.get('README.md')!;
    assert.match(readme, /^# Crumb & Co\. Bakery\n/);
    for (const name of Object.keys(PROJECT_SCRIPTS)) {
      assert.ok(readme.includes(`npm run ${name}`), name);
    }
    assert.match(readme, /npm install/);
    assert.match(readme, /`src\/App\.tsx`/);
    assert.ok(!readme.includes('src/components/ui/'));
  });

  it('agree with each other and with what the prompt says about them', () => {
    // The alias is stated once and written into both configurations.
    assert.deepEqual(TSCONFIG.compilerOptions.paths, { '@/*': ['./src/*'] });
    assert.match(VITE_CONFIG, /'@': fileURLToPath\(new URL\('\.\/src'/);
    assert.match(VITE_CONFIG, /plugins: \[react\(\), tailwindcss\(\)\]/);
    assert.ok(!('baseUrl' in TSCONFIG.compilerOptions));
    assert.equal(TSCONFIG.compilerOptions.verbatimModuleSyntax, true);
    assert.equal(TSCONFIG.compilerOptions.isolatedModules, true);
    // main.tsx takes App as the default export the prompt asks for.
    assert.match(MAIN_TSX, /^import App from '\.\/App\.tsx';$/m);
    assert.match(MAIN_TSX, /^import '\.\/styles\.css';$/m);
    assert.match(UTILS_TS, /export function cn\(/);

    for (const prompt of [OUTLINE_SYSTEM_PROMPT, GROUP_SYSTEM_PROMPT]) {
      assert.ok(prompt.includes(SCAFFOLD_SECTION));
      for (const path of SCAFFOLD_PATHS) assert.ok(prompt.includes(path), path);
      assert.ok(prompt.includes("import { cn } from '@/lib/utils'"));
      assert.ok(prompt.includes('export default function App()'));
      assert.ok(!prompt.includes("You write this project's tsconfig.json"));
      assert.ok(!prompt.includes('Declare exactly these packages'));
      assert.equal(prompt.includes(String.fromCharCode(0x2014)), false);
    }
    for (const [name, command] of Object.entries(PROJECT_SCRIPTS)) {
      assert.ok(SCAFFOLD_SECTION.includes(`"${name}" (${command})`), name);
    }
  });

  it('never use the character the house rules ban', () => {
    const files = scaffoldFiles(
      { title: 'A site', description: 'One sentence.' },
      [APP, STYLES],
    );
    for (const file of files) {
      assert.equal(
        file.content.includes(String.fromCharCode(0x2014)),
        false,
        file.path,
      );
    }
  });
});

describe('the title and description', () => {
  it('fall back to the summary when the outline has none', () => {
    assert.deepEqual(
      scaffoldText({ summary: 'A one-page site for a bakery.' }),
      {
        title: 'A one-page site for a bakery',
        description: 'A one-page site for a bakery.',
      },
    );
  });

  it('are one line each, and bounded', () => {
    const text = scaffoldText({
      title: `A\nvery ${'long '.repeat(40)}title`,
      description: 'Two\n\nlines.',
      summary: 'x',
    });
    assert.ok(!text.title.includes('\n'));
    assert.ok(text.title.length <= 80);
    assert.equal(text.description, 'Two lines.');
  });

  it('name the package npm will accept', () => {
    assert.equal(packageNameFor('Crumb & Co. Bakery'), 'crumb-co-bakery');
    assert.equal(packageNameFor('Café Élan'), 'cafe-elan');
    assert.equal(packageNameFor('!!!'), 'site');
  });

  it('are escaped in index.html', () => {
    assert.match(
      indexHtml('<script>', 'a "quote" & more'),
      /<title>&lt;script&gt;<\/title>/,
    );
  });
});

describe('the packages a project imports', () => {
  it('reads imports, re-exports, dynamic imports and stylesheet imports', () => {
    const found = importedPackages([
      {
        path: 'src/components/ui/command.tsx',
        content: `import * as React from 'react';
import type { VariantProps } from 'class-variance-authority';
import {
  Command as CommandPrimitive,
} from 'cmdk';
export { Slot } from '@radix-ui/react-slot';
import './local.css';
import { cn } from '@/lib/utils';
import { x } from '../lib/x.ts';
import { readFile } from 'node:fs/promises';
const Chart = lazy(() => import('recharts'));
`,
      },
      {
        path: 'src/styles.css',
        content: `@import url('https://fonts.googleapis.com/css2?family=Inter');
@import "tailwindcss";
@plugin "@tailwindcss/typography";
`,
      },
    ]);
    assert.deepEqual(found, [
      '@radix-ui/react-slot',
      '@tailwindcss/typography',
      'class-variance-authority',
      'cmdk',
      'react',
      'recharts',
      'tailwindcss',
    ]);
  });

  it('does not take copy on the page for an import', () => {
    const found = importedPackages([
      {
        path: 'src/components/Origin.tsx',
        content: `export function Origin() {
  return <p>We import our beans from 'huila' and ship from "portland".</p>;
}
export const note = 'import x from "left-pad"';
`,
      },
    ]);
    assert.deepEqual(found, []);
  });

  it('names the package a specifier belongs to', () => {
    assert.equal(packageOf('motion/react'), 'motion');
    assert.equal(packageOf('@scope/pkg/sub/path'), '@scope/pkg');
    assert.equal(packageOf('pkg?raw'), 'pkg');
    for (const local of [
      './App.tsx',
      '/abs',
      '@/lib/utils',
      'node:url',
      'fs',
      'https://x.test/a.js',
      'virtual:pwa',
      '@scope',
      'Not-Lowercase',
    ]) {
      assert.equal(packageOf(local), undefined, local);
    }
  });

  it('declares each package beyond the stack at the best range it has', () => {
    const extra = extraDependencies(
      [
        {
          path: 'src/a.tsx',
          content: `import { Command } from 'cmdk';
import { Chart } from 'recharts';
import { thing } from 'some-lib';
import { motion } from 'motion/react';
import { internal } from '@vibld/runtime';
`,
        },
      ],
      [
        { name: 'recharts', version: '^3.2.0' },
        { name: 'some-lib', version: 'latest' },
      ],
    );
    assert.deepEqual(extra, {
      cmdk: OPTIONAL_PACKAGES.cmdk,
      recharts: '^3.2.0',
      'some-lib': 'latest',
    });
  });

  it('takes only a simple range from an outline', () => {
    for (const ok of ['1', '1.2', '1.2.3', '^1.2.3', '~1.2', '1.2.3-beta.1']) {
      assert.ok(isSimpleRange(ok), ok);
    }
    for (const bad of ['latest', '*', '>=1', '1 || 2', 'git+https://x', '']) {
      assert.equal(isSimpleRange(bad), false, bad);
    }
  });

  it('go into package.json on a new project, and nothing declared goes in unimported', () => {
    const files = scaffoldFiles(
      {
        title: 'Site',
        description: 'A site.',
        dependencies: [
          { name: 'cmdk', version: '^1.1.0' },
          { name: 'unused', version: '^1.0.0' },
        ],
      },
      [
        APP,
        STYLES,
        {
          path: 'src/components/ui/command.tsx',
          content: "import { Command } from 'cmdk';\n",
        },
      ],
    );
    const pkg = parsed(
      files.find((file) => file.path === 'package.json')!.content,
    );
    assert.equal(pkg.dependencies!.cmdk, '^1.1.0');
    assert.equal(pkg.dependencies!.unused, undefined);
    assert.equal(
      pkg.dependencies!.react,
      stackDependencies().dependencies.react,
    );
  });
});

describe('a follow-up', () => {
  const base = [
    {
      path: 'package.json',
      content: `${JSON.stringify(
        {
          name: 'mine',
          dependencies: { motion: '^13.0.0', react: '^19.3.0' },
          devDependencies: {
            tailwindcss: '^4.0.0',
            'tw-animate-css': '^1.0.0',
          },
        },
        null,
        2,
      )}\n`,
    },
    { path: 'src/lib/utils.ts', content: 'export const cn = () => "";\n' },
    { path: 'src/main.tsx', content: "import App from './App.tsx';\n" },
    { path: 'vite.config.ts', content: 'export default {};\n' },
    { path: 'tsconfig.json', content: '{}\n' },
    { path: 'index.html', content: '<!doctype html><title>Mine</title>' },
    { path: 'README.md', content: '# Mine, edited by hand' },
    APP,
    STYLES,
  ];

  it('keeps the templated files the project has, byte for byte, when nothing new is imported', () => {
    const files = withScaffold(
      base,
      { title: 'Other', description: 'Other.' },
      true,
    );
    const byPath = new Map(files.map((file) => [file.path, file.content]));
    for (const file of base) assert.equal(byPath.get(file.path), file.content);
    assert.equal(files.length, base.length);
  });

  it('declares a package a file now imports, and changes nothing else in package.json', () => {
    const files = withScaffold(
      [
        ...base,
        {
          path: 'src/components/ui/command.tsx',
          content: "import { Command } from 'cmdk';\n",
        },
      ],
      { title: 'Other', description: 'Other.' },
      true,
    );
    const pkg = parsed(
      files.find((file) => file.path === 'package.json')!.content,
    );
    assert.equal(pkg.name as unknown as string, 'mine');
    assert.deepEqual(pkg.dependencies, {
      motion: '^13.0.0',
      react: '^19.3.0',
      cmdk: OPTIONAL_PACKAGES.cmdk,
    });
    assert.deepEqual(pkg.devDependencies, {
      tailwindcss: '^4.0.0',
      'tw-animate-css': '^1.0.0',
    });
  });

  it('writes a templated file the project lacks, and declares what it imports where the stack puts it', () => {
    const files = withScaffold(
      base.filter(
        (file) =>
          file.path !== 'src/lib/utils.ts' && file.path !== 'vite.config.ts',
      ),
      { title: 'Other', description: 'Other.' },
      true,
    );
    assert.deepEqual(
      files.find((file) => file.path === 'src/lib/utils.ts')?.content,
      UTILS_TS,
    );
    const pkg = parsed(
      files.find((file) => file.path === 'package.json')!.content,
    );
    const stack = stackDependencies();
    // utils.ts is written, and it imports clsx and tailwind-merge.
    assert.equal(pkg.dependencies!.clsx, stack.dependencies.clsx);
    assert.equal(
      pkg.dependencies!['tailwind-merge'],
      stack.dependencies['tailwind-merge'],
    );
    // vite.config.ts is written too, and its plugins are dev dependencies.
    assert.equal(pkg.devDependencies!.vite, stack.devDependencies.vite);
    assert.equal(
      pkg.devDependencies!['@vitejs/plugin-react'],
      stack.devDependencies['@vitejs/plugin-react'],
    );
    assert.equal(pkg.dependencies!.vite, undefined);
  });

  it('leaves a package.json it cannot read as it is', () => {
    assert.equal(
      withImportedDependencies('{ not json', [
        { path: 'a.ts', content: "import 'cmdk';" },
      ]),
      '{ not json',
    );
  });

  it('replaces a templated file the model wrote on a new project', () => {
    const files = withScaffold(
      [...base, { path: 'tsconfig.json', content: '{}' }],
      { title: 'New', description: 'New.' },
      false,
    );
    const tsconfig = files.filter((file) => file.path === 'tsconfig.json');
    assert.equal(tsconfig.length, 1);
    assert.deepEqual(JSON.parse(tsconfig[0]!.content), TSCONFIG);
    assert.equal(
      parsed(files.find((file) => file.path === 'package.json')!.content)
        .name as unknown as string,
      'new',
    );
  });
});

describe('renaming a site on a follow-up', () => {
  const HAND_EDITED = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="theme-color" content="#faf8f3" />
    <title data-owner="me">Crumb &amp; Co.</title>
    <meta content='Bread on Elm Street.' name='description'>
    <script defer src="https://plausible.io/js/script.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>
`;

  it('changes the title text, escaped, and nothing else', () => {
    const next = retitledIndexHtml(HAND_EDITED, { title: 'Rye & Salt' });
    assert.equal(
      next,
      HAND_EDITED.replace(
        '<title data-owner="me">Crumb &amp; Co.</title>',
        '<title data-owner="me">Rye &amp; Salt</title>',
      ),
    );
  });

  it("changes the description in the tag's own quotes, and nothing else", () => {
    const next = retitledIndexHtml(HAND_EDITED, {
      description: "Sourdough, <daily>, and the baker's rye.",
    });
    assert.equal(
      next,
      HAND_EDITED.replace(
        "content='Bread on Elm Street.'",
        "content='Sourdough, &lt;daily&gt;, and the baker&#39;s rye.'",
      ),
    );
  });

  it('leaves the file byte for byte when the values are what it already shows', () => {
    assert.equal(
      retitledIndexHtml(HAND_EDITED, {
        title: 'Crumb & Co.',
        description: '  Bread on Elm Street. ',
      }),
      HAND_EDITED,
    );
    assert.equal(retitledIndexHtml(HAND_EDITED, {}), HAND_EDITED);
    assert.equal(
      retitledIndexHtml(HAND_EDITED, { title: '  ', description: '' }),
      HAND_EDITED,
    );
  });

  it('adds a missing title or description before </head>', () => {
    const bare =
      '<!doctype html>\n<html>\n  <head>\n    <meta charset="UTF-8" />\n  </head>\n</html>\n';
    const next = retitledIndexHtml(bare, {
      title: 'Rye "&" Salt',
      description: 'Bread.',
    });
    assert.equal(
      next,
      '<!doctype html>\n<html>\n  <head>\n    <meta charset="UTF-8" />\n' +
        '    <title>Rye &quot;&amp;&quot; Salt</title>\n' +
        '    <meta name="description" content="Bread." />\n' +
        '  </head>\n</html>\n',
    );
  });

  it('happens only on a follow-up that gave a new title or description', () => {
    const base = [{ path: 'index.html', content: HAND_EDITED }];
    const renamed = withScaffold(
      base,
      { title: 'x', description: 'x', retitle: { title: 'Rye & Salt' } },
      true,
    ).find((file) => file.path === 'index.html')!;
    assert.match(renamed.content, /<title data-owner="me">Rye &amp; Salt</);
    const untouched = withScaffold(
      base,
      { title: 'Something else', description: 'Else.' },
      true,
    ).find((file) => file.path === 'index.html')!;
    assert.equal(untouched.content, HAND_EDITED);
  });
});
