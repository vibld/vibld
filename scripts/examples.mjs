#!/usr/bin/env node
/**
 * Build the examples in examples/catalogue.json and publish them with
 * vibld's own publish service, at `example-<slug>.vibld-preview.dev`.
 *
 *   node scripts/examples.mjs build <out> [--container <image>]
 *                                             install and build each example
 *   node scripts/examples.mjs publish <out>   publish what `build` wrote
 *
 * Two commands because they run in two jobs (.github/workflows/
 * publish-examples.yml). An example's package.json and build config are code
 * a model wrote, so `build` runs where no secret exists and hands npm nothing
 * from the environment but what it needs to reach the registry. `publish`
 * holds the publish service's internal secret and runs no example code at
 * all: it reads the built files and posts them.
 *
 * The examples are published exactly as generated. Nothing here edits a
 * file, and an example that does not build fails the job rather than being
 * patched until it does.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(import.meta.dirname, '..');
const GENERATED = join(ROOT, 'examples', 'generated');
const PUBLISH_HOSTNAME = 'vibld-preview.dev';

/** The pseudo-account the examples are published under. Not a Clerk user. */
const OWNER = 'vibld-examples';

// What npm needs to reach the registry, and nothing else: no token or key
// from the caller's environment reaches code a model wrote.
const PASSED_ENV = [
  'PATH',
  'HOME',
  'TMPDIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
];

export function catalogue() {
  const data = JSON.parse(
    readFileSync(join(ROOT, 'examples', 'catalogue.json'), 'utf8'),
  );
  return data.examples;
}

/** The published slug: a DNS label, prefixed so it never reads as a user's site. */
export function publishedSlug(slug) {
  return `example-${slug}`;
}

export function liveUrl(slug) {
  return `https://${publishedSlug(slug)}.${PUBLISH_HOSTNAME}/`;
}

function passedEnv() {
  const env = {};
  for (const name of PASSED_ENV) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return env;
}

function run(command, args, cwd, env = passedEnv()) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 5 * 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.error || result.status !== 0) {
    const tail = output.trim().split('\n').slice(-15).join('\n');
    throw new Error(
      // The first argument only: a container's arguments carry the proxy
      // settings, and a proxy URL can carry a credential.
      `${command} ${args[0]} failed in ${cwd}\n${result.error?.message ?? ''}\n${tail}`,
    );
  }
  return result.stdout ?? '';
}

/** Where a Vite or React Router build may put the site, in order. */
const OUTPUT_DIRS = ['build/client', 'dist', 'build'];

/** Where a Vite or React Router build put the site. */
function outputDir(project) {
  for (const candidate of OUTPUT_DIRS) {
    const dir = join(project, candidate);
    if (existsSync(join(dir, 'index.html'))) return dir;
  }
  throw new Error(`${project} built, but no index.html in dist or build.`);
}

/**
 * Refuse a link anywhere in what a build wrote. The build is code a model
 * wrote, and a link it leaves behind would have the publish step read
 * whatever the link names, on a runner that holds the publish secret.
 */
export function assertNoLinks(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      throw new Error(`${path} is a link, and a published site holds files.`);
    }
    if (stat.isDirectory()) assertNoLinks(path);
  }
}

/** Where an example is copied inside its container, and built. */
const CONTAINER_WORK = '/home/node/work';

/**
 * The `docker run` that holds one example, as the eval's own build step
 * (packages/eval/bin/build-candidates.ts) holds a candidate: its source
 * mounted read-only, the image's unprivileged user, no capabilities, no
 * privilege escalation, limits on memory, CPU and processes, and a
 * read-only image with size-bounded space to write in. Removing it
 * ends everything the install and build started inside it.
 */
export function containerStart(name, image, source, env) {
  // A proxy setting that may hold credentials (any `@`) is not passed at
  // all: the example's own code runs in there and can read its environment.
  const proxies = Object.entries(env)
    .filter(
      ([key, value]) =>
        /^no_proxy$/i.test(key) ||
        (/^https?_proxy$/i.test(key) && !value.includes('@')),
    )
    .flatMap(([key, value]) => ['--env', `${key}=${value}`]);
  return [
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '--user',
    'node',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    // Memory covers the two in-memory filesystems below as well.
    '--memory',
    '6g',
    '--cpus',
    '2',
    '--pids-limit',
    '2048',
    // Nothing the example writes reaches the runner's disk: a read-only
    // image, and a size-bounded tmpfs for its home and /tmp.
    '--read-only',
    '--tmpfs',
    '/home/node:rw,exec,size=2g,nr_inodes=400000,uid=1000,gid=1000,mode=0755',
    '--tmpfs',
    '/tmp:rw,exec,size=512m,nr_inodes=400000,mode=1777',
    '--volume',
    `${source}:/example:ro`,
    '--env',
    'HOME=/home/node',
    ...proxies,
    image,
    'sleep',
    'infinity',
  ];
}

