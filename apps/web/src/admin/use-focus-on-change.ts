import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Move focus to a container when the view behind it changes (#188 review).
 *
 * A document load repositions focus by itself; a view switch inside one
 * document does not. Both links in this shell intercept the click, so the
 * element that was focused is then hidden with the settings popover or
 * unmounted with the page it sat on, and focus falls back to `document.body`
 * -- no context, nothing announced, and the next Tab starts again from the
 * top of the document rather than from the view that just appeared. Back and
 * Forward land in exactly the same place.
 *
 * Not on the first render. Focus already belongs to whatever the reader was
 * doing when the page loaded, and stealing it to a container would be a
 * regression for everybody, not a fix for anybody.
 *
 * The container needs `tabIndex={-1}` to accept this: focusable on purpose,
 * never in the tab order.
 */
export function useFocusOnChange(
  value: string,
  target: RefObject<HTMLElement | null>,
): void {
  const previous = useRef(value);

  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    target.current?.focus();
  }, [value, target]);
}
