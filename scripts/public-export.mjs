#!/usr/bin/env node
/**
 * Writes the tree of one git ref into a directory, ready to become the next
 * commit of the public repository (github.com/vibld/vibld).
 *
 *   node scripts/public-export.mjs <output-directory> [ref] [--refs <file>]
 *
 * The ref defaults to HEAD. Only committed content is exported: the tree
 * comes from `git archive`, so the working copy, ignored files and anything
 * uncommitted never reach the output. `.github/workflows/public-export.yml`
 * runs this after every merge to main and pushes the result.
 *
 * Three things change on the way out. The files in EXCLUDE are left out.
 * Links that would break in the public repository are unlinked:
 *
 * - Issues and pull requests live in the private working repository, so a
 *   link to one from the public copy would be a 404 or an unrelated public
 *   issue. A markdown link keeps its text; a bare URL becomes `#N`.
 * - A `/blob/<sha>/` or `/tree/<sha>/` link pinned to a full commit sha
 *   names a commit the public repository does not have. A markdown link
 *   keeps its text; a bare URL becomes the path it named.
 * - Milestones do not carry over either. A markdown link keeps its text; a
 *   bare URL becomes "milestone N".
 * - A markdown link to an excluded file keeps its text.
 *
 * And every `#N` that names one of the private repository's issues or pull
 * requests, whether it was written that way or left by the unlinking above,
 * becomes "internal issue N" or "internal PR N", in prose and comments only
 * (see rewriteReferences). The `--refs` file says which numbers exist and
 * which are pull requests. Files the rewrite changed are then formatted, so
 * the tree passes the public repository's `prettier --check`.
 *
 * Links to the repository itself, to `/blob/main/` and `/tree/main/` paths
 * and to `settings/` pages are left alone, because those are correct for the
 * public repository.
 *
 * Nothing here talks to a remote. Committing the output and pushing it is
 * the workflow's step, not this script's.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Files the public copy leaves out. Chris chose the two documents as
 * internal operational notes (2026-09-27): the social launch plan and the
 * brief for the scheduled pricing routine. The open-beta launch email to the
 * waitlist joined them the same day, as a draft addressed to people who
 * signed up, not to readers of the source. Everything else in docs/ is
 * exported.
 *
 * The Dependabot config is left out too, by the same decision: version
 * updates are made here and reach the public copy in the next export, so a
 * public Dependabot pull request could only be merged by diverging from
 * this repository. Dependabot's security alerts do not need the file.
 *
 * The style gallery's data is exported (Chris, docs/decisions.md, D143).
 */
export const EXCLUDE = [
  'docs/social-launch.md',
  'docs/pricing-routine.md',
  'docs/launch-email.md',
  '.github/dependabot.yml',
];

// Both names: the public repository (whose past numbers are the private
// repository's, carried over in text) and the private one itself.
const REPO = String.raw`https?://(?:www\.)?github\.com/vibld/(?:vibld-internal|vibld)`;
// What may follow and still be the same link: a sub-page such as `/files`,
// or a fragment such as `#issuecomment-123`.
const TAIL = String.raw`(?:[/#][^\s)\]>"'\x60]*)?`;
const ITEM = String.raw`${REPO}/(?:pull|issues)/(\d+)${TAIL}`;
// A full 40-character sha only: `/blob/main/` must not match, and neither
// must a branch whose name happens to be short hex.
const PINNED = String.raw`${REPO}/(?:blob|tree)/[0-9a-f]{40}(?:/([^\s)\]>"'\x60#?]*))?(?:[#?][^\s)\]>"'\x60]*)?`;
const MILESTONE = String.raw`${REPO}/milestone/(\d+)${TAIL}`;
// Any path in either repository at any ref, for spotting links to an
// excluded file.
const AT_REF = new RegExp(String.raw`^${REPO}/(?:blob|tree)/[^/]+/(.+)$`);

