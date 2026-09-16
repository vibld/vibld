/**
 * Decides, before a deploy writes anything, whether the deployment it is
 * about to publish would let anybody in.
 *
 * This exists as a module rather than as shell in the workflow because five
 * findings on that step were the same mistake: a condition that did not
 * establish the property it was written for. Four of those were an
 * approximation of a rule the application already owns, written in a
 * different language with different semantics. A comma is a separator in
 * both; `[[:space:]]` in awk and `\s` in JavaScript are not the same set,
 * and an entry that differs between them is exactly the entry nobody
 * notices.
 *
 * So the deploy asks the application. `parseAccessMode` says whether the
 * door is open, `parsePlatformAdmins` says what the admin list means, and
 * `normaliseEmail` says whether a member of it could be an address. The
 * Worker will answer those three questions the same way at runtime, because
 * it is the same code.
 */
import { normaliseEmail, parseAccessMode } from '../worker/access.ts';
import { parsePlatformAdmins } from '../worker/platform-admins.ts';

export interface PreflightEnv {
  VIBLD_ACCESS_MODE?: string | undefined;
  VIBLD_PLATFORM_ADMINS?: string | undefined;
  CLERK_PUBLISHABLE_KEY?: string | undefined;
}

export interface Preflight {
  /** False stops the deploy before a single secret is written. */
  ok: boolean;
  mode: 'open' | 'invite';
  /** How many entries could actually match a Clerk-verified email. */
  admins: number;
  warnings: string[];
  errors: string[];
  summary: string;
}

const ADMINS_URL = 'https://github.com/vibld/vibld/settings/environments';

export function accessPreflight(env: PreflightEnv): Preflight {
  const mode = parseAccessMode(env.VIBLD_ACCESS_MODE);
  const warnings: string[] = [];
  const errors: string[] = [];

  /*
   * The browser half of Clerk, asked of every deployment this workflow
   * makes, open or closed.
   *
   * It was asked only of a closed one at first, on the reasoning that a
   * deployment with no Clerk is a supported shape. That is true of `pnpm
   * dev` and of a static-only host, and not of anything this workflow
   * produces: `wrangler.jsonc` gives every Worker it deploys a
   * CLERK_FRONTEND_API_URL, so `resolvePrincipal` demands a bearer token on
   * every `/api/*` route. With no publishable key the shell renders no
   * session, sends no token, and receives 401 from everything including
   * `/api/config`. An open deployment nobody can use is not open.
   */
  if ((env.CLERK_PUBLISHABLE_KEY ?? '') === '') {
    errors.push(
      'CLERK_PUBLISHABLE_KEY is empty, so the browser has no way to sign anybody in. This Worker always has a Clerk issuer configured, so every /api/* request would be refused for want of a token: nobody could generate anything, and on a closed deployment no admin could reach the invite panel either. ' +
        `Set CLERK_PUBLISHABLE_KEY (the pk_live_... key from https://dashboard.clerk.com) at ${ADMINS_URL} and run this workflow again.`,
    );
  }

  if (mode === 'open') {
    return {
      ok: errors.length === 0,
      mode,
      admins: 0,
      warnings,
      errors,
      summary: 'Access will be OPEN. Anybody who signs up can use the builder.',
    };
  }

  // Said out loud rather than silently coerced. A value that was meant to
  // open the deployment and did not is worth seeing in the run, and
  // `parseAccessMode` opens only on the exact word.
  const raw = env.VIBLD_ACCESS_MODE;
  if (raw !== undefined && raw !== '' && raw !== 'invite') {
    warnings.push(
      `VIBLD_ACCESS_MODE is '${raw}', which is not the exact string 'open'. This deployment stays invite-only.`,
    );
  }

  const admins = [...parsePlatformAdmins(env.VIBLD_PLATFORM_ADMINS)].filter(
    (entry) => normaliseEmail(entry) !== null,
  ).length;
  if (admins === 0) {
    errors.push(
      'This deployment is invite-only and VIBLD_PLATFORM_ADMINS holds no usable admin address, so nobody can reach the admin panel and nobody can issue an invite. Every account, including yours, would be refused with no way to let anybody in. ' +
        `Set VIBLD_PLATFORM_ADMINS (a comma-separated list of admin email addresses) at ${ADMINS_URL} and run this workflow again.`,
    );
  }

  return {
    ok: errors.length === 0,
    mode,
    admins,
    warnings,
    errors,
    summary: `Access will be INVITE ONLY, with ${admins} admin address(es).`,
  };
}

/**
 * The workflow's entry point: report through Actions' own channels and stop
 * the run if the deployment would admit nobody.
 */
export function main(
  env: PreflightEnv & { GITHUB_STEP_SUMMARY?: string | undefined },
  write: (path: string, line: string) => void,
  log: (line: string) => void,
): number {
  const result = accessPreflight(env);
  for (const warning of result.warnings) log(`::warning::${warning}`);
  for (const error of result.errors) log(`::error::${error}`);
  if (env.GITHUB_STEP_SUMMARY) {
    write(env.GITHUB_STEP_SUMMARY, `${result.summary}\n`);
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  const { appendFileSync } = await import('node:fs');
  process.exitCode = main(
    process.env,
    (path, line) => appendFileSync(path, line),
    (line) => {
      console.log(line);
    },
  );
}
