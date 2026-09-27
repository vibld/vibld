import { cn } from '@/lib/utils';

// Placeholder plates drawn in SVG. Each fills its frame and crops like a
// photograph (xMidYMid slice), so any aspect ratio works.
export interface ArtProps {
  className?: string;
}

const frame = 'block size-full';

export function NightFerry({ className }: ArtProps) {
  const stars: Array<[number, number, number]> = [
    [120, 90, 3],
    [260, 180, 2],
    [410, 70, 3],
    [560, 150, 2],
    [720, 60, 3],
    [860, 190, 2],
    [980, 110, 3],
    [1400, 90, 2],
    [1500, 210, 3],
    [1330, 360, 2],
    [200, 330, 2],
    [690, 310, 2],
  ];
  const windows = [612, 662, 712, 762, 812, 862];
  return (
    <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className={cn(frame, className)}>
      <rect width="1600" height="900" className="fill-art-night" />
      {stars.map(([x, y, r]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={r} opacity={0.7} className="fill-art-moon" />
      ))}
      <circle cx="1170" cy="230" r="92" className="fill-art-moon" />
      <path d="M0 560 C220 470 420 520 640 540 C900 565 1120 470 1600 520 L1600 620 L0 620 Z" className="fill-art-teal" />
      <rect y="600" width="1600" height="300" className="fill-art-deep" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect
          key={i}
          x={1080 + i * 14}
          y={630 + i * 44}
          width={180 - i * 28}
          height="8"
          rx="4"
          opacity={0.5}
          className="fill-art-moon"
        />
      ))}
      <path
        d="M1020 704 C1150 708 1300 732 1480 722"
        strokeWidth="4"
        strokeLinecap="round"
        opacity={0.5}
        className="fill-none stroke-art-sky"
      />
      <rect x="860" y="520" width="34" height="64" className="fill-art-ochre" />
      <path d="M500 640 L1020 640 L975 712 L548 712 Z" className="fill-art-cream" />
      <rect x="580" y="584" width="330" height="56" className="fill-art-rust" />
      <rect x="640" y="548" width="200" height="36" className="fill-art-cream" />
      {windows.map((x) => (
        <rect key={x} x={x} y="600" width="28" height="18" className="fill-art-moon" />
      ))}
    </svg>
  );
}

export function Orchard({ className }: ArtProps) {
  const trees: Array<[number, number, number]> = [
    [120, 520, 60],
    [300, 500, 70],
    [500, 515, 62],
    [690, 495, 68],
    [200, 700, 82],
    [440, 712, 92],
    [660, 690, 78],
  ];
  return (
    <svg viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className={cn(frame, className)}>
      <rect width="800" height="1000" className="fill-art-cream" />
      <circle cx="590" cy="220" r="120" className="fill-art-rose" />
      <path d="M0 480 C200 440 520 470 800 430 L800 1000 L0 1000 Z" className="fill-art-ochre" />
      <path d="M0 720 C260 680 540 740 800 700 L800 1000 L0 1000 Z" opacity={0.35} className="fill-art-rust" />
      {trees.map(([x, y, r]) => (
        <g key={`${x}-${y}`}>
          <rect x={x - 8} y={y} width="16" height={r * 1.6} className="fill-art-rust" />
          <circle cx={x} cy={y} r={r} className="fill-art-leaf" />
          <circle cx={x - r * 0.4} cy={y - r * 0.1} r="8" className="fill-art-ochre" />
          <circle cx={x + r * 0.35} cy={y + r * 0.3} r="8" className="fill-art-ochre" />
        </g>
      ))}
    </svg>
  );
}

export function TheLodger({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className={cn(frame, className)}>
      <rect width="800" height="1000" className="fill-art-sky" />
      <rect x="110" y="90" width="580" height="700" className="fill-art-cream" />
      <rect x="150" y="130" width="500" height="620" className="fill-art-night" />
      <circle cx="540" cy="250" r="44" className="fill-art-moon" />
      <rect x="392" y="130" width="16" height="620" className="fill-art-cream" />
      <rect x="150" y="420" width="500" height="16" className="fill-art-cream" />
      <rect x="70" y="760" width="660" height="50" className="fill-art-rust" />
      <path
        d="M190 720 C120 740 110 800 180 830"
        strokeWidth="26"
        strokeLinecap="round"
        className="fill-none stroke-art-ochre"
      />
      <ellipse cx="330" cy="690" rx="150" ry="80" className="fill-art-ochre" />
      <path d="M408 575 L420 520 L450 562 Z" className="fill-art-ochre" />
      <path d="M462 556 L500 515 L505 572 Z" className="fill-art-ochre" />
      <circle cx="455" cy="610" r="62" className="fill-art-ochre" />
      <path
        d="M280 630 L300 700 M330 620 L345 700 M380 628 L390 690"
        strokeWidth="10"
        strokeLinecap="round"
        className="fill-none stroke-art-rust"
      />
      <path
        d="M430 610 q10 8 20 0 M470 606 q10 8 20 0"
        strokeWidth="5"
        strokeLinecap="round"
        className="fill-none stroke-art-night"
      />
      <ellipse cx="590" cy="660" rx="18" ry="44" transform="rotate(-20 590 660)" className="fill-art-leaf" />
      <ellipse cx="628" cy="655" rx="18" ry="48" transform="rotate(18 628 655)" className="fill-art-sage" />
      <path d="M570 700 L650 700 L638 760 L582 760 Z" className="fill-art-teal" />
    </svg>
  );
}

