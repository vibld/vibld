import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  EXCLUDE,
  isText,
  parseRefs,
  rewriteLinks,
  rewriteReferences,
} from './public-export.mjs';

// Assembled rather than written out: this file is exported too, and a
// literal issue URL here would be rewritten on the way out, leaving the
// public copy with a test whose inputs no longer say what it asserts.
const PUBLIC = ['https://github.com', 'vibld', 'vibld'].join('/');
const PRIVATE = ['https://github.com', 'vibld', 'vibld-internal'].join('/');
const SHA = 'a4e59c23bfaf31a6770ea2b95abf146538e3d8bb';

describe('rewriteLinks', () => {
  it('keeps the text of a markdown link to an issue or pull request', () => {
    const input = `Needs a spend cap ([#9](${PUBLIC}/issues/9), [the repair loop](${PUBLIC}/pull/16)).`;
    const result = rewriteLinks(input);
    assert.equal(result.text, 'Needs a spend cap (#9, the repair loop).');
    assert.equal(result.markdown, 2);
    assert.equal(result.bare, 0);
  });

  it('keeps the text of a markdown link with a title or a fragment', () => {
    const input = `[issue #17](${PUBLIC}/issues/17 "Private reporting") and [review](${PUBLIC}/pull/240#discussion_r1)`;
    assert.equal(rewriteLinks(input).text, 'issue #17 and review');
  });

  it('turns a bare URL into #N', () => {
    const input = `See ${PUBLIC}/pull/239 and ${PUBLIC}/issues/12.`;
    const result = rewriteLinks(input);
    assert.equal(result.text, 'See #239 and #12.');
    assert.equal(result.bare, 2);
  });

  it('turns a bare URL with a sub-page or fragment into #N', () => {
    const input = `${PUBLIC}/pull/5/files ${PUBLIC}/issues/7#issuecomment-99`;
    assert.equal(rewriteLinks(input).text, '#5 #7');
  });

  it('rewrites links into the private repository the same way', () => {
    const input = `[the PR](${PRIVATE}/pull/253), and ${PRIVATE}/issues/4`;
    const result = rewriteLinks(input);
    assert.equal(result.text, 'the PR, and #4');
    assert.deepEqual(result.remaining, []);
  });

  it('rewrites a URL in a code comment', () => {
    const input = [
      '// Removed after review (' + PUBLIC + '/pull/196).',
      '/* Tracked in ' + PRIVATE + '/issues/30 */',
      '# ' + PUBLIC + '/issues/59',
    ].join('\n');
    assert.equal(
      rewriteLinks(input).text,
      ['// Removed after review (#196).', '/* Tracked in #30 */', '# #59'].join(
        '\n',
      ),
    );
  });

  it('leaves the repository itself, main, settings and new-issue links alone', () => {
    const input = [
      `Source: ${PUBLIC}`,
      `[LICENSE](${PUBLIC}/blob/main/LICENSE)`,
      `${PUBLIC}/tree/main/templates/marketing`,
      `[the template](${PUBLIC}/tree/main/templates/marketing)`,
      // Short hex is a branch name as far as a link can tell, not a pin.
      `${PUBLIC}/blob/a4e59c23/docs/pull/1.md`,
      `${PUBLIC}/security/advisories/new`,
      `${PUBLIC}/settings/environments`,
      `[a new issue](${PUBLIC}/issues/new)`,
    ].join('\n');
    const result = rewriteLinks(input);
    assert.equal(result.text, input);
    assert.equal(
      result.markdown +
        result.bare +
        result.pinned +
        result.milestone +
        result.excluded,
      0,
    );
  });

  it('keeps the text of a markdown link pinned to a commit sha', () => {
    const input = `the [design analysis](${PUBLIC}/blob/${SHA}/docs/analysis.md), and [then](${PRIVATE}/tree/${SHA}/apps/web#readme)`;
    const result = rewriteLinks(input);
    assert.equal(result.text, 'the design analysis, and then');
    assert.equal(result.pinned, 2);
    assert.deepEqual(result.remaining, []);
  });

  it('turns a bare URL pinned to a commit sha into the path it named', () => {
    const input = `See ${PUBLIC}/blob/${SHA}/docs/analysis.md#L10 and ${PUBLIC}/tree/${SHA}.`;
    const result = rewriteLinks(input);
    assert.equal(result.text, 'See docs/analysis.md and the repository.');
    assert.equal(result.pinned, 2);
  });

  it('unlinks milestones', () => {
    const input = `Track: [M0 milestone](${PUBLIC}/milestone/1), or ${PUBLIC}/milestone/2.`;
    const result = rewriteLinks(input);
    assert.equal(result.text, 'Track: M0 milestone, or milestone 2.');
    assert.equal(result.milestone, 2);
  });

  it('keeps the text of a markdown link to an excluded file', () => {
    const exclude = ['docs/social-launch.md', 'docs/pricing-routine.md'];
    const cases = [
      ['docs/decisions.md', '[the kit](social-launch.md)', 'the kit'],
      ['README.md', '[routine](docs/pricing-routine.md#why)', 'routine'],
      [
        'apps/web/README.md',
        '[routine](../../docs/pricing-routine.md)',
        'routine',
      ],
      // Split, like the URLs above: written whole, a root-relative link
      // resolves the same from this file, and the export would rewrite it.
      ['README.md', '[kit](' + '/docs/social-launch.md)', 'kit'],
      ['README.md', `[kit](${PUBLIC}/blob/main/docs/social-launch.md)`, 'kit'],
    ];
    for (const [file, input, expected] of cases) {
      const result = rewriteLinks(input, { file, exclude });
      assert.equal(result.text, expected, `${file}: ${input}`);
      assert.equal(result.excluded, 1, `${file}: ${input}`);
    }
  });

  it('leaves links to exported files, and code that looks like a link', () => {
    const exclude = ['docs/social-launch.md'];
    for (const input of [
      '[brand](brand.md)',
      '[kit](../social-launch.md)',
      'handlers[0](request)',
      '[site](https://example.com/docs/social-launch.md)',
    ]) {
      assert.equal(
        rewriteLinks(input, { file: 'docs/decisions.md', exclude }).text,
        input,
      );
    }
  });

  it('reports private-repository links it cannot rewrite', () => {
    const input = `${PRIVATE}/blob/main/README.md`;
    const result = rewriteLinks(input);
    assert.equal(result.text, input);
    assert.deepEqual(result.remaining, [`${PRIVATE}/blob/main/README.md`]);
  });

  it('leaves the script and this test unchanged when they are exported', () => {
    for (const name of ['public-export.mjs', 'public-export.test.mjs']) {
      const source = readFileSync(new URL(name, import.meta.url), 'utf8');
      assert.equal(
        rewriteLinks(source, { file: `scripts/${name}` }).text,
        source,
        name,
      );
    }
  });
});

