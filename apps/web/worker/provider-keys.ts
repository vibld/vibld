/**
 * Model provider keys set from the admin panel (docs/decisions.md D127,
 * D131, D132):
 *
 *     GET  /api/admin/keys           each provider: where its key comes
 *                                    from, and its last four characters
 *     POST /api/admin/keys           set or replace one provider's key
 *     POST /api/admin/keys/remove    remove it, falling back to the secret
 *
 * A key is stored only as its AES-GCM encryption under
 * `VIBLD_KEY_ENCRYPTION_KEY`, a Worker secret the deploy creates once
 * (D132). Nothing here returns a key: the routes answer with the last four
 * characters, and the only place a key is decrypted is `withPanelKeys`,
 * which lays the stored keys over the Worker's own (D131) for the request,
 * the nightly job and the generation workflow.
 *
 * The admin check runs before the handler (`requireAdmin` in index.ts).
 */

import type { AuditEntry } from './admin-store.ts';

export const KEY_PROVIDERS = ['anthropic', 'deepseek', 'openai'] as const;
export type KeyProvider = (typeof KEY_PROVIDERS)[number];

/** The Worker variable each provider's key is read from. */
export const KEY_ENV = {
  anthropic: 'ANTHROPIC_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
} as const satisfies Record<KeyProvider, string>;

export const PROVIDER_NAMES: Record<KeyProvider, string> = {
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
};

