import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { INSPECT_MESSAGE, readPick } from '@vibld/core';
import type { InspectMode, PreviewPick } from '@vibld/core';

/**
 * The builder's side of Select and Annotate (D188): talks to the inspector
 * script inside the preview frame (`INSPECTOR_SCRIPT` in @vibld/core).
 *
 * `ready` stays false until the page says the script is running, so a
 * preview that does not carry it (a sandbox started before this shipped, a
 * page that failed to load) never shows buttons that would do nothing.
 *
 * Messages are taken only from this frame's own window. What the page
 * sends is the project's code talking, so `readPick` checks every field.
 */
export interface PreviewInspector {
  ready: boolean;
  mode: InspectMode | null;
  setMode: (mode: InspectMode | null) => void;
}

/**
 * Where a message to the frame may go: the origin of its `src` for a
 * sandbox, and anywhere for a page with no origin of its own (`srcdoc`),
 * which is the only way to address one.
 */
export function frameTarget(frame: HTMLIFrameElement): string {
  const src = frame.getAttribute('src');
  if (!src) return '*';
  try {
    return new URL(src, window.location.href).origin;
  } catch {
    return '*';
  }
}

export function usePreviewInspector(
  frame: RefObject<HTMLIFrameElement | null>,
  /** Changes whenever a different page is loaded into the frame. */
  pageKey: string | null,
  onPick: ((pick: PreviewPick) => void) | undefined,
): PreviewInspector {
  const [ready, setReady] = useState(false);
  const [mode, setModeState] = useState<InspectMode | null>(null);
  // Read through a ref, so a new callback each render does not tear the
  // listener down and forget that the page is ready.
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const enabled = onPick !== undefined;

  const send = useCallback(
    (message: Record<string, unknown>) => {
      const target = frame.current;
      if (!target?.contentWindow) return;
      target.contentWindow.postMessage(
        { source: INSPECT_MESSAGE.toPage, ...message },
        frameTarget(target),
      );
    },
    [frame],
  );

  useEffect(() => {
    setReady(false);
    setModeState(null);
    if (!pageKey || !enabled) return;
    function onMessage(event: MessageEvent) {
      const target = frame.current;
      if (!target || event.source !== target.contentWindow) return;
      const data = event.data as {
        source?: unknown;
        kind?: unknown;
        mode?: unknown;
      } | null;
      if (data?.source !== INSPECT_MESSAGE.fromPage) return;
      if (data.kind === 'ready') {
        setReady(true);
        return;
      }
      if (data.kind === 'mode') {
        setModeState(
          data.mode === 'select' || data.mode === 'annotate' ? data.mode : null,
        );
        return;
      }
      const pick = readPick(data);
      if (pick) pickRef.current?.(pick);
    }
    window.addEventListener('message', onMessage);
    // The page may have announced itself before this was listening, and
    // reloads (a live update, an HMR full reload) announce again; asking
    // covers the first case.
    const target = frame.current;
    const hello = () => send({ kind: 'hello' });
    // A new page starts with neither mode on, whatever the old one had,
    // and is not ready until it says so: it may not carry the inspector.
    const loaded = () => {
      setReady(false);
      setModeState(null);
      hello();
    };
    target?.addEventListener('load', loaded);
    hello();
    return () => {
      window.removeEventListener('message', onMessage);
      target?.removeEventListener('load', loaded);
    };
  }, [frame, pageKey, enabled, send]);

  const setMode = useCallback(
    (next: InspectMode | null) => {
      setModeState(next);
      send({ kind: 'mode', mode: next });
    },
    [send],
  );

  return { ready, mode, setMode };
}
