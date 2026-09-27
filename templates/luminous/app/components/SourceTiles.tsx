import { useEffect, useRef } from 'react';

interface Tile {
  title: string;
  kind: 'Source' | 'Destination' | 'Both';
  body: string;
  preview: string;
  art: React.ReactNode;
}

const STAR =
  'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z';

/**
 * Twelve integrations, each with a small moving picture.
 *
 * They are categories rather than named products on purpose: the template
 * should not claim a partnership with anyone, and a site built from it can
 * swap in the vendors it really supports. The pictures are decoration and
 * are hidden from assistive technology; the heading and sentence under each
 * one carry everything it says.
 */
const TILES: Tile[] = [
  {
    title: 'Email',
    kind: 'Source',
    body: 'Forward any support or sales address. Threads stay threads.',
    preview: 'pv-mail',
    art: (
      <svg viewBox="0 0 260 160">
        <rect x="80" y="62" width="100" height="70" rx="8" fill="#e2572a" />
        <g className="a-drop">
          <rect x="96" y="30" width="68" height="50" rx="4" fill="#fff" />
          <path
            d="M106 44h48M106 54h36M106 64h42"
            stroke="#f5a524"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>
        <path
          d="M80 80 L130 110 L180 80 V124 a8 8 0 0 1 -8 8 H88 a8 8 0 0 1 -8 -8 Z"
          fill="#c9481f"
        />
        <path
          d="M80 80 L130 110 L180 80"
          fill="none"
          stroke="#ffe6b0"
          strokeWidth="2.5"
        />
      </svg>
    ),
  },
  {
    title: 'Live chat',
    kind: 'Source',
    body: 'Conversations are read when they close, not while someone is still typing.',
    preview: 'pv-chat',
    art: (
      <svg viewBox="0 0 260 160">
        <g className="a-pop">
          <rect x="36" y="24" width="124" height="32" rx="16" fill="#1f4a48" />
          <rect x="52" y="37" width="84" height="6" rx="3" fill="#9fe8df" />
        </g>
        <g className="a-pop" style={{ animationDelay: '0.8s' }}>
          <rect x="100" y="66" width="124" height="32" rx="16" fill="#3ccfc0" />
          <rect x="116" y="79" width="70" height="6" rx="3" fill="#0e2a2a" />
        </g>
        <g className="a-pop" style={{ animationDelay: '1.6s' }}>
          <rect x="36" y="108" width="72" height="32" rx="16" fill="#1f4a48" />
          <circle cx="56" cy="124" r="4" fill="#9fe8df" />
          <circle cx="72" cy="124" r="4" fill="#9fe8df" opacity=".7" />
          <circle cx="88" cy="124" r="4" fill="#9fe8df" opacity=".4" />
        </g>
      </svg>
    ),
  },
  {
    title: 'In-app widget',
    kind: 'Source',
    body: 'A snippet you style to match your app. It asks one question and gets out of the way.',
    preview: 'pv-widget',
    art: (
      <svg viewBox="0 0 260 160">
        <rect x="50" y="16" width="160" height="128" rx="12" fill="#fff" />
        <rect x="50" y="16" width="160" height="24" rx="12" fill="#e6e8ec" />
        <rect x="50" y="30" width="160" height="10" fill="#e6e8ec" />
        <rect x="64" y="54" width="92" height="8" rx="4" fill="#d5dbe5" />
        <rect x="64" y="68" width="120" height="6" rx="3" fill="#e6e8ec" />
        <rect x="64" y="80" width="70" height="6" rx="3" fill="#e6e8ec" />
        <g className="a-card">
          <rect x="104" y="70" width="90" height="44" rx="10" fill="#0f1522" />
          <rect x="114" y="82" width="60" height="6" rx="3" fill="#fbfaf7" />
          <rect x="114" y="94" width="40" height="6" rx="3" fill="#ee6b72" />
        </g>
        <circle
          className="a-pulse"
          cx="190"
          cy="126"
          r="11"
          fill="none"
          stroke="#ee6b72"
          strokeWidth="2"
        />
        <circle cx="190" cy="126" r="11" fill="#ee6b72" />
      </svg>
    ),
  },
  {
    title: 'Support desk',
    kind: 'Source',
    body: 'Tickets arrive with their tags, so nothing your agents already learned is lost.',
    preview: 'pv-desk',
    art: (
      <div className="desk-scene">
        <div className="desk-stack a-turn">
          <span className="desk-card" />
          <span className="desk-card" />
          <span className="desk-card">TICKET</span>
        </div>
      </div>
    ),
  },
  {
    title: 'App reviews',
    kind: 'Source',
    body: 'Public reviews of your mobile app, collected daily and read like any other message.',
    preview: 'pv-reviews',
    art: (
      <svg viewBox="0 0 260 160">
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i} transform={`translate(${52 + i * 32} 42) scale(1.3)`}>
            <path
              className="a-star"
              d={STAR}
              fill={i < 4 ? '#ffb74a' : '#4a3b2e'}
              style={{ animationDelay: `${i * 0.3}s` }}
            />
          </g>
        ))}
        <rect x="56" y="92" width="148" height="7" rx="3.5" fill="#4a3b2e" />
        <rect x="56" y="106" width="110" height="7" rx="3.5" fill="#4a3b2e" />
        <rect x="56" y="120" width="128" height="7" rx="3.5" fill="#4a3b2e" />
      </svg>
    ),
  },
  {
    title: 'Surveys',
    kind: 'Source',
    body: 'The score, and the free-text answer after it, which is where the detail lives.',
    preview: 'pv-survey',
    art: (
      <svg viewBox="0 0 260 160">
        <rect x="20" y="36" width="150" height="8" rx="4" fill="#9fcfc6" />
        <rect x="20" y="50" width="96" height="8" rx="4" fill="#bfe3dc" />
        {Array.from({ length: 11 }, (_, i) => (
          <rect
            key={i}
            x={20 + i * 20.5}
            y="78"
            width="17"
            height="26"
            rx="5"
            fill={i < 7 ? '#f9dad3' : i < 9 ? '#ffebc2' : '#b9e8df'}
          />
        ))}
        <rect
          className="a-slide"
          x="120"
          y="75"
          width="23"
          height="32"
          rx="7"
          fill="none"
          stroke="#0a7268"
          strokeWidth="2.5"
        />
        <rect x="20" y="120" width="220" height="18" rx="6" fill="#fff" />
      </svg>
    ),
  },
  {
    title: 'Call notes',
    kind: 'Source',
    body: 'Notes and transcripts from sales and success calls, pasted in or forwarded.',
    preview: 'pv-calls',
    art: (
      <svg viewBox="0 0 260 160">
        {Array.from({ length: 17 }, (_, i) => {
          const h = [
            18, 34, 52, 30, 64, 44, 76, 38, 58, 70, 40, 60, 28, 48, 34, 22, 14,
          ][i]!;
          return (
            <rect
              key={i}
              className="a-wave"
              x={36 + i * 11}
              y={70 - h / 2}
              width="6"
              height={h}
              rx="3"
              fill={i % 3 === 0 ? '#6fd3ff' : '#ff6fa8'}
              style={{ animationDelay: `${(i % 5) * 0.15}s` }}
            />
          );
        })}
        <rect x="52" y="124" width="156" height="7" rx="3.5" fill="#3a3160" />
      </svg>
    ),
  },
  {
    title: 'Community forum',
    kind: 'Source',
    body: 'Threads and their replies, with an upvote counted once per customer.',
    preview: 'pv-forum',
    art: (
      <svg viewBox="0 0 260 160">
        <rect
          x="30"
          y="22"
          width="200"
          height="62"
          rx="10"
          fill="#fff"
          stroke="#ded7ca"
        />
        <g className="a-vote">
          <path d="M52 50 l10 -12 l10 12 z" fill="#b5533a" />
          <rect x="54" y="56" width="16" height="6" rx="3" fill="#b5533a" />
        </g>
        <rect x="86" y="38" width="120" height="8" rx="4" fill="#1f1e1c" />
        <rect x="86" y="54" width="90" height="6" rx="3" fill="#cfc4b3" />
        <rect x="60" y="94" width="170" height="20" rx="8" fill="#efeae1" />
        <rect x="60" y="120" width="140" height="20" rx="8" fill="#efeae1" />
        <path d="M44 84 v46 h12" fill="none" stroke="#cfc4b3" strokeWidth="2" />
      </svg>
    ),
  },
  {
    title: 'Issue tracker',
    kind: 'Destination',
    body: 'Link a theme to an issue. When the issue closes, the theme knows.',
    preview: 'pv-tracker',
    art: (
      <svg viewBox="0 0 260 160">
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <rect
              x={28 + i * 70}
              y="20"
              width="64"
              height="120"
              rx="10"
              fill="#e3e0d8"
            />
            <rect
              x={36 + i * 70}
              y="30"
              width="30"
              height="6"
              rx="3"
              fill={['#b5533a', '#8a5300', '#0a7268'][i]}
            />
          </g>
        ))}
        <rect x="34" y="84" width="52" height="24" rx="6" fill="#fff" />
        <rect x="104" y="48" width="52" height="24" rx="6" fill="#fff" />
        <g className="a-move">
          <rect x="34" y="48" width="52" height="28" rx="6" fill="#1f1e1c" />
          <rect x="41" y="57" width="30" height="5" rx="2.5" fill="#ffb74a" />
          <rect x="41" y="66" width="20" height="4" rx="2" fill="#6b6459" />
        </g>
      </svg>
    ),
  },
  {
    title: 'Team chat',
    kind: 'Destination',
    body: 'A short daily post of new themes, in the channel your team already reads.',
    preview: 'pv-alerts',
    art: (
      <svg viewBox="0 0 260 160">
        <rect x="20" y="20" width="56" height="120" rx="10" fill="#171e2b" />
        {[0, 1, 2, 3].map((i) => (
          <rect
            key={i}
            x="30"
            y={34 + i * 18}
            width={i === 1 ? 26 : 36}
            height="7"
            rx="3.5"
            fill={i === 1 ? '#ffb74a' : '#2c3546'}
          />
        ))}
        <rect x="90" y="28" width="140" height="8" rx="4" fill="#2c3546" />
        <rect x="90" y="44" width="100" height="8" rx="4" fill="#2c3546" />
        <g className="a-toast">
          <rect x="90" y="78" width="150" height="52" rx="12" fill="#f4ede3" />
          <circle cx="112" cy="104" r="11" fill="#ff7a3d" />
          <path d="M107 107v-4a5 5 0 0 1 10 0v4l2 2h-14z" fill="#f4ede3" />
          <rect x="132" y="94" width="90" height="7" rx="3.5" fill="#10151f" />
          <rect x="132" y="108" width="60" height="6" rx="3" fill="#8f897f" />
        </g>
      </svg>
    ),
  },
  {
    title: 'Webhooks and API',
    kind: 'Both',
    body: 'Send feedback in from anywhere, and get every change back out, as JSON.',
    preview: 'pv-api',
    art: (
      <div className="api">
        <div className="m">POST /v1/feedback</div>
        <div>{'{'}</div>
        <div>
          {'  "source": '}
          <span className="s">"chat"</span>,
        </div>
        <div>
          {'  "theme": '}
          <span className="s">"Dark mode"</span>,
        </div>
        <div>
          {'  "plan": '}
          <span className="w">"team"</span>
        </div>
        <div>
          {'}'} <span className="cur" />
        </div>
      </div>
    ),
  },
  {
    title: 'Spreadsheet export',
    kind: 'Destination',
    body: 'Every message, theme and reply as CSV, whenever you want it, on every plan.',
    preview: 'pv-sheet',
    art: (
      <svg viewBox="0 0 260 160">
        <rect
          x="30"
          y="20"
          width="170"
          height="120"
          rx="8"
          fill="#fff"
          stroke="#ded7ca"
        />
        <rect x="30" y="20" width="170" height="20" rx="8" fill="#e2572a" />
        <rect x="30" y="32" width="170" height="8" fill="#e2572a" />
        {[0, 1, 2, 3].map((i) => (
          <path key={i} d={`M30 ${61 + i * 21}h170`} stroke="#efeae1" />
        ))}
        <path d="M86 40v100M142 40v100" stroke="#efeae1" />
        <rect
          className="a-scan"
          x="31"
          y="41"
          width="168"
          height="20"
          fill="#f5a524"
          opacity=".25"
        />
        <g className="a-bounce">
          <circle cx="220" cy="40" r="16" fill="#0f1522" />
          <path
            d="M220 32v14M214 41l6 6 6-6"
            stroke="#fbfaf7"
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="round"
          />
        </g>
      </svg>
    ),
  },
];