export interface ProviderKeysEnv {
  DB?: D1Database;
  VIBLD_KEY_ENCRYPTION_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  OPENAI_API_KEY?: string;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function isProvider(value: unknown): value is KeyProvider {
  return (KEY_PROVIDERS as readonly unknown[]).includes(value);
}

// -------------------------------------------------------------------------
// Encryption.
// -------------------------------------------------------------------------

function fromBase64(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(text.trim());
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * The AES-256-GCM key `VIBLD_KEY_ENCRYPTION_KEY` holds (32 bytes, base64),
 * or null when it is unset or not that shape. Null turns the panel's keys
 * off: nothing is stored, and nothing stored is read.
 */
export async function encryptionKey(
  secret: string | undefined,
): Promise<CryptoKey | null> {
  if (!secret) return null;
  const raw = fromBase64(secret);
  if (!raw || raw.length !== 32) return null;
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function sealKey(
  key: CryptoKey,
  provider: KeyProvider,
  plaintext: string,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(provider) },
    key,
    encoder.encode(plaintext),
  );
  return { ciphertext: toBase64(new Uint8Array(sealed)), iv: toBase64(iv) };
}

/** The key a row holds, or null where it does not open under this key. */
export async function openKey(
  key: CryptoKey,
  provider: KeyProvider,
  ciphertext: string,
  iv: string,
): Promise<string | null> {
  const data = fromBase64(ciphertext);
  const nonce = fromBase64(iv);
  if (!data || !nonce) return null;
  try {
    const opened = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: encoder.encode(provider) },
      key,
      data,
    );
    return decoder.decode(opened);
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------------
// The rows.
// -------------------------------------------------------------------------

interface KeyRow {
  provider: string;
  ciphertext: string;
  iv: string;
  last4: string;
  updated_at: string;
  updated_by: string;
}

async function readRows(db: D1Database): Promise<KeyRow[]> {
  const result = await db
    .prepare(`SELECT * FROM provider_keys ORDER BY provider`)
    .all<KeyRow>();
  return result.results ?? [];
}

// -------------------------------------------------------------------------
// Laying the panel's keys over the Worker's own.
// -------------------------------------------------------------------------

/** How long an isolate keeps the keys it read before reading them again. */
export const KEY_CACHE_MS = 30_000;

interface KeyCache {
  db: D1Database;
  secret: string;
  at: number;
  /**
   * The read, kept as the promise rather than its result, so requests that
   * arrive together while it is in flight share it instead of each reading
   * the table.
   */
  keys: Promise<Partial<Record<KeyProvider, string>> | null>;
}

let cache: KeyCache | null = null;

/**
 * The D1 queries `withPanelKeys` may spend in one invocation: one read of
 * the table, where there is a table to read. For the nightly job, which
 * plans its work on a fixed query allowance (index.ts `scheduled`).
 */
export function panelKeyQueries(env: ProviderKeysEnv): number {
  return env.DB && env.VIBLD_KEY_ENCRYPTION_KEY ? 1 : 0;
}

/** Forget the keys this isolate read, after it changed them. */
export function forgetPanelKeys(): void {
  cache = null;
}

/** Every stored key that opens under `secret`; null when none can be read. */
async function readPanelKeys(
  db: D1Database,
  secret: string,
): Promise<Partial<Record<KeyProvider, string>> | null> {
  const key = await encryptionKey(secret);
  if (!key) return null;
  const keys: Partial<Record<KeyProvider, string>> = {};
  for (const row of await readRows(db)) {
    if (!isProvider(row.provider)) continue;
    const opened = await openKey(key, row.provider, row.ciphertext, row.iv);
    if (opened === null) {
      console.error('provider key did not open', { provider: row.provider });
      continue;
    }
    keys[row.provider] = opened;
  }
  return keys;
}

/**
 * `env` with each provider's panel key in place of its Worker secret
 * (D131). Unchanged where there is no database, no encryption key, or no
 * stored key; a stored key that does not open is skipped and logged, and a
 * database that cannot be read leaves the secrets in place, so a fault
 * here costs the panel's keys, never every build.
 *
 * Read once per isolate per `KEY_CACHE_MS`, not on every request, and once
 * for any number of requests that arrive while that read is in flight. A
 * key set or removed here is seen at once by this isolate and within that
 * window by the rest. A failed read is not kept, so the next request tries
 * again.
 */
export async function withPanelKeys<E extends ProviderKeysEnv>(
  env: E,
  now: number = Date.now(),
): Promise<E> {
  const db = env.DB;
  const secret = env.VIBLD_KEY_ENCRYPTION_KEY;
  if (!db || !secret) return env;
  let entry = cache;
  if (
    !entry ||
    entry.db !== db ||
    entry.secret !== secret ||
    now - entry.at >= KEY_CACHE_MS
  ) {
    const fresh: KeyCache = {
      db,
      secret,
      at: now,
      keys: Promise.resolve(null),
    };
    fresh.keys = readPanelKeys(db, secret).catch((error: unknown) => {
      console.error('provider keys could not be read', {
        error: error instanceof Error ? error.message : String(error),
      });
      if (cache === fresh) cache = null;
      return null;
    });
    cache = fresh;
    entry = fresh;
  }
  const keys = await entry.keys;
  if (!keys) return env;
  const overrides: Partial<ProviderKeysEnv> = {};
  for (const provider of KEY_PROVIDERS) {
    const value = keys[provider];
    if (value) overrides[KEY_ENV[provider]] = value;
  }
  return Object.keys(overrides).length === 0 ? env : { ...env, ...overrides };
}

// -------------------------------------------------------------------------
// The routes.
// -------------------------------------------------------------------------

export interface ProviderKeyView {
  provider: KeyProvider;
  name: string;
  /** Where the key in use comes from, or null where there is none. */
  source: 'panel' | 'secret' | null;
  /** The last four characters of the key in use. */
  last4: string | null;
  /** Whether the panel holds a key for this provider, usable or not. */
  stored: boolean;
  /**
   * A stored key that does not open under this deployment's encryption
   * key (it was replaced, or the row is damaged), so it is not in use.
   * It can still be removed.
   */
  unreadable: boolean;
  /** The last four characters of the stored key, usable or not. */
  storedLast4: string | null;
  /** Set where the panel holds a key. */
  updatedAt: string | null;
  updatedBy: string | null;
  /** Whether a Worker secret is there to fall back to. */
  secretSet: boolean;
}

export const KEY_ROUTES = [
  '/api/admin/keys',
  '/api/admin/keys/remove',
] as const;

export function isKeyRoute(pathname: string): boolean {
  return (KEY_ROUTES as readonly string[]).includes(pathname);
}

/** The last four characters, the only part of a key anything shows. */
export function lastFour(key: string): string {
  return key.slice(-4);
}

/**
 * A key as typed: trimmed, and refused when it is empty, too long to be a
 * key, or holds whitespace (a pasted line break or a second word).
 */
export function cleanKey(
  value: unknown,
): { ok: true; key: string } | { ok: false; error: string } {
  if (typeof value !== 'string') {
    return { ok: false, error: '"key" is required.' };
  }
  const key = value.trim();
  if (key.length < 8)
    return { ok: false, error: 'That is too short to be a key.' };
  if (key.length > 500)
    return { ok: false, error: 'That is too long to be a key.' };
  if (/\s/.test(key)) {
    return { ok: false, error: 'A key has no spaces or line breaks in it.' };
  }
  return { ok: true, key };
}

export interface ProviderKeyDeps {
  adminEmail: string;
  audit: (entry: AuditEntry) => Promise<boolean>;
  now?: () => Date;
}

async function views(
  env: ProviderKeysEnv,
  db: D1Database,
): Promise<ProviderKeyView[]> {
  const key = await encryptionKey(env.VIBLD_KEY_ENCRYPTION_KEY);
  const rows = new Map((await readRows(db)).map((row) => [row.provider, row]));
  const out: ProviderKeyView[] = [];
  for (const provider of KEY_PROVIDERS) {
    const row = rows.get(provider);
    const secret = env[KEY_ENV[provider]];
    // Whether the stored key is the one in use: only if it opens under
    // this deployment's encryption key, as `withPanelKeys` requires.
    const opens =
      row !== undefined &&
      key !== null &&
      (await openKey(key, provider, row.ciphertext, row.iv)) !== null;
    out.push({
      provider,
      name: PROVIDER_NAMES[provider],
      source: opens ? 'panel' : secret ? 'secret' : null,
      last4: opens ? row!.last4 : secret ? lastFour(secret) : null,
      stored: row !== undefined,
      unreadable: row !== undefined && !opens,
      storedLast4: row?.last4 ?? null,
      updatedAt: row?.updated_at ?? null,
      updatedBy: row?.updated_by ?? null,
      secretSet: Boolean(secret),
    });
  }
  return out;
}

/**
 * The three routes. `env` is the Worker's own, not `withPanelKeys`'s, so
 * "the secret" means the secret and not a panel key laid over it.
 */
export async function handleProviderKeys(
  request: Request,
  env: ProviderKeysEnv,
  deps: ProviderKeyDeps,
): Promise<Response> {
  const db = env.DB;
  if (!db) return json({ error: 'Keys are not configured here.' }, 503);
  const route = new URL(request.url).pathname;
  const key = await encryptionKey(env.VIBLD_KEY_ENCRYPTION_KEY);

  if (route === '/api/admin/keys' && request.method === 'GET') {
    return json({ keys: await views(env, db), canStore: key !== null });
  }
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return json({ error: 'Body must be a JSON object.' }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'Body must be a JSON object.' }, 400);
  }
  const provider = body.provider;
  if (!isProvider(provider)) {
    return json(
      { error: `"provider" must be one of ${KEY_PROVIDERS.join(', ')}.` },
      400,
    );
  }
  const at = (deps.now ?? (() => new Date()))().toISOString();

  if (route === '/api/admin/keys/remove') {
    const removed = await db
      .prepare(`DELETE FROM provider_keys WHERE provider = ?1 RETURNING last4`)
      .bind(provider)
      .first<{ last4: string }>();
    if (!removed) {
      return json({ error: 'The panel holds no key for that provider.' }, 409);
    }
    forgetPanelKeys();
    const audited = await deps.audit({
      at,
      adminEmail: deps.adminEmail,
      action: 'provider-key-remove',
      targetUserId: null,
      target: provider,
      reason: null,
      detail: { last4: removed.last4 },
    });
    return json({ ok: true, provider, audited, keys: await views(env, db) });
  }

  if (!key) {
    return json(
      {
        error:
          'This deployment has no VIBLD_KEY_ENCRYPTION_KEY, so keys cannot be stored here. Set it as a Worker secret (32 random bytes, base64).',
      },
      409,
    );
  }
  const cleaned = cleanKey(body.key);
  if (!cleaned.ok) return json({ error: cleaned.error }, 400);
  const sealed = await sealKey(key, provider, cleaned.key);
  const last4 = lastFour(cleaned.key);
  await db
    .prepare(
      `INSERT INTO provider_keys
         (provider, ciphertext, iv, last4, updated_at, updated_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(provider) DO UPDATE SET
         ciphertext = excluded.ciphertext, iv = excluded.iv,
         last4 = excluded.last4, updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
    )
    .bind(provider, sealed.ciphertext, sealed.iv, last4, at, deps.adminEmail)
    .run();
  forgetPanelKeys();
  const audited = await deps.audit({
    at,
    adminEmail: deps.adminEmail,
    action: 'provider-key-set',
    targetUserId: null,
    target: provider,
    reason: null,
    detail: { last4 },
  });
  return json({
    ok: true,
    provider,
    last4,
    audited,
    keys: await views(env, db),
  });
}