/** Readable by anyone, so the container's own user can read the mount. */
function openToRead(path) {
  const stat = lstatSync(path);
  if (stat.isDirectory()) {
    chmodSync(path, 0o755);
    for (const entry of readdirSync(path)) openToRead(join(path, entry));
  } else if (stat.isFile()) {
    chmodSync(path, 0o644);
  }
}

/** Install and build one example in its own container, and copy the site out. */
function buildInContainer(example, image, source, target) {
  const name = `vibld-example-${process.pid}-${example.slug}`;
  openToRead(source);
  try {
    run('docker', containerStart(name, image, source, passedEnv()), source);
    run(
      'docker',
      [
        'exec',
        name,
        'sh',
        '-c',
        `mkdir -p ${CONTAINER_WORK} && cp -R /example/. ${CONTAINER_WORK} && cd ${CONTAINER_WORK} && npm install --ignore-scripts --no-audit --no-fund`,
      ],
      source,
    );
    run(
      'docker',
      ['exec', '--workdir', CONTAINER_WORK, name, 'npm', 'run', 'build'],
      source,
    );
    const found = run(
      'docker',
      [
        'exec',
        '--workdir',
        CONTAINER_WORK,
        name,
        'sh',
        '-c',
        `for d in ${OUTPUT_DIRS.join(' ')}; do if [ -f "$d/index.html" ]; then echo "$d"; exit 0; fi; done; exit 1`,
      ],
      source,
    ).trim();
    if (!OUTPUT_DIRS.includes(found)) {
      throw new Error(
        `${example.slug} built, but no index.html in dist or build.`,
      );
    }
    // Read out as JSON rather than with `docker cp`, which cannot see into
    // the tmpfs the site was built in. What comes back is written by
    // `writeSite`, which checks every path, so nothing the build left can
    // write outside the site's own directory.
    const listing = run(
      'docker',
      [
        'exec',
        '--workdir',
        `${CONTAINER_WORK}/${found}`,
        name,
        'node',
        '-e',
        LIST_SITE,
      ],
      source,
    );
    writeSite(target, listing);
  } finally {
    spawnSync('docker', ['rm', '--force', name], {
      env: passedEnv(),
      timeout: 60_000,
    });
  }
}

/**
 * Run inside the container, in the built site's directory: every file under
 * it as `{ path, content }` with base64 content, refusing a link.
 */
const LIST_SITE = `
const { lstatSync, readdirSync, readFileSync } = require('node:fs');
const out = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = dir === '.' ? entry : dir + '/' + entry;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(path + ' is a link');
    if (stat.isDirectory()) walk(path);
    else if (stat.isFile()) out.push({ path, content: readFileSync(path).toString('base64') });
    else throw new Error(path + ' is not a file');
  }
};
walk('.');
process.stdout.write(JSON.stringify(out));
`;

/** The most a built site may hold, all files together. */
const MAX_SITE_BYTES = 50 * 1024 * 1024;

/**
 * Write a site read out of a container. The listing came from where
 * model-written code ran, so it is checked here as untrusted: every path is
 * relative, uses forward slashes, and has no empty, `.` or `..` segment, and
 * the whole is bounded in size.
 */
export function writeSite(target, listing) {
  const files = JSON.parse(listing);
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('the build wrote no files');
  }
  let total = 0;
  const checked = files.map((file) => {
    const { path, content } = file ?? {};
    if (
      typeof path !== 'string' ||
      typeof content !== 'string' ||
      path.includes('\\') ||
      path.includes('\0') ||
      path
        .split('/')
        .some((part) => part === '' || part === '.' || part === '..')
    ) {
      throw new Error(`${JSON.stringify(path)} is not a path inside the site`);
    }
    const bytes = Buffer.from(content, 'base64');
    total += bytes.length;
    if (total > MAX_SITE_BYTES) {
      throw new Error('the built site is larger than 50 MB');
    }
    return { path, bytes };
  });
  for (const { path, bytes } of checked) {
    const destination = join(target, ...path.split('/'));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes, { flag: 'wx' });
  }
}

