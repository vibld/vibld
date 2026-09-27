import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  dialectOf,
  expressionEnds,
  scriptSyntax,
} from '../src/script-syntax.ts';

describe('reading a script with the parser', () => {
  it('names the grammar from the file name', () => {
    assert.equal(dialectOf('src/a.ts'), 'ts');
    assert.equal(dialectOf('src/a.mts'), 'ts');
    assert.equal(dialectOf('src/A.tsx'), 'tsx');
    assert.equal(dialectOf('src/a.jsx'), 'js');
    assert.equal(dialectOf('src/a.mjs'), 'js');
    assert.equal(dialectOf('index.html'), undefined);
  });

  it('tells a pattern from a division', () => {
    const code = 'const n = {} / 2 / 3;\nif (ready) /{"<img>/g.test(s);';
    const syntax = scriptSyntax(code, 'ts')!;
    assert.equal(syntax.regexes.length, 1);
    const [regex] = syntax.regexes;
    assert.equal(code.slice(regex!.start, regex!.end), '/{"<img>/g');
    assert.equal(code[regex!.close], '/');
    assert.equal(code.slice(regex!.close), '/g.test(s);');
  });

  it('finds block and line comments, and says which is which', () => {
    const code = 'a(); /* one\n */ b(); // two';
    const syntax = scriptSyntax(code, 'js')!;
    assert.deepEqual(
      syntax.comments.map((c) => [code.slice(c.start, c.end), c.block]),
      [
        ['/* one\n */', true],
        ['// two', false],
      ],
    );
  });

  it('finds strings, JSX attribute values included, and not JSX text', () => {
    const code = `const a = 'x';\nconst b = <p title="t">Don't</p>;`;
    const syntax = scriptSyntax(code, 'tsx')!;
    assert.deepEqual(
      syntax.strings.map((s) => code.slice(s.start, s.end)),
      [`'x'`, `"t"`],
    );
  });

  it("names a template's tag, and marks one with no plain name", () => {
    const code = 'a = `x`; b = html`<p>`; c = styled.div`d`; e = styled(B)`f`;';
    const syntax = scriptSyntax(code, 'ts')!;
    assert.deepEqual(
      syntax.templates.map((t) => t.tag),
      [undefined, 'html', 'div', null],
    );
  });

  it('reads the text between a template literal interpolations', () => {
    const code = 'a = `one ${b} two`;';
    const [template] = scriptSyntax(code, 'ts')!.templates;
    assert.deepEqual(
      template!.quasis.map((q) => code.slice(q.start, q.end)),
      ['one ', ' two'],
    );
  });

  it('reads TypeScript, JSX and decorators together', () => {
    assert.ok(
      scriptSyntax(
        'type P = { alt?: string };\nclass V { constructor(@Inject(T) html: string) {} }\nexport const H = ({ alt }: P) => <img alt={alt} />;',
        'tsx',
      ),
    );
  });

  it('gives nothing back for script it cannot parse', () => {
    assert.equal(scriptSyntax('const = ;', 'ts'), undefined);
  });

  it('ends no expression at a property name', () => {
    const code = `const s = { animation: reduce ? 'none' : 'spin 1s', [key]: 1 };`;
    const ends = expressionEnds(code)!;
    assert.equal(ends.get(code.indexOf('animation')), undefined);
    const computed = code.indexOf('key');
    assert.equal(ends.get(computed), computed + 'key'.length);
    const value = code.indexOf('reduce');
    assert.equal(
      code.slice(value, ends.get(value)),
      "reduce ? 'none' : 'spin 1s'",
    );
  });
});
