import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  INSPECT_MESSAGE,
  INSPECTOR_SCRIPT,
  locatePick,
  locatePicks,
  readPick,
  withPicks,
} from '../src/preview-inspect.ts';
import type { PickedElement } from '../src/preview-inspect.ts';

const files = [
  {
    path: 'src/App.tsx',
    content: [
      "import { Hero } from './components/Hero';",
      'export default function App() {',
      '  return <Hero />;',
      '}',
    ].join('\n'),
  },
  {
    path: 'src/components/Hero.tsx',
    content: [
      'export function Hero() {',
      '  return (',
      '    <section className="hero">',
      '      <h1 className="hero__title">',
      '        Fresh roasted coffee, delivered',
      '      </h1>',
      '      <img src="/media/beans.jpg" alt="A bag of beans" />',
      '    </section>',
      '  );',
      '}',
    ].join('\n'),
  },
  { path: 'src/styles.css', content: '.hero__title { color: red; }' },
];

function element(overrides: Partial<PickedElement>): PickedElement {
  return {
    tag: 'h1',
    classes: [],
    text: '',
    attributes: {},
    components: [],
    ...overrides,
  };
}

describe('Select and Annotate on the preview (D188)', () => {
  it('is a script that parses, with nothing to import', () => {
    assert.doesNotThrow(() => new Function(INSPECTOR_SCRIPT));
    assert.doesNotMatch(INSPECTOR_SCRIPT, /\bimport\b|\brequire\(/);
    // Select keeps every press from reaching the app, pointer events too.
    for (const type of ['click', 'mousedown', 'pointerdown', 'pointerup']) {
      assert.match(INSPECTOR_SCRIPT, new RegExp(`'${type}', \\w+, true`));
    }
  });

  it('reads only its own messages, cut to size', () => {
    assert.equal(readPick({ source: 'other', kind: 'selected' }), null);
    assert.equal(
      readPick({ source: INSPECT_MESSAGE.fromPage, kind: 'mode' }),
      null,
    );
    const pick = readPick({
      source: INSPECT_MESSAGE.fromPage,
      kind: 'selected',
      elements: [
        {
          tag: 'H1',
          classes: ['hero__title', 42],
          text: `  ${'x'.repeat(400)}  `,
          attributes: { alt: 'a', onclick: 'steal()' },
          components: ['Hero', 'not a name!'],
          file: '/src/components/Hero.tsx',
          line: 4,
        },
        { tag: '<script>' },
      ],
    });
    assert.ok(pick);
    assert.equal(pick.kind, 'select');
    assert.equal(pick.elements.length, 1);
    const [first] = pick.elements;
    assert.equal(first?.tag, 'h1');
    assert.deepEqual(first?.classes, ['hero__title']);
    assert.equal(first?.text.length, 160);
    assert.deepEqual(first?.attributes, { alt: 'a' });
    assert.deepEqual(first?.components, ['Hero']);
    assert.equal(first?.file, 'src/components/Hero.tsx');
  });

  it('refuses a file path that climbs out of the project', () => {
    const pick = readPick({
      source: INSPECT_MESSAGE.fromPage,
      kind: 'annotated',
      elements: [{ tag: 'p', file: '../../etc/passwd' }],
    });
    assert.equal(pick?.kind, 'annotate');
    assert.equal(pick?.elements[0]?.file, undefined);
  });

  it("finds an element's text in the file the stack names", () => {
    assert.deepEqual(
      locatePick(
        element({
          text: 'Fresh roasted coffee, delivered',
          components: ['Hero', 'App'],
          file: 'src/components/Hero.tsx',
          line: 12,
        }),
        files,
      ),
      { path: 'src/components/Hero.tsx', line: 5 },
    );
  });

  it('picks the occurrence nearest the line the stack named', () => {
    const twice = [
      {
        path: 'src/Buttons.tsx',
        content: [
          'export function Buttons() {',
          '  return (',
          '    <div>',
          '      <button className="button">{first}</button>',
          '      <button className="button">{second}</button>',
          '    </div>',
          '  );',
          '}',
        ].join('\n'),
      },
    ];
    const pressed = (line?: number) =>
      locatePick(
        element({
          tag: 'button',
          classes: ['button'],
          file: 'src/Buttons.tsx',
          ...(line === undefined ? {} : { line }),
        }),
        twice,
      );
    assert.deepEqual(pressed(5), { path: 'src/Buttons.tsx', line: 5 });
    assert.deepEqual(pressed(), { path: 'src/Buttons.tsx', line: 4 });
  });

  it('takes the exact file the stack names over one its path ends with', () => {
    const both = [
      { path: 'components/Button.tsx', content: 'export const B = 1;' },
      { path: 'src/components/Button.tsx', content: 'export const B = 2;' },
    ];
    assert.equal(
      locatePick(
        element({ tag: 'button', file: 'src/components/Button.tsx', line: 1 }),
        both,
      )?.path,
      'src/components/Button.tsx',
    );
    assert.equal(
      locatePick(
        element({ tag: 'button', file: 'app/src/components/Button.tsx' }),
        both,
      )?.path,
      'src/components/Button.tsx',
    );
  });

  it('falls back to the component that renders it', () => {
    assert.deepEqual(
      locatePick(
        element({
          tag: 'img',
          attributes: { alt: 'A bag of beans' },
          components: ['Hero'],
        }),
        files,
      ),
      { path: 'src/components/Hero.tsx', line: 7 },
    );
  });

  it("names the component's definition when nothing else matches", () => {
    assert.deepEqual(
      locatePick(element({ tag: 'div', components: ['Hero'] }), files),
      { path: 'src/components/Hero.tsx', line: 1 },
    );
  });

  it('says nothing rather than guess', () => {
    assert.equal(
      locatePick(element({ tag: 'div', text: 'Not in any file' }), files),
      null,
    );
  });

  it('writes what was pointed at into the message', () => {
    const picks = [
      locatePicks(
        {
          kind: 'select',
          elements: [
            element({
              classes: ['hero__title'],
              text: 'Fresh roasted coffee, delivered',
              components: ['Hero'],
            }),
          ],
        },
        files,
      ),
    ];
    assert.equal(
      withPicks('Make this bigger  ', picks),
      [
        'Make this bigger',
        '',
        'Selected in the preview:',
        '- <h1 class="hero__title"> "Fresh roasted coffee, delivered" in Hero (src/components/Hero.tsx:5)',
      ].join('\n'),
    );
    assert.equal(withPicks('Unchanged', []), 'Unchanged');
    // Never past the server's limit: lines that do not fit are left off.
    const limited = withPicks('Make this bigger', picks, 40);
    assert.equal(limited, 'Make this bigger');
    assert.ok(withPicks('x'.repeat(50), picks, 40).length === 50);
  });
});
