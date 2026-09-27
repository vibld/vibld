#!/usr/bin/env node
/**
 * Writes the tree of one git ref into a directory, ready to become the first
 * commit of the public repository (github.com/vibld/vibld).
 *
 *   node scripts/public-export.mjs <output-directory> [ref]
 *
 * The ref defaults to HEAD. Only committed content is exported: the tree
 * comes from `git archive`, so the working copy, ignored files and anything
 * uncommitted never reach the output.
 *
 * Two things change on the way out. The files in EXCLUDE are left out. And
 * links that would break in a fresh public repository are unlinked:
 *
 * - Issues and pull requests live in the private working repository, so a
 *   link to one from the public copy would be a 404 or, once the public
 *   repository has its own numbering, an unrelated issue. A markdown link
 *   keeps its text; a bare URL becomes `#N`, which reads the same in prose
 *   and in code comments.
 * - A `/blob/<sha>/` or `/tree/<sha>/` link pinned to a full commit sha
 *   names a commit the public repository's single fresh commit does not
 *   have. A markdown link keeps its text; a bare URL becomes the path it
 *   named.
 * - Milestones do not carry over either. A markdown link keeps its text; a
 *   bare URL becomes "milestone N".
 * - A markdown link to an excluded file keeps its text.
 *
 * Links to the repository itself, to `/blob/main/` and `/tree/main/` paths
 * and to `settings/` pages are left alone, because those are correct for the
 * public repository.
 *
 * Nothing here talks to a remote. Creating the public commit and pushing it
 * is a separate, deliberate step that this script does not take.
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
 * Files the public copy leaves out. Chris chose these as internal
 * operational notes (2026-09-27): the social launch plan and the brief for
 * the scheduled pricing routine. Everything else in docs/ is exported.
 */
export const EXCLUDE = ['docs/social-launch.md', 'docs/pricing-routine.md'];

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

function main(argv) {
  const [output, ref = 'HEAD'] = argv;
  if (!output) {
    console.error(
      'Usage: node scripts/public-export.mjs <output-directory> [ref]',
    );
    process.exit(2);
  }
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
  let changed = 0;
  const totals = { markdown: 0, bare: 0, pinned: 0, milestone: 0, excluded: 0 };
  const remaining = [];
  for (const path of walk(target)) {
    files += 1;
    const bytes = readFileSync(path);
    if (!isText(bytes)) continue;
    const file = relative(target, path).split(sep).join('/');
    const before = bytes.toString('utf8');
    const result = rewriteLinks(before, { file });
    for (const url of result.remaining) remaining.push(`${file}: ${url}`);
    if (result.text === before) continue;
    writeFileSync(path, result.text);
    changed += 1;
    for (const key of Object.keys(totals)) totals[key] += result[key];
  }

  const rewritten = Object.values(totals).reduce((sum, n) => sum + n, 0);
  console.log(`Exported ${commit} to ${target}`);
  console.log(`  ${files} files written`);
  console.log(
    `  ${EXCLUDE.length - missing.length} files left out: ${EXCLUDE.filter((path) => !missing.includes(path)).join(', ')}`,
  );
  console.log(`  ${changed} files changed`);
  console.log(`  ${rewritten} links rewritten:`);
  console.log(
    `    ${totals.markdown} markdown links to issues or pull requests, to their text`,
  );
  console.log(`    ${totals.bare} bare issue or pull request URLs, to #N`);
  console.log(`    ${totals.pinned} links pinned to a commit sha`);
  console.log(`    ${totals.milestone} milestone links`);
  console.log(`    ${totals.excluded} links to excluded files, to their text`);
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
  main(process.argv.slice(2));
}
