import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from './Icons.tsx';
import {
  applyThemeChoice,
  nextChoice,
  readThemeChoice,
  showingDark,
  writeThemeChoice,
} from '../theme/theme-choice.ts';
import type { ThemeChoice } from '../theme/theme-choice.ts';

/**
 * Day and night, as one control.
 *
 * Every rule about what the control does lives in `theme-choice.ts` and has
 * tests; this is the wiring. The icon shows where pressing it goes rather
 * than where you are, which is the convention people already read: a moon
 * means "take me to dark".
 *
 * The system preference is watched, not read once. Somebody on "system" who
 * changes their OS theme while this is open should see the builder follow,
 * and without the listener it would sit on whatever was true at mount.
 */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>('system');
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const query = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    setSystemDark(query?.matches ?? false);
    const stored = readThemeChoice();
    setChoice(stored);
    applyThemeChoice(stored, globalThis.document?.documentElement ?? null);

    if (!query?.addEventListener) return;
    const follow = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, []);

  const dark = showingDark(choice, systemDark);

  function press() {
    const next = nextChoice(choice, systemDark);
    setChoice(next);
    writeThemeChoice(next);
    applyThemeChoice(next, globalThis.document?.documentElement ?? null);
  }

  return (
    <button
      type="button"
      className="iconbutton"
      onClick={press}
      // The name says what it does, because the icon alone cannot be read
      // aloud. `aria-pressed` is deliberately absent: this is not a thing
      // that is on or off, it is a switch between two states.
      aria-label={
        dark ? 'Switch to the light theme' : 'Switch to the dark theme'
      }
      title={dark ? 'Light theme' : 'Dark theme'}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
