import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { GearIcon } from './Icons.tsx';

/**
 * Everything the header used to spread across its whole width.
 *
 * The bar carried the brand, a description of the deployment, a billing
 * readout with three buttons, the entire GitHub connection panel and the
 * account button, all at once, all competing. None of it is what somebody
 * looks at while building: it is configuration, read once and then
 * occasionally. So it lives behind one control, and the bar keeps the brand,
 * the money, the theme and the account.
 *
 * A popover rather than a page, because these are settings people change and
 * come straight back from. The GitHub panel in particular has to keep
 * mounting on every page load: the OAuth callback puts its code in the URL
 * fragment and redirects here, so whatever handles that cannot live behind a
 * tab somebody might not open. It stays mounted while the menu is closed,
 * hidden rather than unmounted, which is the difference between "not on
 * screen" and "never ran".
 *
 * Takes its sections as children rather than naming them, so the popover is
 * a popover and knows nothing about GitHub or billing. It is also what makes
 * the open-and-close rules testable: the real sections are Clerk-gated, and
 * a test that had to stand up a provider to press a button would be testing
 * Clerk.
 */
export function SettingsMenu({
  children,
}: {
  /**
   * Given a way to close the popover, because some of what lives in here
   * takes the reader somewhere else. A link to the admin page (#184) left
   * the menu standing open over the page it had just opened: the
   * document-level handler below deliberately ignores a mousedown that
   * happened inside the panel, and an internal navigation changes no state
   * this component watches, so nothing closed it (#188 review).
   *
   * A function rather than a context or an imperative handle: there is one
   * caller, and the closing is part of what that one control does.
   */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const container = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    // Escape closes, which is the one thing every popover owes a keyboard
    // user, and a click anywhere else closes too. Both listeners go on the
    // document rather than the panel: the whole point is what happens
    // outside it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && container.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div className="settings" ref={container}>
      <button
        type="button"
        className="iconbutton"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Settings"
        title="Settings"
        onClick={() => setOpen((was) => !was)}
      >
        <GearIcon />
      </button>

      {/*
        Hidden, not unmounted. `GitHubPanel` claims the OAuth fragment on
        mount, so a panel that only existed while the menu was open would
        drop a callback for anybody who was not looking at it, and the
        connection would fail for no visible reason.
      */}
      <div
        className="settings__panel"
        id={panelId}
        hidden={!open}
        role="group"
        aria-label="Settings"
      >
        {children(() => setOpen(false))}
      </div>
    </div>
  );
}
