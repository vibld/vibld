import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @param {string} base @param {string} head @param {string} cwd */
export function checkDco(base, head, cwd = process.cwd()) {
  if (![base, head].every((sha) => /^[a-f0-9]{40}$/.test(sha))) {
    throw new Error('DCO requires full base and head commit SHAs');
  }
  /** @param {string[]} args @param {string | undefined} [input] */
  const git = (args, input) =>
    execFileSync('git', args, { cwd, input, encoding: 'utf8' });
  const commits = git(['rev-list', '--no-merges', `${base}..${head}`])
    .trim()
    .split('\n')
    .filter(Boolean);
  for (const sha of commits) {
    const [name, email, message] = git([
      'show',
      '-s',
      '--format=%an%x00%ae%x00%B',
      sha,
    ]).split('\0');
    const trailers = git(['interpret-trailers', '--parse'], message);
    const signed = trailers.split('\n').some((line) => {
      const match = /^Signed-off-by:\s*(.+) <([^<>\s]+)>\s*$/i.exec(line);
      return (
        match &&
        match[1] === name &&
        match[2].toLowerCase() === email.toLowerCase()
      );
    });
    if (!signed)
      throw new Error(
        `${sha}: missing author-matching Signed-off-by trailer; use git commit -s`,
      );
  }
  if (!commits.length)
    throw new Error('DCO found no contribution commits to check');
  return commits.length;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const count = checkDco(
    process.env.DCO_BASE_SHA ?? '',
    process.env.DCO_HEAD_SHA ?? '',
  );
  console.log(`DCO passed for ${count} contribution commits.`);
}
