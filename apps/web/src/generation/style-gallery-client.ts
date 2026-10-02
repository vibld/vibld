import type { StyleCard } from '@vibld/ai/style-gallery';
import { getClerkToken } from '../auth/clerk-token.ts';

/**
 * The builder's half of `/api/style-gallery` (D142, D144): every style's
 * picker card, fetched once, when the gallery is first opened. About
 * 1.4 MB, which nobody should pay for until they look.
 *
 * JSX-free so `*.test.ts` files can import it.
 */

export type StyleCardsResult =
  { ok: true; cards: StyleCard[] } | { ok: false; message: string };

const FAILED = 'The style gallery could not be loaded. Try again shortly.';

function isCard(value: unknown): value is StyleCard {
  if (typeof value !== 'object' || value === null) return false;
  const card = value as Record<string, unknown>;
  return (
    typeof card.id === 'string' &&
    typeof card.name === 'string' &&
    Array.isArray(card.palette) &&
    typeof card.fonts === 'object' &&
    card.fonts !== null
  );
}

export async function loadStyleCards(
  deps: {
    fetchImpl?: typeof fetch;
    getToken?: () => Promise<string | null>;
  } = {},
): Promise<StyleCardsResult> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let response: Response;
  try {
    // Inside the guard: a session refresh that fails is a failed load, which
    // the picker offers to retry, not a rejection it never hears about.
    const token = await (deps.getToken ?? getClerkToken)();
    response = await fetchImpl('/api/style-gallery', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    return { ok: false, message: FAILED };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error =
      typeof body === 'object' && body !== null && 'error' in body
        ? (body as { error: unknown }).error
        : null;
    return {
      ok: false,
      message: typeof error === 'string' && error ? error : FAILED,
    };
  }
  // Anything but a list of cards is not this Worker answering: the static
  // dev server serves the shell's HTML for a path it does not know.
  if (!Array.isArray(body)) return { ok: false, message: FAILED };
  return { ok: true, cards: body.filter(isCard) };
}