// `[text](target)` or `[text](target "title")`. Which targets are unlinked
// is decided per match, below.
const MARKDOWN_LINK =
  /\[([^\]\n]*)\]\(\s*<?([^()\s<>]+)>?(?:\s+"[^"\n]*")?\s*\)/g;

const IS_ITEM = new RegExp(`^${ITEM}$`);
const IS_PINNED = new RegExp(`^${PINNED}$`);
const IS_MILESTONE = new RegExp(`^${MILESTONE}$`);
const BARE_ITEM = new RegExp(ITEM, 'g');
const BARE_PINNED = new RegExp(PINNED, 'g');
const BARE_MILESTONE = new RegExp(MILESTONE, 'g');

// Anything left pointing into the private repository after the rewrite. Not
// changed, because there is no public equivalent to point it at; reported so
// a person decides.
const PRIVATE_URL =
  /https?:\/\/(?:www\.)?github\.com\/vibld\/vibld-internal\b[^\s)\]>"'`]*/g;

/**
 * Whether a link target, as written in `file`, names one of `exclude`.
 *
 * @param {string} target
 * @param {string} file repository-relative, with forward slashes
 * @param {readonly string[]} exclude
 */
function namesExcluded(target, file, exclude) {
  const bare = target.split(/[#?]/)[0];
  if (!bare) return false;
  const pinned = AT_REF.exec(bare);
  let path;
  if (pinned) path = pinned[1];
  else if (/^[a-z][a-z0-9+.-]*:/i.test(bare)) return false;
  else if (bare.startsWith('/')) path = posix.normalize(bare.slice(1));
  else path = posix.normalize(posix.join(posix.dirname(file), bare));
  return exclude.includes(path.replace(/\/$/, ''));
}

/**
 * Rewrites the links in one file's text that would break in the public
 * repository.
 *
 * @param {string} text
 * @param {{ file?: string, exclude?: readonly string[] }} [options]
 *   `file` is the path of the text within the repository, which relative
 *   links are resolved against.
 */
export function rewriteLinks(text, { file = '', exclude = EXCLUDE } = {}) {
  const counts = { markdown: 0, bare: 0, pinned: 0, milestone: 0, excluded: 0 };
  let out = text.replace(MARKDOWN_LINK, (match, label, target) => {
    if (IS_ITEM.test(target)) counts.markdown += 1;
    else if (IS_PINNED.test(target)) counts.pinned += 1;
    else if (IS_MILESTONE.test(target)) counts.milestone += 1;
    else if (namesExcluded(target, file, exclude)) counts.excluded += 1;
    else return match;
    return label;
  });
  out = out.replace(BARE_ITEM, (_match, number) => {
    counts.bare += 1;
    return `#${number}`;
  });
  out = out.replace(BARE_PINNED, (_match, path) => {
    counts.pinned += 1;
    return path || 'the repository';
  });
  out = out.replace(BARE_MILESTONE, (_match, number) => {
    counts.milestone += 1;
    return `milestone ${number}`;
  });
  const remaining = out.match(PRIVATE_URL) ?? [];
  return { text: out, ...counts, remaining };
}

// Where a file's prose is, by extension. Markdown is prose throughout,
// outside code; everything else only in its comments, so a string, a
// selector or a colour such as `#333` is never touched.
const LINE_COMMENT = {
  ts: '//',
  tsx: '//',
  js: '//',
  mjs: '//',
  cjs: '//',
  jsonc: '//',
  sql: '--',
  yml: '#',
  yaml: '#',
  sh: '#',
  toml: '#',
};
const BLOCK_COMMENTS = new Set([
  'ts',
  'tsx',
  'js',
  'mjs',
  'cjs',
  'jsonc',
  'css',
]);
const MARKDOWN = new Set(['md', 'mdx']);

// Kept exactly as the generator wrote them, like the formatter leaves them.
const VERBATIM = ['examples/generated/'];

const NUMBER = String.raw`#(\d{1,4})\b(?![\w-])`;
// `#N` on its own: not part of a word, a heading (`##`), an HTML entity, a
// path or a string's first character.
const BARE_REF = new RegExp(String.raw`(?<![\w&#/'"\x60-])${NUMBER}`, 'g');
// "issue #N", "PR #N": the word already says what it is.
const NAMED_REF = new RegExp(
  String.raw`\b(issue|Issue|PR|pull request|Pull request)\s+${NUMBER}`,
  'g',
);
// "issues #N, #M and #K": one "internal", then the numbers.
const NAMED_LIST = new RegExp(
  String.raw`\b(issues|Issues|PRs|pull requests|Pull requests)\s+(#\d{1,4}(?:(?:\s*,\s*|,?\s+and\s+)#\d{1,4})+)\b(?![\w-])`,
  'g',
);
// The internal task list, which is not an issue tracker at all.
const TASK_REF = /\b(?:task|Task)\s+#\d/;

// Comment markers and list bullets that may come before the first word.
const LEADER = /^[\s{/*#>|-]*$/;
// The end of a sentence, and any closing emphasis or bracket after it.
const SENTENCE_END = /[.!?:]["'*_)\]]*\s+$/;
const SENTENCE_END_OF_LINE = /[.!?:]["'*_)\]]*\s*$/;

/**
 * Rewrites one stretch of prose. The new text starts with a capital where a
 * sentence starts: after a full stop, or at the start of a line whose
 * previous line ended one (`startsSentence`).
 *
 * @param {string} text
 * @param {(n: number) => ('issue' | 'pr' | undefined)} kindOf
 * @param {{ count: number }} counter
 * @param {boolean} startsSentence
 */
function rewriteProse(text, kindOf, counter, startsSentence) {
  const internal = (whole, offset) => {
    const before = whole.slice(0, offset);
    const capital =
      SENTENCE_END.test(before) || (startsSentence && LEADER.test(before));
    return capital ? 'Internal' : 'internal';
  };
  let out = text.replace(NAMED_LIST, (match, word, list, offset, whole) => {
    const numbers = [...list.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
    if (numbers.some((n) => !kindOf(n))) return match;
    counter.count += numbers.length;
    const noun = word === 'PRs' ? 'PRs' : word.toLowerCase();
    return `${internal(whole, offset)} ${noun} ${list.replace(/#/g, '')}`;
  });
  out = out.replace(NAMED_REF, (match, word, number, offset, whole) => {
    if (!kindOf(Number(number))) return match;
    counter.count += 1;
    const noun = word === 'PR' ? 'PR' : word.toLowerCase();
    return `${internal(whole, offset)} ${noun} ${number}`;
  });
  return out.replace(BARE_REF, (match, number, offset, whole) => {
    const kind = kindOf(Number(number));
    if (!kind) return match;
    if (TASK_REF.test(whole.slice(Math.max(0, offset - 5), offset + 2))) {
      return match;
    }
    counter.count += 1;
    return `${internal(whole, offset)} ${kind === 'pr' ? 'PR' : 'issue'} ${number}`;
  });
}

/**
 * Makes references to the private repository's issues and pull requests say
 * so. Its numbers mean nothing in the public repository, whose own #N is a
 * different thing or nothing yet; "internal issue 12" reads the same in prose
 * and does not point anywhere wrong (Chris, 2026-09-27).
 *
 * Only prose is rewritten: Markdown outside code, and comments in the file
 * types in LINE_COMMENT and BLOCK_COMMENTS. Anything else, including every
 * string in code, is left alone, so a prompt or a colour never changes.
 *
 * @param {string} text
 * @param {{ file?: string, refs?: Map<number, 'issue' | 'pr'> }} [options]
 *   `refs` names the private repository's numbers and what each one is. A
 *   number it does not list is left alone. Without it every number is taken
 *   for an issue.
 */
export function rewriteReferences(text, { file = '', refs } = {}) {
  const counter = { count: 0 };
  if (VERBATIM.some((prefix) => file.startsWith(prefix))) {
    return { text, references: 0 };
  }
  const kindOf = refs ? (n) => refs.get(n) : () => 'issue';
  const extension = file.includes('.') ? file.split('.').pop() : '';
  const markdown = MARKDOWN.has(extension);
  const marker = LINE_COMMENT[extension];
  const block = BLOCK_COMMENTS.has(extension);
  if (!markdown && !marker && !block) return { text, references: 0 };

  // Whether the line being rewritten starts a sentence: the first line, or
  // one after a line that is blank, only markers, or ended a sentence.
  let startsSentence = true;
  const prose = (segment) =>
    rewriteProse(segment, kindOf, counter, startsSentence);

  let fenced = false;
  const markdownLine = (line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return line;
    }
    if (fenced) return line;
    // Code spans stay as written: the odd pieces are the code.
    return line
      .split(/(`[^`]*`)/)
      .map((piece, i) => (i % 2 === 1 ? piece : prose(piece)))
      .join('');
  };

  let inBlock = false;
  const commentLine = (line) => {
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) return prose(line);
      inBlock = false;
      return prose(line.slice(0, end)) + line.slice(end);
    }
    const trimmed = line.trimStart();
    const indent = line.slice(0, line.length - trimmed.length);
    if (block && /^\{?\/\*/.test(trimmed)) {
      const end = trimmed.indexOf('*/', 2);
      if (end === -1) {
        inBlock = true;
        return indent + prose(trimmed);
      }
      return indent + prose(trimmed.slice(0, end)) + trimmed.slice(end);
    }
    if (!marker) return line;
    if (trimmed.startsWith(marker)) return indent + prose(trimmed);
    // A trailing comment: the marker after whitespace and before a space,
    // which a URL's `//` or a string's `#` does not have.
    const trailing = line.indexOf(` ${marker} `);
    if (trailing === -1) return line;
    return line.slice(0, trailing) + prose(line.slice(trailing));
  };

  const out = text
    .split('\n')
    .map((line) => {
      const result = markdown ? markdownLine(line) : commentLine(line);
      startsSentence = LEADER.test(line) || SENTENCE_END_OF_LINE.test(line);
      return result;
    })
    .join('\n');
  return { text: out, references: counter.count };
}

/**
 * Reads the private repository's numbers from a file of `number<TAB>true`
 * lines, where the second column says whether the number is a pull request:
 * what `gh api --paginate repos/OWNER/REPO/issues?state=all --jq '.[] |
 * [.number, has("pull_request")] | @tsv'` prints.
 *
 * @param {string} text
 */
export function parseRefs(text) {
  const refs = new Map();
  for (const line of text.split('\n')) {
    const [number, pull] = line.trim().split(/\s+/);
    if (!number || !/^\d+$/.test(number)) continue;
    refs.set(Number(number), pull === 'true' ? 'pr' : 'issue');
  }
  return refs;
}

/**
 * Whether a file's bytes are text. The same test git uses: a NUL byte in the
 * first 8000 bytes means binary. Bytes that are not valid UTF-8 are treated
 * as binary too, so a rewrite never re-encodes a file it cannot read.
 *
 * @param {Buffer} bytes
 */
export function isText(bytes) {
  if (bytes.subarray(0, 8000).includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

/**
 * Formats the files the rewrite changed, with the configuration and ignore
 * file the exported tree carries. A shorter link text can leave a Markdown
 * table misaligned, and the public repository's CI runs `prettier --check`
 * on exactly what was exported: the first export failed it on
 * docs/implementation-plan.md.
 *
 * @param {string} target
 * @param {readonly string[]} files repository-relative
 */
async function formatChanged(target, files) {
  const prettier = await import('prettier');
  const ignorePath = join(target, '.prettierignore');
  let formatted = 0;
  for (const file of files) {
    const path = join(target, ...file.split('/'));
    const info = await prettier.getFileInfo(path, {
      ignorePath: existsSync(ignorePath) ? ignorePath : undefined,
    });
    if (info.ignored || !info.inferredParser) continue;
    const options = (await prettier.resolveConfig(path)) ?? {};
    const before = readFileSync(path, 'utf8');
    const after = await prettier.format(before, { ...options, filepath: path });
    if (after === before) continue;
    writeFileSync(path, after);
    formatted += 1;
  }
  return formatted;
}

async function main(argv) {
  const positional = [];
  let refsFile;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--refs') refsFile = argv[(i += 1)];
    else positional.push(argv[i]);
  }
  const [output, ref = 'HEAD'] = positional;
  if (!output || output.startsWith('-')) {
    console.error(
      'Usage: node scripts/public-export.mjs <output-directory> [ref] [--refs <file>]',
    );
    process.exit(2);
  }
  const refs = refsFile ? parseRefs(readFileSync(refsFile, 'utf8')) : undefined;
  const target = resolve(output);
  mkdirSync(target, { recursive: true });
  // An export into a directory that already has files in it would mix old
  // and new trees, and the summary would describe neither.
  if (readdirSync(target).length > 0) {
    console.error(`${target} is not empty. Export into an empty directory.`);
    process.exit(1);
  }

  const commit = execFileSync(
    'git',
    ['rev-parse', '--verify', `${ref}^{commit}`],
    { encoding: 'utf8' },
  ).trim();
  const tar = execFileSync('git', ['archive', '--format=tar', commit], {
    maxBuffer: 1024 * 1024 * 1024,
  });
  execFileSync('tar', ['-x', '-f', '-', '-C', target], { input: tar });

  // Said out loud when an entry is missing: a renamed file would otherwise
  // be exported under its new name while this list quietly matches nothing.
  const missing = [];
  for (const path of EXCLUDE) {
    const full = join(target, ...path.split('/'));
    if (existsSync(full)) rmSync(full);
    else missing.push(path);
  }

  let files = 0;
  const changedFiles = [];
  const totals = { markdown: 0, bare: 0, pinned: 0, milestone: 0, excluded: 0 };
  let references = 0;
  const remaining = [];
  for (const path of walk(target)) {
    files += 1;
    const bytes = readFileSync(path);
    if (!isText(bytes)) continue;
    const file = relative(target, path).split(sep).join('/');
    const before = bytes.toString('utf8');
    const result = rewriteLinks(before, { file });
    for (const url of result.remaining) remaining.push(`${file}: ${url}`);
    const named = rewriteReferences(result.text, { file, refs });
    if (named.text === before) continue;
    writeFileSync(path, named.text);
    changedFiles.push(file);
    for (const key of Object.keys(totals)) totals[key] += result[key];
    references += named.references;
  }
  const formatted = await formatChanged(target, changedFiles);

  const rewritten = Object.values(totals).reduce((sum, n) => sum + n, 0);
  console.log(`Exported ${commit} to ${target}`);
  console.log(`  ${files} files written`);
  console.log(
    `  ${EXCLUDE.length - missing.length} files left out: ${EXCLUDE.filter((path) => !missing.includes(path)).join(', ')}`,
  );
  console.log(`  ${changedFiles.length} files changed`);
  console.log(`  ${rewritten} links rewritten:`);
  console.log(
    `    ${totals.markdown} markdown links to issues or pull requests, to their text`,
  );
  console.log(`    ${totals.bare} bare issue or pull request URLs, to #N`);
  console.log(`    ${totals.pinned} links pinned to a commit sha`);
  console.log(`    ${totals.milestone} milestone links`);
  console.log(`    ${totals.excluded} links to excluded files, to their text`);
  console.log(
    `  ${references} issue and pull request numbers marked internal${refs ? '' : ' (no --refs file, so every number was taken for an issue)'}`,
  );
  console.log(`  ${formatted} changed files reformatted`);
  if (missing.length > 0) {
    console.log(
      `  ${missing.length} excluded paths were not in the tree: ${missing.join(', ')}`,
    );
  }
  if (remaining.length > 0) {
    console.log(
      `  ${remaining.length} links into vibld-internal left unchanged, with no public equivalent:`,
    );
    for (const line of remaining) console.log(`    ${line}`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main(process.argv.slice(2));
}
