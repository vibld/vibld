import { useEffect, useRef, useState } from 'react';

import { SectionHead } from './SiteChrome';
import { Icon } from './Icon';

const STEPS = [
  {
    title: 'Connect',
    body: 'Forward a support address, paste a chat webhook, drop the widget snippet into your app.',
  },
  {
    title: 'Collect',
    body: 'Every message lands in one inbox with its source, its customer and their plan attached.',
  },
  {
    title: 'Group',
    body: 'Similar requests gather into themes. Rename, merge or split them; the call is yours.',
  },
  {
    title: 'Rank',
    body: 'Themes are ordered by how many customers raised them, and by whatever weighting you set.',
  },
  {
    title: 'Close the loop',
    body: 'When it ships, reply from the theme to everyone who asked, in one go.',
  },
];

const LAST = STEPS.length;
const DWELL = 3600;

/**
 * The five steps, told twice: as a numbered list anyone can read, and as an
 * illustration that plays through them.
 *
 * The list is the content. The illustration is decoration (hidden from
 * assistive technology, captioned as an illustration) and the prerendered
 * page shows it at its last step with every step marked, so nothing is
 * missing before a script runs. With motion allowed it starts playing the
 * first time it scrolls into view; the button pauses it, and hovering over
 * the illustration holds it still.
 */
export function HowItWorks() {
  const [step, setStep] = useState(LAST);
  const [playing, setPlaying] = useState(false);
  const [held, setHeld] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const el = stage.current;
    if (reduce.matches || !el || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !started.current) {
          started.current = true;
          setStep(1);
          setPlaying(true);
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || held) return;
    const timer = window.setTimeout(
      () => setStep((current) => (current % LAST) + 1),
      DWELL + (step === LAST ? 1600 : 0),
    );
    return () => window.clearTimeout(timer);
  }, [playing, held, step]);

  function choose(next: number) {
    started.current = true;
    setStep(next);
  }

  function toggle() {
    started.current = true;
    if (!playing && step === LAST) setStep(1);
    setPlaying(!playing);
  }

  return (
    <div className="band">
      <section className="sec" aria-labelledby="how-title">
        <div className="wrap">
          <div className="how-top">
            <SectionHead
              id="how-title"
              kicker="How it works"
              title="From scattered messages to a clear next step,"
              emphasis="in five moves"
              lead="The same sequence for every message, whichever way it arrived. You decide at the points that matter: what a theme is called, and what ships."
            />
            <button type="button" className="play" onClick={toggle}>
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                {playing ? (
                  <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
                ) : (
                  <path d="M7 5v14l12-7z" />
                )}
              </svg>
              <span>
                {playing ? 'Pause the sequence' : 'Play the sequence'}
              </span>
            </button>
          </div>

          <div className="rail-wrap">
            <svg
              className="rail-wave"
              viewBox="0 0 1000 40"
              preserveAspectRatio="none"
              aria-hidden="true"
              style={{ '--prog': step - 1 } as React.CSSProperties}
            >
              <defs>
                <linearGradient id="railg" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#3ccfc0" />
                  <stop offset="1" stopColor="#ffb74a" />
                </linearGradient>
              </defs>
              <path
                className="w-bg"
                d="M100 20 Q200 2 300 20 T500 20 T700 20 T900 20"
              />
              <path
                className="w-fg"
                pathLength={4}
                d="M100 20 Q200 2 300 20 T500 20 T700 20 T900 20"
              />
            </svg>
            <ol className="rail">
              {STEPS.map((item, index) => {
                const n = index + 1;
                const state =
                  n === step ? 'is-active' : n < step ? 'is-done' : '';
                return (
                  <li key={item.title} className={state}>
                    <button
                      type="button"
                      className="rail-btn"
                      aria-current={n === step ? 'step' : undefined}
                      onClick={() => choose(n)}
                    >
                      <span className="num" aria-hidden="true">
                        {n}
                      </span>
                      <span className="rail-title">{item.title}</span>
                    </button>
                    <p>{item.body}</p>
                  </li>
                );
              })}
            </ol>
          </div>

          <figure
            className="stage-wrap"
            onPointerEnter={(event) => {
              // Only a mouse hovers; a tap would otherwise freeze it for good.
              if (event.pointerType === 'mouse') setHeld(true);
            }}
            onPointerLeave={() => setHeld(false)}
          >
            <div className="browser">
              <div className="b-top" aria-hidden="true">
                <div className="b-dots">
                  <i />
                  <i />
                  <i />
                </div>
                <div className="addr">app.emberline.example/inbox</div>
              </div>
              <div
                className="stage"
                data-step={step}
                ref={stage}
                aria-hidden="true"
              >
                <Stage />
              </div>
            </div>
            <figcaption className="stage-bar">
              <span className="tag">Illustration, not a screenshot</span>
              <span>The messages and themes in it are samples.</span>
            </figcaption>
          </figure>
        </div>
      </section>
    </div>
  );
}

