import { CHEVRON, REGISTER_OFFSET, STROKE, WORDMARK } from '@vibld/brand/mark';

/**
 * The vibld mark, as React.
 *
 * The geometry comes from @vibld/brand so this site and the builder cannot
 * draw different logos, which is what they did before: vibld.com had an
 * orange chevron and app.vibld.com a purple tilde. The colours come from CSS
 * custom properties rather than from the palette module, because they have to
 * follow `prefers-color-scheme` at runtime and a value baked in at render
 * time cannot.
 */
export function Mark({ size = 24, title }: { size?: number; title?: string }) {
  const offset = `M${6 + REGISTER_OFFSET} ${9 + REGISTER_OFFSET}l9 15 9-15`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
    >
      {title ? <title>{title}</title> : null}
      {/*
        multiply is what makes two flat inks overprint into a third colour
        where they cross. A renderer without it still draws both strokes in
        the right places and only loses the overlap, which is why the offset
        is in the geometry rather than in the blend.
      */}
      <g style={{ mixBlendMode: 'multiply' }}>
        <path
          d={CHEVRON}
          stroke="var(--vibld-mark-offset)"
          strokeWidth={STROKE}
          fill="none"
          strokeLinejoin="miter"
        />
        <path
          d={offset}
          stroke="var(--vibld-mark-ink)"
          strokeWidth={STROKE}
          fill="none"
          strokeLinejoin="miter"
        />
      </g>
    </svg>
  );
}

/** The mark and the wordmark, which is lowercase everywhere without exception. */
export function Lockup({ size = 24 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <Mark size={size} />
      <span className="text-lg font-semibold tracking-tight text-[var(--color-accent-ink)]">
        {WORDMARK}
      </span>
    </span>
  );
}
