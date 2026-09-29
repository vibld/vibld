import type { PanelPhase } from './panel-view.ts';

/**
 * Where a trip to GitHub stands, shared by every surface that can start one
 * (D72).
 *
 * The settings panel used to be the only place a repository was chosen, so
 * its phase lived in its own state. The Ship menu offers the same choice
 * ("Create a new repository" or "Use an existing repository") on a
 * project's first push, and the answer comes back to whichever page load
 * GitHub returns to, where only the settings panel is certain to be mounted
 * to receive it. So the phase is here: the panel receives the handoff and
 * writes it, and the Ship menu reads the same thing and opens with it when
 * it was the one that asked.
 *
 * `projectId` is the project the trip was for, which is not always the one
 * open when the answer arrives: a picker belongs to the project that asked
 * for it. `from` is which surface asked.
 *
 * JSX-free, and a plain object rather than a hook, for the reason
 * `github-status.ts` is.
 */
export interface ConnectFlowState {
  phase: PanelPhase;
  projectId: string | null;
  from?: 'ship' | 'settings';
}

export interface ConnectFlow {
  read(): ConnectFlowState;
  subscribe(listener: () => void): () => void;
  set(next: ConnectFlowState): void;
}

export function createConnectFlow(): ConnectFlow {
  let value: ConnectFlowState = { phase: { at: 'loading' }, projectId: null };
  const listeners = new Set<() => void>();
  return {
    read: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      value = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

/** The one every surface reads. */
export const connectFlow = createConnectFlow();

/**
 * Whether the Ship menu should open with this state.
 *
 * Only for a trip it started, and only while there is something to see:
 * work in progress, a choice, or a failure. The settings panel shows the
 * same state in its own place, and a menu that opened over it for a trip
 * started from settings would be answering a question nobody asked there.
 */
export function shipShouldOpen(state: ConnectFlowState): boolean {
  if (state.from !== 'ship') return false;
  const at = state.phase.at;
  return at === 'working' || at === 'choosing' || at === 'problem';
}
