/**
 * A published site on its owner's own domain (docs/decisions.md D189).
 *
 * Cloudflare for SaaS on the preview zone: each domain is a custom
 * hostname there, the owner points it at `CUSTOM_HOSTNAME_TARGET` with one
 * CNAME record, Cloudflare checks the record and issues the certificate,
 * and from then on the domain's requests arrive at apps/preview's route
 * like any other on the zone. apps/preview hands them to apps/publish,
 * which finds the site by the hostname in `custom_domains`.
 *
 * This file is the hostname's rules, the Cloudflare calls and the table.
 * Who may do what is `domain-handlers.ts`.
 */

/** Where the owner's CNAME points, unless a deployment says otherwise. */
export const DEFAULT_CUSTOM_HOSTNAME_TARGET = 'domains.vibld-preview.dev';

/**
 * Hostnames nobody may connect, by suffix: this product's own domains. A
 * site there would read as vibld's, and the preview zone's names are
 * already served by the route the custom hostname would share.
 */
const PLATFORM_SUFFIXES = ['vibld.com', 'vibld-preview.dev'];

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export type HostnameCheck =
  { ok: true; hostname: string } | { ok: false; error: string };

/**
 * The hostname somebody typed, as DNS has it, or why it cannot be one.
 *
 * Lenient about what people paste (a scheme, a path, a trailing dot,
 * capitals, a name in another script, which becomes its `xn--` form) and
 * strict about what is left: at least two labels, each a DNS label, a
 * top-level domain that is not all digits, and nothing of this product's.
 */
export function normalizeHostname(input: unknown): HostnameCheck {
  if (typeof input !== 'string' || input.trim() === '') {
    return { ok: false, error: 'Enter a domain, such as www.example.com.' };
  }
  let raw = input.trim().toLowerCase();
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  raw = raw.split(/[/?#]/, 1)[0]!;
  let hostname: string;
  try {
    const url = new URL(`http://${raw}`);
    if (url.port !== '' || url.username !== '' || url.password !== '') {
      return { ok: false, error: 'Enter the domain only, with no port.' };
    }
    hostname = url.hostname;
  } catch {
    return { ok: false, error: `"${input.trim()}" is not a domain.` };
  }
  hostname = hostname.replace(/\.$/, '');
  const labels = hostname.split('.');
  if (
    hostname.length > 253 ||
    labels.length < 2 ||
    !labels.every((label) => LABEL.test(label)) ||
    /^\d+$/.test(labels[labels.length - 1]!)
  ) {
    return { ok: false, error: `"${input.trim()}" is not a domain.` };
  }
  if (
    PLATFORM_SUFFIXES.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
    )
  ) {
    return {
      ok: false,
      error: 'That domain belongs to vibld. Use a domain you own.',
    };
  }
  return { ok: true, hostname };
}

/** The settings custom domains need: the zone, a token for it, the target. */
export interface CustomHostnameEnv {
  /** Public: the preview zone's id, where the custom hostnames are made. */
  CUSTOM_HOSTNAME_ZONE_ID?: string;
  /** Secret: a token with SSL and Certificates: Edit on that zone. */
  CUSTOM_HOSTNAME_API_TOKEN?: string;
  /** Public: what the owner's CNAME points at, the zone's fallback origin. */
  CUSTOM_HOSTNAME_TARGET?: string;
}

export function customHostnamesConfigured(env: CustomHostnameEnv): boolean {
  return Boolean(env.CUSTOM_HOSTNAME_ZONE_ID && env.CUSTOM_HOSTNAME_API_TOKEN);
}

export function customHostnameTarget(env: CustomHostnameEnv): string {
  return env.CUSTOM_HOSTNAME_TARGET || DEFAULT_CUSTOM_HOSTNAME_TARGET;
}

/** A DNS record the owner adds at their DNS provider. */
export interface DnsRecord {
  type: 'CNAME' | 'TXT';
  name: string;
  value: string;
}

/**
 * Where a domain stands. `active` serves the site; `pending` waits on the
 * owner's DNS record or the certificate; `failed` is a check Cloudflare
 * gave up on, which removing the domain and adding it again restarts.
 */
export type DomainStatus = 'active' | 'pending' | 'failed';

export interface CustomHostnameState {
  id: string;
  hostname: string;
  status: DomainStatus;
  /** Records still needed beyond the CNAME, for the checks still open. */
  records: DnsRecord[];
  /** What Cloudflare said was wrong, in its words. */
  errors: string[];
}

interface CloudflareCustomHostname {
  id?: unknown;
  hostname?: unknown;
  status?: unknown;
  verification_errors?: unknown;
  ownership_verification?: { type?: unknown; name?: unknown; value?: unknown };
  ssl?: {
    status?: unknown;
    validation_errors?: unknown;
    validation_records?: unknown;
  };
}

const FAILED = new Set([
  'blocked',
  'moved',
  'deleted',
  'validation_timed_out',
  'issuance_timed_out',
  'deployment_timed_out',
  'deletion_timed_out',
]);

function messages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry: unknown) =>
      typeof entry === 'string'
        ? entry
        : typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as { message?: unknown }).message === 'string'
          ? (entry as { message: string }).message
          : null,
    )
    .filter((entry): entry is string => entry !== null);
}