const DOT = {
  email: '#ff7a3d',
  chat: '#3ccfc0',
  widget: '#ff8a95',
  desk: '#ffb74a',
};

/** The five pictures, stacked; CSS shows the one matching `data-step`. */
function Stage() {
  return (
    <>
      <div className="lay l-1">
        <div className="src-flow">
          <ul className="src-list">
            <li>
              <Icon name="mail" />
              Email
            </li>
            <li>
              <Icon name="chat" />
              Live chat
            </li>
            <li>
              <Icon name="widget" />
              In-app widget
            </li>
          </ul>
          <svg
            className="flows"
            viewBox="0 0 100 150"
            preserveAspectRatio="none"
          >
            <path d="M0 22 C50 22 50 75 100 75" stroke={DOT.email} />
            <path d="M0 75 C50 75 50 75 100 75" stroke={DOT.chat} />
            <path d="M0 128 C50 128 50 75 100 75" stroke={DOT.widget} />
          </svg>
          <span className="hub">
            <span className="logo-mark" />
          </span>
        </div>
      </div>

      <div className="lay l-2">
        <div className="panel">
          <h4>Inbox</h4>
          {[
            [
              'A scheduled CSV would give us that hour back.',
              DOT.email,
              'email',
            ],
            ['Signs me out when I switch networks.', DOT.chat, 'chat'],
            ['Is there a dark mode?', DOT.widget, 'widget'],
            ['Import stopped with no message.', DOT.desk, 'desk'],
            ['Can we export this every Monday?', DOT.chat, 'chat'],
          ].map(([text, colour, from]) => (
            <div className="row" key={text}>
              <i className="src-dot" style={{ background: colour }} />
              <span>{text}</span>
              <small>{from}</small>
            </div>
          ))}
        </div>
      </div>

      <div className="lay l-3">
        <div className="themes-grid">
          {[
            ['Scheduled exports', 'email, chat, desk'],
            ['Dark mode', 'widget, chat'],
            ['Import errors', 'desk, email'],
          ].map(([name, from]) => (
            <div className="theme-card" key={name}>
              {name}
              <small>from {from}</small>
              <i />
              <i style={{ width: '60%' }} />
            </div>
          ))}
        </div>
      </div>

      <div className="lay l-4">
        <div className="panel">
          <h4>Themes, ranked</h4>
          <div className="bars">
            {[
              ['Scheduled exports', '92%'],
              ['Import errors', '71%'],
              ['Dark mode', '54%'],
              ['Bulk editing', '38%'],
            ].map(([name, width]) => (
              <div className="bar" key={name}>
                <span>{name}</span>
                <b style={{ '--w': width } as React.CSSProperties} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="lay l-5">
        <div className="loop">
          <div className="panel">
            <h4>Theme: Scheduled exports</h4>
            <div className="row">
              <i className="src-dot" style={{ background: DOT.desk }} />
              <span>Weekly report, sent as CSV on Mondays</span>
              <span className="shipped">Shipped</span>
            </div>
            {[
              [
                'A scheduled CSV would give us that hour back.',
                DOT.email,
                'email',
              ],
              ['Can we export this every Monday?', DOT.chat, 'chat'],
              [
                'Does the report have to be downloaded by hand?',
                DOT.desk,
                'desk',
              ],
            ].map(([text, colour, from]) => (
              <div className="row" key={text}>
                <i className="src-dot" style={{ background: colour }} />
                <span>{text}</span>
                <small>{from}</small>
              </div>
            ))}
          </div>
          <div className="toasts">
            <div className="toast">
              <Icon name="reply" />
              Reply sent to everyone who asked
            </div>
            <div className="toast">
              <Icon name="kanban" />
              Linked to the issue in your tracker
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