export function Tidepool({ className }: ArtProps) {
  const pebbles: Array<[number, number, number]> = [
    [120, 930, 14],
    [200, 960, 9],
    [560, 920, 12],
    [640, 955, 16],
    [720, 915, 8],
  ];
  return (
    <svg viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className={cn(frame, className)}>
      <rect width="800" height="1000" className="fill-art-cream" />
      <path d="M0 0 H800 V190 C640 250 520 180 380 230 C240 280 120 210 0 260 Z" className="fill-art-sage" />
      <ellipse cx="400" cy="570" rx="340" ry="270" className="fill-art-teal" />
      <ellipse cx="400" cy="570" rx="210" ry="150" strokeWidth="4" opacity={0.6} className="fill-none stroke-art-sky" />
      <ellipse cx="400" cy="570" rx="120" ry="84" strokeWidth="4" opacity={0.6} className="fill-none stroke-art-sky" />
      <polygon
        points="300,540 314.1,580.6 357.1,581.5 322.8,607.4 335.3,648.5 300,624 264.7,648.5 277.2,607.4 242.9,581.5 285.9,580.6"
        className="fill-art-rust"
      />
      <circle cx="520" cy="470" r="34" className="fill-art-rose" />
      <circle cx="562" cy="512" r="20" className="fill-art-rose" />
      <circle cx="480" cy="672" r="26" className="fill-art-ochre" />
      <path d="M0 1000 V840 C160 800 300 880 460 850 C600 820 700 870 800 840 V1000 Z" className="fill-art-sage" />
      {pebbles.map(([x, y, r]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={r} className="fill-art-cream" />
      ))}
    </svg>
  );
}

export function GreenhouseAtDusk({ className }: ArtProps) {
  const plants: Array<[number, number, number]> = [
    [210, 770, 52],
    [330, 780, 40],
    [470, 768, 56],
    [595, 778, 44],
  ];
  return (
    <svg viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className={cn(frame, className)}>
      <rect width="800" height="1000" className="fill-art-deep" />
      <circle cx="640" cy="170" r="42" opacity={0.85} className="fill-art-rose" />
      <rect y="800" width="800" height="200" className="fill-art-night" />
      <path d="M140 800 V470 L400 300 L660 470 V800 Z" opacity={0.3} className="fill-art-sky" />
      <circle cx="400" cy="540" r="120" opacity={0.25} className="fill-art-moon" />
      {plants.map(([x, y, r]) => (
        <g key={x}>
          <ellipse cx={x} cy={y} rx={r} ry={r * 1.3} className="fill-art-leaf" />
          <circle cx={x + r * 0.3} cy={y - r * 0.4} r="9" className="fill-art-sage" />
          <circle cx={x - r * 0.35} cy={y + r * 0.1} r="8" className="fill-art-sage" />
        </g>
      ))}
      <rect x="398" y="300" width="4" height="220" className="fill-art-cream" />
      <circle cx="400" cy="540" r="22" className="fill-art-moon" />
      <path
        d="M140 800 V470 L400 300 L660 470 V800 M400 300 V800 M140 470 H660 M270 385 V800 M530 385 V800"
        strokeWidth="6"
        strokeLinejoin="round"
        className="fill-none stroke-art-cream"
      />
    </svg>
  );
}