/** Cloudflare's answer about one custom hostname, as the builder shows it. */
export function readCustomHostname(
  raw: CloudflareCustomHostname,
): CustomHostnameState | null {
  if (typeof raw.id !== 'string' || typeof raw.hostname !== 'string') {
    return null;
  }
  const hostnameStatus = typeof raw.status === 'string' ? raw.status : '';
  const sslStatus = typeof raw.ssl?.status === 'string' ? raw.ssl.status : '';
  const status: DomainStatus =
    hostnameStatus === 'active' && sslStatus === 'active'
      ? 'active'
      : FAILED.has(hostnameStatus) || FAILED.has(sslStatus)
        ? 'failed'
        : 'pending';

  const records: DnsRecord[] = [];
  const ownership = raw.ownership_verification;
  if (
    hostnameStatus !== 'active' &&
    ownership?.type === 'txt' &&
    typeof ownership.name === 'string' &&
    typeof ownership.value === 'string'
  ) {
    records.push({ type: 'TXT', name: ownership.name, value: ownership.value });
  }
  if (sslStatus !== 'active' && Array.isArray(raw.ssl?.validation_records)) {
    for (const entry of raw.ssl.validation_records as unknown[]) {
      const record = (entry ?? {}) as {
        txt_name?: unknown;
        txt_value?: unknown;
      };
      if (
        typeof record.txt_name === 'string' &&
        typeof record.txt_value === 'string'
      ) {
        records.push({
          type: 'TXT',
          name: record.txt_name,
          value: record.txt_value,
        });
      }
    }
  }
  return {
    id: raw.id,
    hostname: raw.hostname,
    status,
    records,
    errors:
      status === 'active'
        ? []
        : [
            ...messages(raw.verification_errors),
            ...messages(raw.ssl?.validation_errors),
          ],
  };
}

/** Cloudflare's code for a hostname another custom hostname already has. */
const DUPLICATE_HOSTNAME = 1406;

export type CloudflareResult<T> =
  { ok: true; value: T } | { ok: false; duplicate: boolean; error: string };

/**
 * The three calls this needs, on the preview zone's custom hostnames.
 * `fetchImpl` is the test seam; the token never leaves this object.
 */
export class CustomHostnames {
  readonly #zone: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;

  constructor(
    zone: string,
    token: string,
    fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    this.#zone = zone;
    this.#token = token;
    this.#fetch = fetchImpl;
  }

