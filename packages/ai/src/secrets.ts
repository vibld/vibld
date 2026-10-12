/**
 * Secret keys written into a project's files (D213).
 *
 * A generated project is exported, pushed to GitHub and served to every
 * visitor, so a key in its source is a key published. The model is told to
 * read keys from environment variables; this is the check that it did. It
 * looks only for strings whose shape names a provider's secret, so it is
 * confident enough to be a design error: an `sk_live_` Stripe key, an AWS
 * access key id, a PEM private key. Keys that are public by design are left
 * alone: Stripe's `pk_` keys, Supabase's anon key, Firebase's browser key.
 *
 * A finding names the file and the kind of key, never the key itself: the
 * report reaches repair prompts and logs, which must not carry it either.
 */

export interface SecretFinding {
  path: string;
  /** What the key is, in words: "a Stripe secret key". */
  kind: string;
}

interface SecretShape {
  kind: string;
  pattern: RegExp;
  /** A further test on the match, for shapes a regex alone cannot settle. */
  confirm?: (match: string) => boolean;
}

/**
 * Bounded on both sides so a longer identifier is not read as a key: a
 * match must not be preceded or followed by a word character or a hyphen.
 */
const SHAPES: readonly SecretShape[] = [
  {
    kind: 'an Anthropic API key',
    pattern: /(?<![\w-])sk-ant-[A-Za-z0-9_-]{32,}(?![\w-])/g,
  },
  {
    kind: 'an OpenAI API key',
    pattern:
      /(?<![\w-])sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}(?![\w-])/g,
    confirm: (match) => !match.startsWith('sk-ant-'),
  },
  {
    kind: 'a Stripe secret key',
    pattern: /(?<![\w-])(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}(?![\w-])/g,
  },
  {
    kind: 'a Stripe webhook signing secret',
    pattern: /(?<![\w-])whsec_[A-Za-z0-9+/=]{24,}(?![\w-])/g,
  },
  {
    kind: 'an AWS access key id',
    pattern: /(?<![\w-])(?:AKIA|ASIA)[0-9A-Z]{16}(?![\w-])/g,
  },
  {
    kind: 'a GitHub token',
    // Classic tokens, installation tokens in the `ghs_<app id>_<JWT>` form,
    // and fine-grained tokens.
    pattern:
      /(?<![\w-])(?:gh[pousr]_[A-Za-z0-9]{36,}|ghs_[0-9]+_[A-Za-z0-9_.-]{100,}|github_pat_[A-Za-z0-9_]{60,})(?![\w-])/g,
  },
  {
    kind: 'a Slack token',
    pattern:
      /(?<![\w-])(?:(?:xoxe\.)?(?:xox[abprs]|xapp)|xoxe)-[A-Za-z0-9-]{20,}(?![\w-])/g,
  },
  {
    kind: 'a SendGrid API key',
    pattern: /(?<![\w-])SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}(?![\w-])/g,
  },
  {
    kind: 'a private key',
    // The header and a full first line of key, so a doc that only names
    // the format ("-----BEGIN RSA PRIVATE KEY-----\nMIIE...") is not one.
    pattern:
      /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----(?:\\n|\s)+[A-Za-z0-9+/=]{60,}/g,
  },
  {
    kind: 'a Supabase secret key',
    // The format replacing the service role JWT. `sb_publishable_` is public.
    pattern: /(?<![\w-])sb_secret_[A-Za-z0-9_-]{20,}(?![\w-])/g,
  },
  {
    kind: 'a Supabase access token',
    // A personal access token for the Management API, across every project.
    pattern: /(?<![\w-])sbp_[A-Za-z0-9]{40,}(?![\w-])/g,
  },
  {
    kind: 'a Supabase service role key',
    pattern:
      /(?<![\w-])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}(?![\w-])/g,
    confirm: isSupabaseServiceRole,
  },
];

/**
 * A documentation placeholder rather than a key: a run of one repeated
 * character (`sk_test_xxxxxxxx...`), or a segment that starts with a word
 * such examples use (`sk-proj-your-key-here...`). Only at the start of a
 * segment, so a real key whose random body happens to contain "fake" is
 * still reported. AWS's documented sample ids end in EXAMPLE
 * (`AKIAIOSFODNN7EXAMPLE`).
 */
const PLACEHOLDER =
  /(.)\1{7,}|(?:^|[^A-Za-z0-9])(?:your|example|placeholder|replace|dummy|fake)|example$/i;

/**
 * Whether a JWT is a Supabase service role key: its `role` is
 * `service_role` and it carries Supabase's own claims (`iss: "supabase"` or
 * a project `ref`), so another issuer's test token is not read as one.
 */
function isSupabaseServiceRole(token: string): boolean {
  const payload = token.split('.')[1];
  if (!payload) return false;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(base64)) as {
      role?: unknown;
      iss?: unknown;
      ref?: unknown;
    };
    return (
      claims.role === 'service_role' &&
      (claims.iss === 'supabase' || typeof claims.ref === 'string')
    );
  } catch {
    return false;
  }
}

/**
 * Every key-shaped secret in the files, at most one finding per kind per
 * file. Comments are read too: a key in a comment is published as surely
 * as one in code.
 */
export function findSecrets(
  files: readonly { path: string; content: string }[],
): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const file of files) {
    for (const shape of SHAPES) {
      for (const [match] of file.content.matchAll(shape.pattern)) {
        if (PLACEHOLDER.test(match)) continue;
        if (shape.confirm && !shape.confirm(match)) continue;
        findings.push({ path: file.path, kind: shape.kind });
        break;
      }
    }
  }
  return findings;
}
