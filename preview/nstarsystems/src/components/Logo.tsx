interface LogoProps {
  id: string
}

export default function Logo({ id }: LogoProps) {
  const gradientId = `nstar-gradient-${id}`
  const glowId = `nstar-glow-${id}`

  return (
    <svg
      className="brand__mark"
      viewBox="0 0 44 44"
      width="44"
      height="44"
      role="img"
      aria-label="NStar Systems"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f6a821" />
          <stop offset="58%" stopColor="#ffd489" />
          <stop offset="100%" stopColor="#19b8b0" />
        </linearGradient>
        <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#19b8b0" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#19b8b0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="1.5" y="1.5" width="41" height="41" rx="13" fill="#071c33" />
      <rect x="1.5" y="1.5" width="41" height="41" rx="13" fill={`url(#${glowId})`} />
      <path
        d="M22 6.5l3.3 10.6a2 2 0 001.4 1.4L37.4 22l-10.7 3.5a2 2 0 00-1.4 1.4L22 37.5l-3.3-10.6a2 2 0 00-1.4-1.4L6.6 22l10.7-3.5a2 2 0 001.4-1.4z"
        fill={`url(#${gradientId})`}
      />
    </svg>
  )
}