  async #call(
    path: string,
    init: { method: string; body?: unknown },
  ): Promise<CloudflareResult<unknown>> {
    let response: Response;
    try {
      response = await this.#fetch(
        `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(this.#zone)}/custom_hostnames${path}`,
        {
          method: init.method,
          headers: {
            authorization: `Bearer ${this.#token}`,
            ...(init.body === undefined
              ? {}
              : { 'content-type': 'application/json' }),
          },
          ...(init.body === undefined
            ? {}
            : { body: JSON.stringify(init.body) }),
        },
      );
    } catch (error) {
      console.error('custom hostname request failed', error);
      return { ok: false, duplicate: false, error: 'unreachable' };
    }
    const body = (await response.json().catch(() => null)) as {
      success?: unknown;
      result?: unknown;
      errors?: unknown;
    } | null;
    if (response.ok && body?.success === true) {
      return { ok: true, value: body.result };
    }
    const errors = Array.isArray(body?.errors)
      ? (body.errors as { code?: unknown; message?: unknown }[])
      : [];
    return {
      ok: false,
      duplicate: errors.some((entry) => entry.code === DUPLICATE_HOSTNAME),
      error:
        errors
          .map((entry) => entry.message)
          .filter((message) => typeof message === 'string')
          .join('; ') || `HTTP ${response.status}`,
    };
  }

  async create(
    hostname: string,
  ): Promise<CloudflareResult<CustomHostnameState>> {
    const made = await this.#call('', {
      method: 'POST',
      body: { hostname, ssl: CERTIFICATE },
    });
    return this.#state(made);
  }

  /**
   * Ask Cloudflare to validate a hostname that is not active again. It is created
   * before its owner has added the CNAME (the builder shows the record
   * only after connecting), and Cloudflare's HTTP validation then needs the
   * hostname's SSL settings sent again once the record is in place.
   */
  async recheck(id: string): Promise<CloudflareResult<CustomHostnameState>> {
    return this.#state(
      await this.#call(`/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: { ssl: CERTIFICATE },
      }),
    );
  }

  async get(id: string): Promise<CloudflareResult<CustomHostnameState>> {
    return this.#state(
      await this.#call(`/${encodeURIComponent(id)}`, { method: 'GET' }),
    );
  }

  /** Removed, or already gone: either way it no longer exists. */
  async remove(id: string): Promise<CloudflareResult<null>> {
    const removed = await this.#call(`/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (removed.ok || /not found|does not exist/i.test(removed.error)) {
      return { ok: true, value: null };
    }
    return removed;
  }

  #state(
    result: CloudflareResult<unknown>,
  ): CloudflareResult<CustomHostnameState> {
    if (!result.ok) return result;
    const state = readCustomHostname(
      (result.value ?? {}) as CloudflareCustomHostname,
    );
    return state
      ? { ok: true, value: state }
      : { ok: false, duplicate: false, error: 'unreadable answer' };
  }
}

/** The certificate each custom hostname asks for, on create and recheck. */
const CERTIFICATE = {
  method: 'http',
  type: 'dv',
  settings: { min_tls_version: '1.2' },
} as const;

/** A row of `custom_domains` (`0053_custom_domains.sql`). */
export interface CustomDomainRow {
  hostname: string;
  projectId: string;
  userId: string;
  cloudflareId: string;
}

export class CustomDomainStore {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  async forProject(projectId: string): Promise<CustomDomainRow | null> {
    const row = await this.#db
      .prepare(
        `SELECT hostname, project_id, user_id, cloudflare_id
           FROM custom_domains WHERE project_id = ?1`,
      )
      .bind(projectId)
      .first<{
        hostname: string;
        project_id: string;
        user_id: string;
        cloudflare_id: string;
      }>();
    return row
      ? {
          hostname: row.hostname,
          projectId: row.project_id,
          userId: row.user_id,
          cloudflareId: row.cloudflare_id,
        }
      : null;
  }

  /**
   * Record a domain. False when the hostname or the project already has
   * one, which the two UNIQUE keys decide rather than a read beforehand,
   * or when the project is gone.
   */
  async add(row: CustomDomainRow, now: string): Promise<boolean> {
    // Only for a project its owner still has, in the same statement, so a
    // deletion that ran while Cloudflare was being asked leaves no row.
    const result = await this.#db
      .prepare(
        `INSERT INTO custom_domains
           (hostname, project_id, user_id, cloudflare_id, created_at, checked_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?5
          WHERE EXISTS (SELECT 1 FROM projects WHERE id = ?2 AND user_id = ?3)
         ON CONFLICT DO NOTHING`,
      )
      .bind(row.hostname, row.projectId, row.userId, row.cloudflareId, now)
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }

