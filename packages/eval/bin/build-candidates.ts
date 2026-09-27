import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  chmodSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/**
 * Install and build every project an eval run wrote out, and fail if any of
 * them does not build.
 *
 * "Accepted" meant the plan passed validation and mentioned what was asked
 * for. It never meant the project builds: the bakeoff wrote its candidates
 * out and stopped, and the CI stub's own project stopped at
 * "vite: not found" while being reported accepted (#59). A person exporting
 * a project runs `npm install` and `npm run build` next, so that is what
 * this runs.
 *
 * Run this in a job that holds no secrets. A generated package.json is code
 * written by a model: its dependencies and build config run here. So the
 * bakeoff runs it as a separate job with no environment, and this script
 * also hands each command only what npm needs (see PASSED_ENV), installs with
 * `--ignore-scripts`, and sets a time limit.
 *
 * One candidate must not be able to reach another (#237 review), and only
 * a boundary the candidate cannot cross gives that. With `--container
 * <image>`, which is how CI and the bakeoff run it, each candidate builds in
 * a container of its own: its snapshot mounted read-only and copied inside,
 * running as the image's unprivileged `node` user with every capability
 * dropped, limits on memory and processes, a read-only image, and only
 * size-bounded in-memory space to write in, and the container removed with
 * everything in it before the next candidate starts. No other candidate's
 * files are visible to it, and nothing it starts, detached or not, outlives
 * its turn.
 *
 * Without `--container` the candidates run as processes of this user, which
 * is for trying it locally on projects you trust. Each still builds from a
 * fresh copy of a snapshot taken before any of them ran, a snapshot that no
 * longer matches its hash fails the run, and each command's process group is
 * killed when it ends; but a process that leaves its group escapes that.
 *
 * Usage: node --experimental-strip-types bin/build-candidates.ts <dir>
 *   [minutes] [--container <image>]
 * `<dir>` is the VIBLD_EVAL_OUT of an eval run. `[minutes]` is the time the
 * whole run may take: a candidate that could not finish inside it is not
 * started, and is reported as not built, so a job that runs out of time
 * fails saying which candidates it never checked rather than being killed
 * part way through with no word about the rest.
 */

const INSTALL_TIMEOUT_MS = 5 * 60_000;
const BUILD_TIMEOUT_MS = 5 * 60_000;
const CONTAINER_START_TIMEOUT_MS = 2 * 60_000;
const CONTAINER_REMOVE_TIMEOUT_MS = 60_000;

/**
 * The longest one candidate can take: its install limit plus its build
 * limit, and in a container the limits on starting and removing it as well
 * (#237 review).
 */
export function candidateWorstCaseMs(container: boolean): number {
  return (
    INSTALL_TIMEOUT_MS +
    BUILD_TIMEOUT_MS +
    (container ? CONTAINER_START_TIMEOUT_MS + CONTAINER_REMOVE_TIMEOUT_MS : 0)
  );
}

/**
 * Whether a candidate may start: only if it can finish, at its worst, by the
 * deadline. Starting one that could not would let the job's own timeout
 * kill it, and every candidate after it, without a result.
 */
export function canStart(
  now: number,
  deadline: number,
  container: boolean,
): boolean {
  return now + candidateWorstCaseMs(container) <= deadline;
}

/**
 * Whether this file is the one Node was asked to run. Compared by URL rather
 * than with `import.meta.main`, which Node only has from 22.18 and 24.2: on
 * an earlier supported release it is undefined, and the script would exit
 * successfully having built nothing (#237 review).
 */
export function isEntry(moduleUrl: string, argv1: string | undefined): boolean {
  return (
    argv1 !== undefined && pathToFileURL(resolve(argv1)).href === moduleUrl
  );
}

/** Every directory under `root` holding a package.json, without descending into one. */
export function findProjects(root: string): string[] {
  if (existsSync(join(root, 'package.json'))) return [root];
  const found: string[] = [];
  for (const entry of readdirSync(root).sort()) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const path = join(root, entry);
    if (statSync(path).isDirectory()) found.push(...findProjects(path));
  }
  return found;
}

/** The last lines of a command's output: where npm and bundlers put the reason. */
function tail(text: string, lines = 12): string {
  return text.trim().split('\n').slice(-lines).join('\n');
}

/** Most output kept from one command, from its end: the reason is there. */
const MAX_OUTPUT_CHARS = 1_000_000;