describe('rewriteReferences', () => {
  const refs = new Map([
    [12, 'issue'],
    [70, 'pr'],
    [158, 'issue'],
    [162, 'issue'],
    [196, 'pr'],
  ]);
  const rewrite = (text, file) => rewriteReferences(text, { file, refs }).text;

  it('says which private numbers are issues and which are pull requests', () => {
    assert.equal(
      rewrite('Blocked on #12, reviewed in #196.', 'docs/a.md'),
      'Blocked on internal issue 12, reviewed in internal PR 196.',
    );
  });

  it('folds the word already there into the rewrite', () => {
    assert.equal(
      rewrite(
        'Accepted (PR #70), see issue #12 and issues #158 and #162.',
        'a.md',
      ),
      'Accepted (internal PR 70), see internal issue 12 and internal issues 158 and 162.',
    );
  });

  it('capitalises only where a sentence starts', () => {
    assert.equal(
      rewrite('Done. #12 exists.\n#158 too, and\n#162 later.', 'a.md'),
      'Done. Internal issue 12 exists.\nInternal issue 158 too, and\ninternal issue 162 later.',
    );
    assert.equal(
      rewrite('**Shipped.** #12 landed.', 'a.md'),
      '**Shipped.** Internal issue 12 landed.',
    );
  });

  it('leaves numbers the private repository does not have', () => {
    assert.equal(
      rewrite('Option #3 of #12.', 'a.md'),
      'Option #3 of internal issue 12.',
    );
  });

  it('leaves code in Markdown alone', () => {
    const input = ['Colour `#162` for #12.', '```', 'see #12', '```'].join(
      '\n',
    );
    assert.equal(
      rewrite(input, 'a.md'),
      ['Colour `#162` for internal issue 12.', '```', 'see #12', '```'].join(
        '\n',
      ),
    );
  });

  it('rewrites comments in code and never its strings', () => {
    const input = [
      "const colour = '#162'; // since internal PR 196",
      'const note = `#12`;',
      '/**',
      ' * Until #12 lands.',
      ' */',
      '{/* #158 */}',
      'const url = "https://example.com/#12";',
    ].join('\n');
    assert.equal(
      rewrite(input, 'a.tsx'),
      [
        "const colour = '#162'; // since internal PR 196",
        'const note = `#12`;',
        '/**',
        ' * Until internal issue 12 lands.',
        ' */',
        '{/* Internal issue 158 */}',
        'const url = "https://example.com/#12";',
      ].join('\n'),
    );
  });

  it('rewrites SQL and YAML comments', () => {
    assert.equal(
      rewrite('-- added for #12', 'm.sql'),
      '-- added for internal issue 12',
    );
    assert.equal(
      rewrite('  run: x # see #196.\n# #12 below', 'w.yml'),
      '  run: x # see internal PR 196.\n# Internal issue 12 below',
    );
  });

  it('leaves the internal task list, generated examples and other file types alone', () => {
    assert.equal(rewrite('(task #12)', 'a.md'), '(task #12)');
    assert.equal(rewrite('// #12', 'examples/generated/x/a.ts'), '// #12');
    assert.equal(rewrite('#12', 'a.txt'), '#12');
    assert.equal(rewrite('color: #162;', 'a.css'), 'color: #162;');
  });

  it('takes every number for an issue without a refs file', () => {
    assert.equal(
      rewriteReferences('See #5.', { file: 'a.md' }).text,
      'See internal issue 5.',
    );
  });
});

