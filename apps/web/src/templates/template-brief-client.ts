import { getClerkToken } from '../auth/clerk-token.ts';

/**
 * The builder's half of `/api/templates/brief` (D148): one design
 * template's brief, fetched when somebody adds it to the message.
 *
 * JSX-free so `*.test.ts` files can import it.
 */

export type TemplateBriefResult =
  { ok: true; brief: string } | { ok: false; message: string };

const FAILED = 'That template could not be loaded. Try again shortly.';

export async function loadTemplateBrief(
  id: string,
  deps: {
    fetchImpl?: typeof fetch;
    getToken?: () => Promise<string | null>;
  } = {},
): Promise<TemplateBriefResult> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let response: Response;
  try {
    // Inside the guard: a failed session token is a failed load.
    const token = await (deps.getToken ?? getClerkToken)();
    response = await fetchImpl(
      `/api/templates/brief?id=${encodeURIComponent(id)}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
  } catch {
    return { ok: false, message: FAILED };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const record =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {};
  if (!response.ok) {
    return {
      ok: false,
      message:
        typeof record.error === 'string' && record.error
          ? record.error
          : FAILED,
    };
  }
  if (typeof record.brief !== 'string' || record.brief.trim() === '') {
    return { ok: false, message: FAILED };
  }
  return { ok: true, brief: record.brief };
}