/**
 * Run a command in its own process group and resolve when it has finished.
 *
 * A timeout that signals only the direct child leaves whatever npm started
 * (a shell, a bundler, a server a build script forgot to stop) running into
 * the next candidate's turn. So the whole group is killed on timeout, and
 * again when the command exits, before its result is reported.
 */
export function run(
  command: string,
  args: string[],
  cwd: string,
  timeout: number,
  env: Record<string, string> = passedEnv(),
): Promise<{ ok: boolean; output: string }> {
  return new Promise((done) => {
    let output = '';
    // A rolling suffix: a verbose install or build puts its reason last.
    const keep = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > 2 * MAX_OUTPUT_CHARS) {
        output = output.slice(-MAX_OUTPUT_CHARS);
      }
    };
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const killGroup = () => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    };
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeout);
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    // 'exit' and then the group: a descendant holding the pipes open would
    // otherwise keep 'close' from ever firing.
    child.on('exit', killGroup);
    child.on('error', (error) => {
      clearTimeout(timer);
      killGroup();
      done({ ok: false, output: `${error.message}\n${output}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      killGroup();
      done(
        timedOut
          ? {
              ok: false,
              output: `timed out after ${timeout / 1000}s\n${output}`,
            }
          : { ok: code === 0, output },
      );
    });
  });
}

/**
 * A hash of every file in a project, by path and content, so a candidate
 * that changed another before its turn is caught rather than built.
 */
export function digest(dir: string): string {
  const hash = createHash('sha256');
  const walk = (at: string) => {
    for (const entry of readdirSync(at).sort()) {
      if (entry === 'node_modules') continue;
      const path = join(at, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) {
        hash.update(relative(dir, path));
        hash.update('\0');
        hash.update(readFileSync(path));
        hash.update('\0');
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

/**
 * What npm needs to find itself, its cache and the registry, and nothing
 * else: no key, token or secret from the caller's environment reaches code a
 * model wrote. The proxy and CA variables are there for a network that
 * routes through one; they name a route, not a credential.
 */
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
  'npm_config_cafile',
  'NPM_CONFIG_CAFILE',
];

export function passedEnv(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of PASSED_ENV) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

/** The command line this script takes. */
export function readArguments(argv: string[]):
  | {
      ok: true;
      root: string;
      minutes: number | undefined;
      container: string | undefined;
    }
  | { ok: false; error: string } {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { container: { type: 'string' } },
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const [root, minutes, ...rest] = parsed.positionals;
  if (!root)
    return {
      ok: false,
      error: 'Usage: build-candidates.ts <dir> [minutes] [--container <image>]',
    };
  if (rest.length > 0)
    return { ok: false, error: `Unexpected argument "${rest[0]}".` };
  const budget = minutes === undefined ? undefined : Number(minutes);
  if (budget !== undefined && !(Number.isFinite(budget) && budget > 0)) {
    return { ok: false, error: `"${minutes}" is not a number of minutes.` };
  }
  const container = parsed.values.container;
  if (container !== undefined && !/^[\w.\/:@-]+$/.test(container)) {
    return { ok: false, error: `"${container}" is not an image name.` };
  }
  return { ok: true, root, minutes: budget, container };
}

/**
 * How much a candidate may write in its container. The home holds the work
 * copy, node_modules and npm's cache: the generated stack's install is
 * about 160 MB, so 2 GB leaves room for a large one without letting a build
 * fill the runner's disk.
 */
const HOME_LIMIT = '2g';
const TMP_LIMIT = '512m';
const INODE_LIMIT = 400_000;

/** Where a candidate is copied inside its container, and built. */
const CONTAINER_WORK = '/home/node/work';

/**
 * The `docker run` that holds one candidate: its snapshot mounted
 * read-only, the image's unprivileged user, no capabilities, no privilege
 * escalation, limits on memory, CPU and processes, and a read-only image
 * with size-bounded space to write in. It idles until the
 * install and build are run in it with `docker exec`, and is removed with
 * `docker rm -f`, which ends everything inside it.
 */
export function containerStart(
  name: string,
  image: string,
  snapshot: string,
  env: Record<string, string>,
): string[] {
  const proxies = Object.entries(env)
    .filter(
      ([key, value]) =>
        /^no_proxy$/i.test(key) ||
        (/^https?_proxy$/i.test(key) && !carriesCredentials(value)),
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
    // Memory covers the two in-memory filesystems below as well as the
    // processes, since what is written there is charged to the container.
    '--memory',
    '6g',
    '--cpus',
    '2',
    '--pids-limit',
    '2048',
    // Nothing the candidate writes reaches the runner's disk (#237 review):
    // the image is read-only, and the only places it can write are its home
    // (the work copy, node_modules and npm's cache) and /tmp, each an
    // in-memory filesystem with a size and an inode limit.
    '--read-only',
    '--tmpfs',
    `/home/node:rw,exec,size=${HOME_LIMIT},nr_inodes=${INODE_LIMIT},uid=1000,gid=1000,mode=0755`,
    '--tmpfs',
    `/tmp:rw,exec,size=${TMP_LIMIT},nr_inodes=${INODE_LIMIT},mode=1777`,
    '--volume',
    `${snapshot}:/candidate:ro`,
    '--env',
    'HOME=/home/node',
    ...proxies,
    image,
    'sleep',
    'infinity',
  ];
}

/**
 * Whether a proxy setting may hold a user name or password. Such a proxy is
 * not passed into a candidate's container at all (#237 review): the
 * candidate's own code runs there and can read its environment, and a URL
 * with its credentials removed would only fail to authenticate. Read as
 * any `@`, the only way a URL carries them, so that a value the URL parser
 * would read some other way (`u:p@proxy:3128` parses as scheme `u:`) is
 * not let through.
 */
export function carriesCredentials(value: string): boolean {
  return value.includes('@');
}

/** Readable by anyone, so the container's own user can read the mount. */
function openToRead(path: string): void {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    chmodSync(path, 0o755);
    for (const entry of readdirSync(path)) openToRead(join(path, entry));
  } else if (stat.isFile()) {
    chmodSync(path, 0o644);
  }
}

let containers = 0;

/** One candidate's install and build, each in its own container. */
async function buildInContainer(
  project: string,
  snapshot: string,
  image: string,
): Promise<Built> {
  const name = `vibld-candidate-${process.pid}-${containers++}`;
  const docker = passedEnv();
  openToRead(snapshot);
  let result: Built;
  let removal: Awaited<ReturnType<typeof run>>;
  try {
    result = await buildInNamedContainer(
      project,
      snapshot,
      image,
      name,
      docker,
    );
  } finally {
    removal = await run(
      'docker',
      ['rm', '--force', name],
      tmpdir(),
      CONTAINER_REMOVE_TIMEOUT_MS,
      docker,
    );
  }
  // A container that is still there may still be running what the candidate
  // started, beside the next one. So a removal that failed fails this
  // candidate, whatever its build did, and the run starts no other
  // (#237 review).
  // A container that never started is already gone, and docker says so.
  const gone = removal.ok || /No such container/i.test(removal.output);
  if (!gone) {
    return {
      project,
      ok: false,
      stage: 'cleanup',
      detail: `docker rm --force ${name} failed\n${tail(removal.output)}`,
    };
  }
  return result;
}

/** The install and build, in a container that `buildInContainer` removes. */
async function buildInNamedContainer(
  project: string,
  snapshot: string,
  image: string,
  name: string,
  docker: Record<string, string>,
): Promise<Built> {
  const started = await run(
    'docker',
    containerStart(name, image, snapshot, docker),
    tmpdir(),
    CONTAINER_START_TIMEOUT_MS,
    docker,
  );
  if (!started.ok) {
    return {
      project,
      ok: false,
      stage: 'container',
      detail: tail(started.output),
    };
  }
  const install = await run(
    'docker',
    [
      'exec',
      name,
      'sh',
      '-c',
      `mkdir -p ${CONTAINER_WORK} && cp -R /candidate/. ${CONTAINER_WORK} && cd ${CONTAINER_WORK} && npm install --ignore-scripts --no-audit --no-fund`,
    ],
    tmpdir(),
    INSTALL_TIMEOUT_MS,
    docker,
  );
  if (!install.ok) {
    return {
      project,
      ok: false,
      stage: 'install',
      detail: tail(install.output),
    };
  }
  const built = await run(
    'docker',
    ['exec', '--workdir', CONTAINER_WORK, name, 'npm', 'run', 'build'],
    tmpdir(),
    BUILD_TIMEOUT_MS,
    docker,
  );
  return {
    project,
    ok: built.ok,
    stage: built.ok ? 'done' : 'build',
    detail: built.ok ? '' : tail(built.output),
  };
}

interface Built {
  project: string;
  ok: boolean;
  stage:
    | 'container'
    | 'install'
    | 'build'
    | 'time'
    | 'tampered'
    | 'cleanup'
    | 'halted'
    | 'done';
  detail: string;
}

/**
 * Build one candidate from its snapshot, in a fresh copy with a fresh HOME
 * and npm cache, and throw both away afterwards.
 */
async function build(
  project: string,
  snapshot: string,
  expected: string,
  container: string | undefined,
): Promise<Built> {
  if (digest(snapshot) !== expected) {
    return {
      project,
      ok: false,
      stage: 'tampered',
      detail: 'changed after it was copied, before its turn to build',
    };
  }
  if (container) return buildInContainer(project, snapshot, container);
  const work = mkdtempSync(join(tmpdir(), 'candidate-'));
  const home = mkdtempSync(join(tmpdir(), 'candidate-home-'));
  try {
    cpSync(snapshot, work, { recursive: true });
    const env = {
      ...passedEnv(),
      HOME: home,
      npm_config_cache: join(home, '.npm'),
    };
    const install = await run(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
      work,
      INSTALL_TIMEOUT_MS,
      env,
    );
    if (!install.ok) {
      return {
        project,
        ok: false,
        stage: 'install',
        detail: tail(install.output),
      };
    }
    const built = await run(
      'npm',
      ['run', 'build'],
      work,
      BUILD_TIMEOUT_MS,
      env,
    );
    return {
      project,
      ok: built.ok,
      stage: built.ok ? 'done' : 'build',
      detail: built.ok ? '' : tail(built.output),
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const args = readArguments(process.argv.slice(2));
  if (!args.ok) {
    console.error(args.error);
    return 1;
  }
  const { root, minutes, container } = args;
  if (!existsSync(root)) {
    console.error(`${root} does not exist.`);
    return 1;
  }
  const deadline =
    minutes === undefined
      ? Number.POSITIVE_INFINITY
      : Date.now() + minutes * 60_000;
  const projects = findProjects(root);
  if (projects.length === 0) {
    // Nothing to build is a failure, not a pass: a run that was meant to
    // write candidates and wrote none has not shown that anything builds.
    console.error(`No project with a package.json under ${root}.`);
    return 1;
  }
  // Every candidate copied and hashed before any of them runs.
  const stage = mkdtempSync(join(tmpdir(), 'candidates-'));
  const snapshots = projects.map((project, index) => {
    const snapshot = join(stage, String(index));
    cpSync(project, snapshot, {
      recursive: true,
      filter: (source) => !source.split(/[\\/]/).includes('node_modules'),
    });
    return { project, snapshot, expected: digest(snapshot) };
  });
  const results: (Built & { name: string })[] = [];
  try {
    let halted = false;
    for (const { project, snapshot, expected } of snapshots) {
      const result: Built = halted
        ? {
            project,
            ok: false,
            stage: 'halted',
            detail:
              "not started: an earlier candidate's container could not be removed",
          }
        : canStart(Date.now(), deadline, Boolean(container))
          ? await build(project, snapshot, expected, container)
          : {
              project,
              ok: false,
              stage: 'time',
              detail: 'not started: the time for this run was spent',
            };
      if (result.stage === 'cleanup') halted = true;
      const name = relative(root, project) || '.';
      console.log(
        `${result.ok ? 'ok  ' : 'FAIL'}  ${name}${result.ok ? '' : ` (${describe(result.stage)})`}`,
      );
      if (!result.ok) console.log(result.detail.replace(/^/gm, '        '));
      results.push({ ...result, name });
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  const failed = results.filter((result) => !result.ok);
  const summary = [
    '## Do the candidates build?',
    '',
    '| Project | Result |',
    '| --- | --- |',
    ...results.map(
      (result) =>
        `| \`${result.name}\` | ${result.ok ? 'builds' : `**${describe(result.stage)}**`} |`,
    ),
    '',
    `${results.length - failed.length}/${results.length} build with \`npm install\` and \`npm run build\`.`,
  ].join('\n');
  console.log(
    `\n${results.length - failed.length}/${results.length} projects build`,
  );
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
  return failed.length === 0 ? 0 : 1;
}

/** How a failed stage reads in the log and the summary. */
function describe(stage: Built['stage']): string {
  if (stage === 'time') return 'not built: out of time';
  if (stage === 'tampered') return 'not built: changed before its turn';
  if (stage === 'container') return 'not built: its container did not start';
  if (stage === 'cleanup') return 'failed: its container could not be removed';
  if (stage === 'halted') return 'not built: an earlier container was left';
  return `${stage} failed`;
}

if (isEntry(import.meta.url, process.argv[1])) {
  process.exitCode = await main();
}
