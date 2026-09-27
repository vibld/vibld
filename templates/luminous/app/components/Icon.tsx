/**
 * A small hand-drawn icon set, inline rather than from a package, so the
 * template adds no dependency for two dozen strokes.
 *
 * Every icon is decorative: it sits beside words that already say the same
 * thing, so it is hidden from assistive technology.
 */

const PATHS = {
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  chat: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z" />,
  widget: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M3 9h18" />
      <circle cx="16.5" cy="15.5" r="2" />
    </>
  ),
  desk: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <path d="M5.6 5.6l3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6" />
    </>
  ),
  star: (
    <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
  ),
  gauge: (
    <>
      <path d="M4 17a8 8 0 1 1 16 0" />
      <path d="M12 17l4-5" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
    </>
  ),
  kanban: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M8 7v7M12 7v4M16 7v9" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" />
      <path d="M10 21h4" />
    </>
  ),
  code: <path d="M8 6l-6 6 6 6M16 6l6 6-6 6" />,
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M3 15h18M9 4v16" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  sparkle: (
    <>
      <path d="M12 3l1.8 4.9L19 9.7l-5.2 1.8L12 16.4l-1.8-4.9L5 9.7l5.2-1.8z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  reply: (
    <>
      <path d="M9 14l-5-5 5-5" />
      <path d="M4 9h10a6 6 0 0 1 6 6v5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M4 17v3h16v-3" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  check: <path d="M5 12l5 5 9-10" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  plug: (
    <>
      <path d="M9 3v5M15 3v5" />
      <path d="M6 8h12v3a6 6 0 0 1-12 0z" />
      <path d="M12 17v4" />
    </>
  ),
  inbox: (
    <>
      <path d="M3 13l3-8h12l3 8v6H3z" />
      <path d="M3 13h5l1 3h6l1-3h5" />
    </>
  ),
  rank: <path d="M4 18h4v-6H4zM10 18h4V6h-4zM16 18h4v-9h-4z" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** The three wave lines that drift behind the hero and the page heads. */
export function Waves() {
  return (
    <div className="waves" aria-hidden="true">
      <svg className="w1" viewBox="0 0 2880 260" preserveAspectRatio="none">
        <path d="M0 130 C120 66 240 66 360 130 C480 194 600 194 720 130 C840 66 960 66 1080 130 C1200 194 1320 194 1440 130 C1560 66 1680 66 1800 130 C1920 194 2040 194 2160 130 C2280 66 2400 66 2520 130 C2640 194 2760 194 2880 130" />
      </svg>
      <svg className="w2" viewBox="0 0 2880 260" preserveAspectRatio="none">
        <path d="M0 150 C240 57 480 57 720 150 C960 243 1200 243 1440 150 C1680 57 1920 57 2160 150 C2400 243 2640 243 2880 150" />
      </svg>
      <svg className="w3" viewBox="0 0 2880 260" preserveAspectRatio="none">
        <path d="M0 105 C80 76 160 76 240 105 C320 134 400 134 480 105 C560 76 640 76 720 105 C800 134 880 134 960 105 C1040 76 1120 76 1200 105 C1280 134 1360 134 1440 105 C1520 76 1600 76 1680 105 C1760 134 1840 134 1920 105 C2000 76 2080 76 2160 105 C2240 134 2320 134 2400 105 C2480 76 2560 76 2640 105 C2720 134 2800 134 2880 105" />
      </svg>
    </div>
  );
}