export function SaturdayMarket({ className }: ArtProps) {
  const stripes = [0, 1, 2, 3, 4, 5, 6, 7];
  const produce: Array<[number, number, number, 'rose' | 'teal']> = [
    [170, 600, 34, 'teal'],
    [236, 596, 30, 'rose'],
    [300, 604, 32, 'teal'],
    [520, 600, 30, 'rose'],
    [584, 596, 34, 'teal'],
    [648, 604, 28, 'rose'],
  ];
  return (
    <svg viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className={cn(frame, className)}>
      <rect width="800" height="1000" className="fill-art-cream" />
      {stripes.map((i) => (
        <rect
          key={i}
          x={80 + i * 80}
          y="180"
          width="80"
          height="150"
          className={i % 2 === 0 ? 'fill-art-rose' : 'fill-art-cream'}
        />
      ))}
      <rect x="80" y="180" width="640" height="150" strokeWidth="6" className="fill-none stroke-art-teal" />
      {stripes.map((i) => (
        <circle key={`scallop-${i}`} cx={120 + i * 80} cy="330" r="40" className="fill-art-rose mix-blend-multiply" />
      ))}
      <rect x="92" y="330" width="14" height="520" className="fill-art-teal" />
      <rect x="694" y="330" width="14" height="520" className="fill-art-teal" />
      <circle cx="400" cy="460" r="44" className="fill-art-teal mix-blend-multiply" />
      <path d="M320 650 C320 550 356 512 400 512 C444 512 480 550 480 650 Z" className="fill-art-rose mix-blend-multiply" />
      {produce.map(([x, y, r, ink]) => (
        <circle
          key={`${x}-${y}`}
          cx={x}
          cy={y}
          r={r}
          className={cn('mix-blend-multiply', ink === 'rose' ? 'fill-art-rose' : 'fill-art-teal')}
        />
      ))}
      <rect x="60" y="630" width="680" height="40" className="fill-art-teal" />
      <rect x="80" y="670" width="640" height="180" opacity={0.6} className="fill-art-rose mix-blend-multiply" />
      <rect x="0" y="850" width="800" height="150" opacity={0.25} className="fill-art-teal" />
    </svg>
  );
}

export function Heron({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className={cn(frame, className)}>
      <rect width="800" height="1000" className="fill-art-cream" />
      <rect y="700" width="800" height="300" opacity={0.5} className="fill-art-sky" />
      <path
        d="M60 760 H300 M420 800 H720 M120 860 H460 M520 920 H760"
        strokeWidth="3"
        strokeLinecap="round"
        opacity={0.5}
        className="fill-none stroke-art-night"
      />
      <path
        d="M70 1000 L96 560 M110 1000 L150 610 M150 1000 L130 640 M680 1000 L700 590 M720 1000 L760 640"
        strokeWidth="6"
        strokeLinecap="round"
        className="fill-none stroke-art-leaf"
      />
      <path d="M450 585 L445 720 M482 580 L492 720" strokeWidth="5" strokeLinecap="round" className="fill-none stroke-art-night" />
      <path d="M360 500 C330 440 360 380 330 320" strokeWidth="22" strokeLinecap="round" className="fill-none stroke-art-deep" />
      <path d="M540 480 L620 520 L548 520 Z" className="fill-art-deep" />
      <path d="M330 520 C360 440 480 430 540 470 C580 500 560 560 500 580 C440 600 360 590 330 520 Z" className="fill-art-deep" />
      <path d="M380 510 C430 480 500 480 540 500" strokeWidth="5" strokeLinecap="round" className="fill-none stroke-art-night" />
      <ellipse cx="330" cy="305" rx="26" ry="20" className="fill-art-deep" />
      <path d="M310 298 L226 312 L312 318 Z" className="fill-art-ochre" />
      <path d="M345 294 C370 284 390 290 406 282" strokeWidth="4" strokeLinecap="round" className="fill-none stroke-art-night" />
      <circle cx="322" cy="300" r="3.5" className="fill-art-cream" />
    </svg>
  );
}

export function Allotment({ className }: ArtProps) {
  const sprouts = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const sunflowers: Array<[number, number]> = [
    [760, 470],
    [830, 440],
    [900, 490],
  ];
  return (
    <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className={cn(frame, className)}>
      <rect width="1600" height="900" className="fill-art-sky" />
      <circle cx="1320" cy="180" r="80" className="fill-art-moon" />
      <path d="M0 420 C300 330 600 400 900 360 C1200 320 1400 380 1600 340 V900 H0 Z" className="fill-art-sage" />
      <path d="M0 560 C400 520 1000 580 1600 540 V900 H0 Z" className="fill-art-leaf" />
      {[620, 720, 820].map((y) => (
        <g key={y}>
          <rect x="120" y={y} width="560" height="56" rx="6" className="fill-art-rust" />
          {sprouts.map((i) => (
            <circle key={i} cx={150 + i * 56} cy={y + 28} r="14" className="fill-art-sage" />
          ))}
        </g>
      ))}
      {sunflowers.map(([x, y]) => (
        <g key={x}>
          <path d={`M${x} ${y} V${y + 200}`} strokeWidth="6" className="fill-none stroke-art-teal" />
          <circle cx={x} cy={y} r="28" className="fill-art-ochre" />
          <circle cx={x} cy={y} r="10" className="fill-art-rust" />
        </g>
      ))}
      <rect x="1000" y="470" width="280" height="200" className="fill-art-teal" />
      <path d="M980 480 L1140 400 L1300 480 Z" className="fill-art-rust" />
      <rect x="1110" y="540" width="60" height="130" opacity={0.6} className="fill-art-night" />
      <rect x="1030" y="510" width="50" height="40" className="fill-art-cream" />
      <rect x="1300" y="580" width="64" height="90" rx="8" className="fill-art-deep" />
    </svg>
  );
}