  /**
   * Drop the row for the custom hostname that was removed at Cloudflare,
   * and only that one: a domain connected to the project since it was
   * read is somebody's newer registration, and keeps its row.
   */
  async remove(projectId: string, cloudflareId: string): Promise<void> {
    await this.#db
      .prepare(
        'DELETE FROM custom_domains WHERE project_id = ?1 AND cloudflare_id = ?2',
      )
      .bind(projectId, cloudflareId)
      .run();
  }

  /**
   * The rows the nightly plan check should look at next: never checked
   * first, then the longest since. One query. `orphaned` is a row whose
   * project is gone, left by a deletion that could not remove it at
   * Cloudflare (`project-handlers.ts`).
   */
  async dueForCheck(
    limit: number,
  ): Promise<(CustomDomainRow & { orphaned: boolean })[]> {
    const rows = await this.#db
      .prepare(
        `SELECT d.hostname, d.project_id, d.user_id, d.cloudflare_id,
                NOT EXISTS (SELECT 1 FROM projects AS p
                             WHERE p.id = d.project_id) AS orphaned
           FROM custom_domains AS d
          ORDER BY d.checked_at, d.hostname
          LIMIT ?1`,
      )
      .bind(limit)
      .all<{
        hostname: string;
        project_id: string;
        user_id: string;
        cloudflare_id: string;
        orphaned: number;
      }>();
    return (rows.results ?? []).map((row) => ({
      hostname: row.hostname,
      projectId: row.project_id,
      userId: row.user_id,
      cloudflareId: row.cloudflare_id,
      orphaned: row.orphaned === 1,
    }));
  }

  async markChecked(hostname: string, now: string): Promise<void> {
    await this.#db
      .prepare('UPDATE custom_domains SET checked_at = ?2 WHERE hostname = ?1')
      .bind(hostname, now)
      .run();
  }
}

/**
 * The TXT record that proves an account controls a domain (D189), asked
 * for before the domain is registered at Cloudflare. Without it, anyone on
 * a paid plan could claim somebody else's domain first: the real owner
 * would be refused it as taken, and the CNAME they then add would activate
 * the claimer's registration and serve the claimer's site there (Codex
 * review of internal PR 410).
 *
 * The value is bound to the account and the hostname, so a record one
 * account was shown proves nothing for another. It is not secret: knowing
 * it is no use without the domain's DNS to put it in.
 */
export async function ownershipRecord(
  userId: string,
  hostname: string,
): Promise<DnsRecord> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`vibld-domain\n${userId}\n${hostname}`),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return {
    type: 'TXT',
    name: `_vibld.${hostname}`,
    value: `vibld-verify=${hex.slice(0, 32)}`,
  };
}

/** A name's TXT values, or null when the lookup itself failed. */
export type ResolveTxt = (name: string) => Promise<string[] | null>;

/**
 * Look a TXT record up over DNS over HTTPS (Cloudflare's resolver, JSON
 * form). A name with no records answers an empty list; a resolver that
 * could not be asked answers null, which is not the same as "not there".
 */
export function dohResolveTxt(fetchImpl: typeof fetch = fetch): ResolveTxt {
  return async (name) => {
    try {
      const response = await fetchImpl(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`,
        { headers: { accept: 'application/dns-json' } },
      );
      if (!response.ok) return null;
      const body = (await response.json()) as {
        Status?: number;
        Answer?: { type?: number; data?: string }[];
      };
      // 0 is NOERROR, 3 is NXDOMAIN: both are answers. Anything else is
      // the resolver failing to find out.
      if (body.Status !== 0 && body.Status !== 3) return null;
      return (body.Answer ?? [])
        .filter(
          (answer) => answer.type === 16 && typeof answer.data === 'string',
        )
        .map((answer) => {
          // A TXT value comes quoted, and a long one in several quoted
          // pieces that are one string.
          const pieces = [...answer.data!.matchAll(/"((?:[^"\\]|\\.)*)"/g)];
          return pieces.length === 0
            ? answer.data!
            : pieces.map((piece) => piece[1]!.replace(/\\(.)/g, '$1')).join('');
        });
    } catch {
      return null;
    }
  };
}
