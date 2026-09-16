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

  if (mode === 'open') {
    return {
      ok: true,
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

  // The browser half of Clerk. Unset means the build inlines no key, the
  // shell renders no session, nothing carries a token, and `/api/config` has
  // nobody to identify: the admin above never reaches the panel. The same
  // outage as an empty list, from the other side.
  //
  // Only asked of a closed deployment. A deploy with no Clerk at all is a
  // supported shape, and it is being closed that makes an identity provider
  // load-bearing.
  if ((env.CLERK_PUBLISHABLE_KEY ?? '') === '') {
    errors.push(
      'This deployment is invite-only and CLERK_PUBLISHABLE_KEY is empty, so the browser has no way to sign anybody in. Nobody can be identified, so nobody can be admitted and no admin can reach the invite panel. ' +
        `Set CLERK_PUBLISHABLE_KEY (the pk_live_... key from https://dashboard.clerk.com) at ${ADMINS_URL} and run this workflow again.`,
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
