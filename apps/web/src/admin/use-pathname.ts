import { useEffect, useState } from 'react';

/**
 * The current path, and a way to change it without reloading.
 *
 * Deliberately not a router. There are two views, and a router would be
 * more code than the thing it routes. What this does buy over a plain
 * `<a href>` is the reason it exists at all: a full page load throws away
 * the builder session, so an admin who stepped into settings during a
 * fifteen-minute run would come back to an empty shell and a run they can
 * no longer see. The session lives in `App`, above both views, and survives
 * a change of path only if the document does not.
 *
 * The path, not the fragment. `GitHubPanel` claims the URL fragment for the
 * OAuth callback's code, and hash routing here would fight it for the same
 * few characters. `wrangler.jsonc` serves the SPA on any unmatched path
 * (`not_found_handling: single-page-application`), so a direct load of
 * `/admin` reaches the shell with no Worker change.
 */
export function usePathname(): string {
  const [pathname, setPathname] = useState(() =>
    typeof window === 'undefined' ? '/' : window.location.pathname,
  );

  useEffect(() => {
    // Back and forward. `pushState` does not fire this, which is why
    // `navigate` sets the state itself rather than waiting to be told.
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    // The URL can have moved between the first render and this effect.
    onPop();
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return pathname;
}

/** Go somewhere in the same document. Safe to call before the DOM exists. */
export function navigate(to: string): void {
  if (typeof window === 'undefined') return;
  window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