/**
 * A pointer over a tile tilts it towards the pointer and shifts its picture a
 * few pixels, which reads as depth. Only with a real hovering pointer and
 * with motion allowed; touch and keyboard users get the flat tiles.
 */
function useTilt(list: React.RefObject<HTMLUListElement | null>) {
  useEffect(() => {
    const root = list.current;
    if (!root) return;
    const hover = window.matchMedia('(hover: hover)');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

    function move(event: PointerEvent) {
      if (!hover.matches || reduce.matches) return;
      const tile = (event.target as Element).closest<HTMLElement>('.tile');
      const inner = tile?.querySelector<HTMLElement>('.tile-in');
      if (!tile || !inner) return;
      const box = tile.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width - 0.5;
      const y = (event.clientY - box.top) / box.height - 0.5;
      tile.classList.add('tilting');
      inner.style.setProperty('--ry', `${(x * 9).toFixed(2)}deg`);
      inner.style.setProperty('--rx', `${(-y * 9).toFixed(2)}deg`);
      inner.style.setProperty('--px', (x * 2).toFixed(3));
      inner.style.setProperty('--py', (y * 2).toFixed(3));
    }

    function leave(event: PointerEvent) {
      const tile = event.target as HTMLElement;
      if (!tile.classList?.contains('tile')) return;
      tile.classList.remove('tilting');
      const inner = tile.querySelector<HTMLElement>('.tile-in');
      for (const name of ['--rx', '--ry', '--px', '--py']) {
        inner?.style.removeProperty(name);
      }
    }

    root.addEventListener('pointermove', move);
    // pointerleave does not bubble; capturing sees it on each tile.
    root.addEventListener('pointerleave', leave, true);
    return () => {
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerleave', leave, true);
    };
  }, [list]);
}

export function SourceTiles() {
  const list = useRef<HTMLUListElement>(null);
  useTilt(list);
  return (
    <ul className="tile-grid" ref={list}>
      {TILES.map((tile) => (
        <li className="tile" key={tile.title}>
          <div className="tile-in">
            <div className={`pv ${tile.preview}`} aria-hidden="true">
              <div className="fg">{tile.art}</div>
              <span className="shine" />
            </div>
            <div className="cap">
              <div className="cap-top">
                <h3>{tile.title}</h3>
                <span className="kind">{tile.kind}</span>
              </div>
              <p>{tile.body}</p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
