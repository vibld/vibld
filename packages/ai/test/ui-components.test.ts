import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { VIBLD_MARK } from '../src/backdrops.ts';
import { normaliseOutline } from '../src/bounded-build.ts';
import { checkDesign } from '../src/design-checks.ts';
import {
  GROUP_SYSTEM_PROMPT,
  KEPT_SPEC_OUTLINE_SYSTEM_PROMPT,
  OUTLINE_SYSTEM_PROMPT,
  PLAN_SYSTEM_PROMPT,
} from '../src/plan-schema.ts';
import {
  isTemplatedPath,
  ownedTemplatePaths,
  withScaffold,
} from '../src/scaffold.ts';
import { OPTIONAL_PACKAGES } from '../src/stack.ts';
import { COLOR_NAMES } from '../src/theme-css.ts';
import {
  UI_API_SECTION,
  UI_COMPONENTS,
  UI_DIR,
  UI_FILES_SECTION,
  UI_TOKENS,
  importedUiComponents,
  isUiTemplatePath,
  uiComponentFiles,
  uiExports,
  uiPath,
} from '../src/ui-components.ts';

const EM_DASH = String.fromCodePoint(0x2014);

/** The sixteen D206 names. */
const NAMES = [
  'button',
  'input',
  'label',
  'textarea',
  'card',
  'badge',
  'separator',
  'dialog',
  'sheet',
  'tabs',
  'accordion',
  'select',
  'popover',
  'tooltip',
  'dropdown-menu',
  'command',
];

/**
 * The parts of each `radix-ui` namespace the sources use, read from
 * radix-ui 1.7.0's type declarations (`@radix-ui/react-*`'s `export {
 * ... as Root, ... }`) on 2026-10-11 rather than recalled.
 */
const RADIX_PARTS: Record<string, readonly string[]> = {
  Dialog: [
    'Root',
    'Trigger',
    'Portal',
    'Overlay',
    'Content',
    'Title',
    'Description',
    'Close',
  ],
  Label: ['Root'],
  Separator: ['Root'],
  Slot: ['Root', 'Slot', 'Slottable'],
  Tabs: ['Root', 'List', 'Trigger', 'Content'],
  Accordion: ['Root', 'Item', 'Header', 'Trigger', 'Content'],
  Select: [
    'Root',
    'Trigger',
    'Value',
    'Icon',
    'Portal',
    'Content',
    'Viewport',
    'Group',
    'Label',
    'Item',
    'ItemText',
    'ItemIndicator',
    'ScrollUpButton',
    'ScrollDownButton',
    'Separator',
    'Arrow',
  ],
  Popover: [
    'Root',
    'Anchor',
    'Trigger',
    'Portal',
    'Content',
    'Close',
    'Arrow',
    'Title',
    'Description',
  ],
  Tooltip: ['Provider', 'Root', 'Trigger', 'Portal', 'Content', 'Arrow'],
  DropdownMenu: [
    'Root',
    'Trigger',
    'Portal',
    'Content',
    'Group',
    'Label',
    'Item',
    'CheckboxItem',
    'RadioGroup',
    'RadioItem',
    'ItemIndicator',
    'Separator',
    'Arrow',
    'Sub',
    'SubTrigger',
    'SubContent',
  ],
};

/** cmdk 1.1.1's `Command` and the parts it carries, from its declarations. */
const CMDK_PARTS = [
  'Input',
  'List',
  'Empty',
  'Group',
  'Item',
  'Separator',
  'Dialog',
  'Loading',
];

/** The lucide-react icons the sources use, each checked against 1.x's declarations. */
const ICONS = [
  'XIcon',
  'ChevronDownIcon',
  'ChevronUpIcon',
  'ChevronRightIcon',
  'CheckIcon',
  'CircleIcon',
  'SearchIcon',
];

const app = (content: string) => ({ path: 'src/App.tsx', content });
const styles = { path: 'src/styles.css', content: '@import "tailwindcss";\n' };
const INPUT = { title: 'Site', description: 'A site.' };

function byName(name: string) {
  return UI_COMPONENTS.find((component) => component.name === name)!;
}

