import { CHEVRON, REGISTER_OFFSET, STROKE, WORDMARK } from '@vibld/brand/mark';

/**
 * The vibld mark, drawn from the shared geometry.
 *
 * This shell used to show a tilde in a purple-to-blue gradient tile while
 * vibld.com showed an orange chevron, so the two halves of one product had
 * two logos. Both now come from @vibld/brand, which is the only way that
 * stays true.
 *
 * Colours come from CSS custom properties rather than from the palette
 * module, because they follow `prefers-color-scheme` at runtime and a value
 * baked in at render time cannot.
 */
export function Mark({ size = 22, title }: { size?: number; title?: string }) {
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
        The overprint. A renderer without `mix-blend-mode` still draws both
        impressions in the right places and only loses the colour where they
        cross, which is why the offset lives in the geometry.
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

export { WORDMARK };