describe('parseRefs', () => {
  it('reads the number and pull-request columns gh prints', () => {
    const refs = parseRefs('12\tfalse\n196\ttrue\n\nnoise\n');
    assert.deepEqual(
      [...refs],
      [
        [12, 'issue'],
        [196, 'pr'],
      ],
    );
  });
});

describe('isText', () => {
  it('accepts UTF-8 text and rejects NUL bytes and invalid UTF-8', () => {
    assert.equal(isText(Buffer.from('plain text, and some UTF-8: é')), true);
    assert.equal(
      isText(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])),
      false,
    );
    assert.equal(isText(Buffer.from([0xff, 0xfe, 0x41])), false);
  });
});

describe('the export', () => {
  it('leaves out what Chris chose to keep internal', () => {
    assert.deepEqual(EXCLUDE, [
      'docs/social-launch.md',
      'docs/pricing-routine.md',
      'docs/launch-email.md',
      '.github/dependabot.yml',
    ]);
  });

  it('writes a committed tree without the excluded files, links rewritten', () => {
    // A throwaway repository, so this exercises `git archive`, the exclusions
    // and the binary check end to end without depending on this checkout's
    // own history.
    const script = join(
      dirname(fileURLToPath(import.meta.url)),
      'public-export.mjs',
    );
    const scratch = mkdtempSync(join(tmpdir(), 'public-export-'));
    try {
      const repo = join(scratch, 'repo');
      mkdirSync(join(repo, 'docs'), { recursive: true });
      writeFileSync(
        join(repo, 'README.md'),
        `See [#4](${PUBLIC}/issues/4) and [the kit](docs/social-launch.md).\n`,
      );
      writeFileSync(join(repo, 'docs', 'social-launch.md'), 'internal\n');
      writeFileSync(join(repo, 'docs', 'pricing-routine.md'), 'internal\n');
      writeFileSync(join(repo, 'docs', 'launch-email.md'), 'internal\n');
      writeFileSync(join(repo, 'docs', 'brand.md'), 'public\n');
      writeFileSync(join(repo, 'logo.bin'), Buffer.from([0, 1, 2, 3]));
      const vcs = (...args) =>
        execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
      vcs('init', '-q');
      vcs('add', '.');
      vcs(
        '-c',
        'user.email=test@example.com',
        '-c',
        'user.name=Test',
        'commit',
        '-q',
        '-m',
        'fixture',
      );

      const out = join(scratch, 'out');
      execFileSync(process.execPath, [script, out], {
        cwd: repo,
        stdio: 'pipe',
      });

      assert.equal(existsSync(join(out, 'docs', 'social-launch.md')), false);
      assert.equal(existsSync(join(out, 'docs', 'pricing-routine.md')), false);
      assert.equal(existsSync(join(out, 'docs', 'launch-email.md')), false);
      assert.equal(
        readFileSync(join(out, 'docs', 'brand.md'), 'utf8'),
        'public\n',
      );
      assert.equal(
        readFileSync(join(out, 'README.md'), 'utf8'),
        'See internal issue 4 and the kit.\n',
      );
      assert.deepEqual([...readFileSync(join(out, 'logo.bin'))], [0, 1, 2, 3]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