describe('the shadcn/ui components Vibld writes (D206)', () => {
  it('are the sixteen, each at src/components/ui/<name>.tsx', () => {
    assert.deepEqual(
      UI_COMPONENTS.map((component) => component.name),
      NAMES,
    );
    for (const component of UI_COMPONENTS) {
      assert.equal(uiPath(component), `${UI_DIR}/${component.name}.tsx`);
      assert.equal(isUiTemplatePath(uiPath(component)), true);
    }
    assert.equal(isUiTemplatePath('src/components/ui/checkbox.tsx'), false);
    assert.equal(isUiTemplatePath('src/components/Button.tsx'), false);
  });

  it('each open with a doc comment that carries the mark', () => {
    for (const component of UI_COMPONENTS) {
      const source = component.source;
      assert.ok(source.startsWith('/**\n'), component.name);
      const comment = source.slice(0, source.indexOf('*/'));
      assert.ok(comment.includes(VIBLD_MARK), component.name);
      assert.ok(!source.includes(EM_DASH), component.name);
      assert.ok(!source.includes('\r'), component.name);
      assert.ok(!source.includes('\t'), component.name);
    }
  });

  it("are shadcn's: radix-ui namespaces, data-slot, cn() and nothing else", () => {
    for (const component of UI_COMPONENTS) {
      const source = component.source;
      const imports = [...source.matchAll(/from '([^']+)'/g)].map(
        (match) => match[1]!,
      );
      for (const specifier of imports) {
        assert.ok(
          [
            'react',
            'radix-ui',
            'class-variance-authority',
            'lucide-react',
            'cmdk',
            '@/lib/utils',
          ].includes(specifier),
          `${component.name} imports ${specifier}`,
        );
      }
      assert.ok(imports.includes('@/lib/utils'), component.name);
      assert.match(source, /data-slot="/, component.name);
      assert.ok(!/@radix-ui\//.test(source), component.name);
      // A radix-ui namespace is never rendered as a component (D153).
      for (const match of source.matchAll(
        /import \{ (\w+)(?: as (\w+))? \} from 'radix-ui'/g,
      )) {
        const local = match[2] ?? match[1]!;
        assert.ok(
          !new RegExp(`<${local}[\\s/>]`).test(source),
          `${component.name} renders ${local}`,
        );
      }
    }
  });

  it('use only the radix-ui parts, cmdk parts and icons that exist', () => {
    for (const component of UI_COMPONENTS) {
      const source = component.source;
      for (const match of source.matchAll(
        /import \{ (\w+)(?: as (\w+))? \} from 'radix-ui'/g,
      )) {
        const namespace = match[1]!;
        const local = match[2] ?? namespace;
        const parts = RADIX_PARTS[namespace];
        assert.ok(parts, `${component.name}: ${namespace}`);
        for (const use of source.matchAll(
          new RegExp(`\\b${local}\\.(\\w+)`, 'g'),
        )) {
          assert.ok(
            parts.includes(use[1]!),
            `${component.name}: ${local}.${use[1]}`,
          );
        }
      }
      for (const use of source.matchAll(/\bCommandPrimitive\.(\w+)/g)) {
        assert.ok(CMDK_PARTS.includes(use[1]!), `command: ${use[1]}`);
      }
      const icons = /import \{([^}]+)\} from 'lucide-react'/.exec(source);
      for (const icon of icons?.[1]!.split(',') ?? []) {
        assert.ok(ICONS.includes(icon.trim()), `${component.name}: ${icon}`);
      }
    }
    // Button's asChild, the one people get wrong.
    assert.match(
      byName('button').source,
      /const Comp = asChild \? Slot\.Root : 'button';/,
    );
    assert.match(byName('button').source, /cva\(/);
    assert.match(byName('badge').source, /cva\(/);
  });

  it('stop every enter and exit animation under reduced motion', () => {
    for (const component of UI_COMPONENTS) {
      for (const literal of component.source.matchAll(/(['"])([^'"\n]*)\1/g)) {
        const classes = literal[2]!;
        if (/\banimate-(?:in|out|accordion-(?:up|down))\b/.test(classes)) {
          assert.match(
            classes,
            /motion-reduce:animate-none/,
            `${component.name}: ${classes.slice(0, 80)}`,
          );
        }
      }
    }
  });

  it('style only with tokens a generated project defines', () => {
    for (const token of UI_TOKENS) {
      assert.ok(COLOR_NAMES.includes(token), token);
    }
    for (const component of UI_COMPONENTS) {
      // shadcn's own names for these, which theme-css.ts does not emit, or
      // which a generated design often makes its loudest color.
      assert.ok(
        !/\b(?:bg|text|border|ring|fill|outline)-(?:popover|input|accent|sidebar|chart)\b/.test(
          component.source,
        ),
        component.name,
      );
    }
    assert.ok(UI_TOKENS.includes('background'));
    assert.ok(UI_TOKENS.includes('muted-foreground'));
  });

  it('name in the prompt every export a source has, and only those', () => {
    for (const component of UI_COMPONENTS) {
      const exports = uiExports(component);
      assert.ok(exports.length > 0, component.name);
      for (const name of exports) {
        assert.match(
          component.source,
          new RegExp(`(?:function|const) ${name}\\b`),
          `${component.name}: ${name}`,
        );
        assert.match(UI_API_SECTION, new RegExp(`\\b${name}\\b`), name);
      }
      for (const name of Object.keys(component.props)) {
        assert.ok(exports.includes(name), `${component.name}: ${name}`);
      }
    }
    // Every variant the prompt offers is one cva declares.
    for (const variant of [
      'destructive',
      'outline',
      'secondary',
      'ghost',
      'link',
      "'icon-sm'",
      "'icon-lg'",
    ]) {
      assert.match(byName('button').source, new RegExp(`${variant}:`));
    }
  });
});

describe('the prompt about them', () => {
  it('lists each component in the outline and the file steps', () => {
    for (const prompt of [
      OUTLINE_SYSTEM_PROMPT,
      KEPT_SPEC_OUTLINE_SYSTEM_PROMPT,
      GROUP_SYSTEM_PROMPT,
    ]) {
      assert.ok(prompt.includes(UI_FILES_SECTION));
      for (const name of NAMES)
        assert.match(prompt, new RegExp(`\\b${name}\\b`));
      assert.match(prompt, /Never plan, write or edit them/);
      // A project's own file at a reserved path stays the model's to edit
      // (ownedTemplatePaths), and the prompt says how to tell.
      assert.ok(
        prompt
          .replace(/\s+/g, ' ')
          .includes(`without the line "${VIBLD_MARK}"`),
      );
    }
    // The exports are for the steps that write code, and a project's own
    // file at one of the paths keeps its own API.
    assert.ok(GROUP_SYSTEM_PROMPT.includes(UI_API_SECTION));
    assert.ok(
      UI_API_SECTION.replace(/\s+/g, ' ').includes(
        'exports what that file declares instead',
      ),
    );
    assert.ok(!OUTLINE_SYSTEM_PROMPT.includes(UI_API_SECTION));
    for (const name of NAMES) {
      assert.match(UI_API_SECTION, new RegExp(`\\n- ${name}: `), name);
    }
    // The single-response build writes its own: nothing is templated there.
    assert.ok(!PLAN_SYSTEM_PROMPT.includes('COMPONENTS WRITTEN FOR YOU'));
  });

  it('meets the 44px target and the palette foregrounds', () => {
    const button = UI_COMPONENTS.find((c) => c.name === 'button')!.source;
    assert.match(button, /default: 'h-11 /);
    assert.match(button, /icon: 'size-11'/);
    const source = (name: string) =>
      UI_COMPONENTS.find((c) => c.name === name)!.source;
    assert.match(source('select'), /data-\[size=default\]:h-11/);
    for (const name of ['dialog', 'sheet']) {
      assert.match(
        source(name),
        /Close[\s\S]{0,160}size-11 cursor-pointer/,
        name,
      );
    }
    assert.match(source('tabs'), /min-h-11 min-w-11 /);
    assert.ok(!source('select').includes('cursor-default'));
    assert.match(source('command'), /'flex h-11 w-full rounded-md/);
    // CommandDialog's input clears its close button.
    assert.match(source('command'), /command-input-wrapper\]:pr-14/);
    for (const name of ['select', 'dropdown-menu', 'command']) {
      assert.match(source(name), /min-h-11 /, name);
    }
    for (const name of ['button', 'badge']) {
      const source = UI_COMPONENTS.find((c) => c.name === name)!.source;
      assert.ok(!source.includes('text-white'), name);
      assert.match(source, /bg-destructive text-destructive-foreground/, name);
    }
  });

  it('names the tokens they use, wrapped to the prompt width', () => {
    for (const token of UI_TOKENS.filter(
      (name) => !name.endsWith('-foreground'),
    )) {
      assert.match(UI_FILES_SECTION, new RegExp(`\\b${token}\\b`), token);
    }
    for (const line of UI_API_SECTION.split('\n')) {
      assert.ok(line.length <= 76, line);
    }
    assert.ok(!UI_API_SECTION.includes(EM_DASH));
  });
});

describe('scaffolding them', () => {
  const page = app(`import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Command, CommandInput } from '@/components/ui/command';
export default function App() {
  return <Dialog><DialogContent><DialogTitle>x</DialogTitle><Command><CommandInput /></Command><Button>Go</Button></DialogContent></Dialog>;
}
`);

  it('adds what a page imports, and declares cmdk', () => {
    const files = withScaffold([page, styles], INPUT, false);
    const byPath = new Map(files.map((file) => [file.path, file.content]));
    const ui = files
      .map((file) => file.path)
      .filter((path) => path.startsWith(`${UI_DIR}/`))
      .sort();
    assert.deepEqual(ui, [
      'src/components/ui/button.tsx',
      'src/components/ui/command.tsx',
      'src/components/ui/dialog.tsx',
    ]);
    assert.equal(
      byPath.get('src/components/ui/command.tsx'),
      byName('command').source,
    );
    const pkg = JSON.parse(byPath.get('package.json')!) as {
      dependencies: Record<string, string>;
    };
    assert.equal(pkg.dependencies.cmdk, OPTIONAL_PACKAGES.cmdk);
  });

  it('adds a command alone: no template imports another', () => {
    const only = app(
      "import { CommandDialog } from '@/components/ui/command';\nexport default function App() { return <CommandDialog />; }\n",
    );
    assert.deepEqual(importedUiComponents([only]), ['command']);
  });

  it('reads relative imports and extensions, and nothing that is not one', () => {
    const files = [
      {
        path: 'src/components/Header.tsx',
        content:
          "import { Sheet } from '../components/ui/sheet';\nimport { Badge } from './ui/badge.tsx';\nimport { Checkbox } from '@/components/ui/checkbox';\n",
      },
      {
        path: 'src/pages/Home.tsx',
        content:
          "export const copy = 'see src/components/ui/tabs';\nimport { Tooltip } from '../components/ui/tooltip';\n",
      },
    ];
    assert.deepEqual(importedUiComponents(files), [
      'badge',
      'sheet',
      'tooltip',
    ]);
  });

  it('drops a component the model wrote on a new project for the template', () => {
    const files = withScaffold(
      [
        page,
        styles,
        {
          path: 'src/components/ui/button.tsx',
          content: 'export const Button = () => null;\n',
        },
        {
          path: 'src/components/ui/tabs.tsx',
          content: 'export const Tabs = () => null;\n',
        },
      ],
      INPUT,
      false,
    );
    const byPath = new Map(files.map((file) => [file.path, file.content]));
    assert.equal(
      byPath.get('src/components/ui/button.tsx'),
      byName('button').source,
    );
    // Nothing imports tabs, so there is no file for it at all.
    assert.equal(byPath.has('src/components/ui/tabs.tsx'), false);
  });

  it("keeps a project's own component, which stays the model's to edit", () => {
    const own = {
      path: 'src/components/ui/button.tsx',
      content:
        "import { Slot } from '@radix-ui/react-slot';\nexport function Button() { return null; }\n",
    };
    const marked = {
      path: 'src/components/ui/dialog.tsx',
      content: byName('dialog').source,
    };
    const base = [page, styles, own, marked];
    assert.deepEqual(ownedTemplatePaths(base), [own.path]);
    const owned = new Set(ownedTemplatePaths(base));
    assert.equal(isTemplatedPath(own.path, owned), false);
    assert.equal(isTemplatedPath(own.path), true);
    assert.equal(isTemplatedPath(marked.path, owned), true);
    assert.equal(isTemplatedPath('src/components/ui/checkbox.tsx'), false);

    // A follow-up keeps both, and adds only the command it lacks.
    const files = withScaffold(
      [
        ...base,
        {
          path: 'package.json',
          content: '{"name":"mine","dependencies":{}}\n',
        },
      ],
      INPUT,
      true,
    );
    const byPath = new Map(files.map((file) => [file.path, file.content]));
    assert.equal(byPath.get(own.path), own.content);
    assert.equal(byPath.get(marked.path), marked.content);
    assert.equal(
      byPath.get('src/components/ui/command.tsx'),
      byName('command').source,
    );
    const pkg = JSON.parse(byPath.get('package.json')!) as {
      dependencies: Record<string, string>;
    };
    assert.equal(pkg.dependencies.cmdk, OPTIONAL_PACKAGES.cmdk);

    // And an outline may plan the project's own, never Vibld's.
    const plan = normaliseOutline(
      {
        summary: 'A change.',
        manifest: [own.path, marked.path, 'src/App.tsx'].map((path) => ({
          path,
          purpose: 'x',
          dependsOn: [],
          size: 'small' as const,
        })),
        delete: [],
      },
      base.map((file) => file.path),
      { owned: [...owned] },
    );
    assert.deepEqual(
      plan.manifest.map((entry) => entry.path),
      [own.path, 'src/App.tsx'],
    );
  });

  it('writes nothing when nothing imports one', () => {
    assert.deepEqual(
      uiComponentFiles([app('export default function App() { return null; }')]),
      [],
    );
  });

  it('adds no design finding of its own to a project', () => {
    const every = UI_COMPONENTS.map((component) => ({
      path: uiPath(component),
      content: component.source,
    }));
    const report = checkDesign([styles, ...every]);
    const named = [...report.errors, ...report.warnings].filter((finding) =>
      finding.detail.includes(`${UI_DIR}/`),
    );
    assert.deepEqual(named, []);
  });
});