/** Install and build one example on this machine, with a throwaway HOME. */
function buildHere(example, source, target) {
  const home = mkdtempSync(join(tmpdir(), 'example-home-'));
  const env = {
    ...passedEnv(),
    HOME: home,
    npm_config_cache: join(home, '.npm'),
  };
  try {
    run(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
      source,
      env,
    );
    run('npm', ['run', 'build'], source, env);
    cpSync(outputDir(source), target, { recursive: true });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * `--container <image>` builds each example in its own container, which is
 * how the workflow runs it: one example's build cannot then reach another's
 * source or output, or anything else on the runner. Without it, each builds
 * on this machine, for trying the script locally.
 */
function build(out, image) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  let failed = 0;
  for (const example of catalogue()) {
    // Built in a copy, so node_modules and build output never land beside
    // the committed source.
    const work = mkdtempSync(join(tmpdir(), `example-${example.slug}-`));
    const target = join(out, example.slug);
    try {
      cpSync(join(GENERATED, example.slug), work, { recursive: true });
      if (image) buildInContainer(example, image, work, target);
      else buildHere(example, work, target);
      assertNoLinks(target);
      console.log(`ok    ${example.slug}`);
    } catch (error) {
      failed += 1;
      rmSync(target, { recursive: true, force: true });
      console.log(
        `FAIL  ${example.slug}\n${error.message.replace(/^/gm, '      ')}`,
      );
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  return failed === 0;
}

function files(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = lstatSync(path);
    // The build job refuses links too; this is the side that holds the
    // secret, so it does not take that on trust.
    if (stat.isSymbolicLink()) {
      throw new Error(`${path} is a link, and a published site holds files.`);
    }
    if (stat.isDirectory()) found.push(...files(path));
    else found.push(path);
  }
  return found;
}

/**
 * The publish API takes text. A file that is not valid UTF-8 would be
 * corrupted on the way in, so it stops the publish instead.
 */
function readText(path) {
  const bytes = readFileSync(path);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (Buffer.from(text, 'utf8').compare(bytes) !== 0) {
    throw new Error(
      `${path} is not text, and the publish API only takes text.`,
    );
  }
  return text;
}

async function publish(out) {
  const secret = process.env.PUBLISH_INTERNAL_SECRET;
  if (!secret) {
    console.error('PUBLISH_INTERNAL_SECRET is not set.');
    return false;
  }
  let failed = 0;
  for (const example of catalogue()) {
    const dir = join(out, example.slug);
    const slug = publishedSlug(example.slug);
    try {
      const body = {
        userId: OWNER,
        projectId: `example:${example.slug}`,
        slug,
        files: files(dir).map((path) => ({
          path: relative(dir, path).split(sep).join('/'),
          content: readText(path),
        })),
      };
      const response = await fetch(
        `https://${slug}.${PUBLISH_HOSTNAME}/internal/publish`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${secret}`,
          },
          body: JSON.stringify(body),
        },
      );
      // The status and the service's own message only. Neither carries the
      // secret, and the request is never echoed.
      if (!response.ok) {
        const reason = await response.text().catch(() => '');
        throw new Error(
          `publish answered ${response.status} ${reason.slice(0, 200)}`,
        );
      }
      console.log(`ok    ${example.slug}  ${liveUrl(example.slug)}`);
    } catch (error) {
      failed += 1;
      // fetch rejects with only "fetch failed"; the reason, such as
      // ENOTFOUND for a hostname with no DNS record, is on its cause.
      const cause = error.cause?.code ?? error.cause?.message;
      console.log(
        `FAIL  ${example.slug}: ${error.message}${cause ? ` (${cause})` : ''}`,
      );
    }
  }
  return failed === 0;
}

// Not import.meta.main, which Node only has from 22.18 and 24.2: on an
// earlier release the engines range allows, it is undefined and the script
// would exit 0 having done nothing.
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const [command, out, flag, image] = process.argv.slice(2);
  const usable =
    out &&
    (command === 'publish'
      ? flag === undefined
      : command === 'build' &&
        (flag === undefined || (flag === '--container' && image)));
  if (!usable) {
    console.error(
      'Usage: node scripts/examples.mjs build <dir> [--container <image>]\n' +
        '       node scripts/examples.mjs publish <dir>',
    );
    process.exitCode = 1;
  } else {
    const ok = command === 'build' ? build(out, image) : await publish(out);
    process.exitCode = ok ? 0 : 1;
  }
}
