import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { FormEvent, KeyboardEvent, ReactNode, RefObject } from 'react';
import type { StylePresetId } from '@vibld/ai/style-presets';

import {
  APP_CHUNKS,
  LOG,
  STEPS,
  STEP_ANNOUNCEMENTS,
  STEP_LABELS,
  appLines,
  checkLines,
  highlight,
  lookCss,
  specCss,
  specLines,
} from '../demo-script.ts';
import type { Step } from '../demo-script.ts';
import { DEMO_SITES, DEMO_SITE_IDS, siteForRequest } from '../demo-sites.ts';
import type { DemoSiteId } from '../demo-sites.ts';
import { lookById, specLook } from '../looks.ts';
import type { Look } from '../looks.ts';
import { SiteMiniature } from './SiteMiniature.tsx';
import type { MiniatureRegion } from './SiteMiniature.tsx';

/**
 * The home page's live build: a scripted demonstration of the flow, drawn
 * in the page.
 *
 * It calls nothing. Every word it "types" and every line it "writes" is in
 * `demo-script.ts` and `demo-sites.ts`, and the page says so beside it. What
 * it is for is showing the order things happen in (a request, three
 * directions, a spec, a build, checks, a private preview) faster than a
 * paragraph can.
 *
 * Two states matter more than the animation between them:
 *
 * - At rest, which is what the prerendered HTML, a crawler, a reader without
 *   JavaScript and a reader who asked for reduced motion all get, it is the
 *   finished build: every step done, the site drawn, the code written. None
 *   of it waits on a script or an observer to become visible.
 * - After hydration, and only if motion is welcome, it replays the build
 *   once the builder scrolls into view, then cycles through a few styles.
 *   Pause freezes it where it is; Replay starts it again. Anything the reader
 *   picks (a suggestion, a style) stops the cycling so the page stops moving
 *   under them.
 */

/** The styles offered on the builder itself, as chips. */
export const BUILDER_LOOKS: readonly ('spec' | StylePresetId)[] = [
  'spec',
  'glassmorphism',
  'brutalism',
  'editorial',
  'retrowave',
  'aurora',
  'claymorphism',
  'liquidGlass',
  'neumorphism',
  'bentoGrid',
  'vibrantBlocks',
  'warmTerminal',
  'warmPaper',
  'minimalist',
];

/** The order the idle builder cycles through, ending back on the spec. */
const CYCLE: readonly ('spec' | StylePresetId)[] = [
  'glassmorphism',
  'brutalism',
  'editorial',
  'retrowave',
  'aurora',
  'claymorphism',
  'liquidGlass',
  'warmPaper',
  'bentoGrid',
  'vibrantBlocks',
  'warmTerminal',
  'minimalist',
  'spec',
];

type LookId = 'spec' | StylePresetId;

interface CodeState {
  tab: string;
  status: string;
  lines: string[];
  /** The line being typed, or null when nothing is. */
  partial: string | null;
  /** Lines from this index on were written while the reader watched. */
  freshFrom: number;
}

interface DemoState {
  site: DemoSiteId;
  prompt: string;
  /** Characters of the prompt typed so far, or null for all of it. */
  typed: number | null;
  step: Step;
  /** Log entries finished. The next one, if any, is in progress. */
  logDone: number;
  /** Direction sketches shown so far (0 to 3), and whether A is chosen. */
  sketches: number;
  chosen: boolean;
  wire: boolean;
  building: boolean;
  shown: MiniatureRegion[];
  look: LookId;
  code: CodeState;
  canvas: string;
  /** The region the inspector outlines. */
  inspect: MiniatureRegion | null;
  /** What the live region last said. */
  announcement: string;
}

function finished(site: DemoSiteId, look: LookId = 'spec'): DemoState {
  const s = DEMO_SITES[site];
  return {
    site,
    prompt: s.prompt,
    typed: null,
    step: 'preview',
    logDone: LOG.length,
    sketches: 3,
    chosen: true,
    wire: false,
    building: false,
    shown: [],
    look,
    code:
      look === 'spec'
        ? {
            tab: 'src/App.tsx',
            status: 'accepted',
            lines: appLines(s),
            partial: null,
            freshFrom: Number.POSITIVE_INFINITY,
          }
        : {
            tab: 'src/index.css',
            status: 'restyled',
            lines: lookCss(look),
            partial: null,
            freshFrom: Number.POSITIVE_INFINITY,
          },
    canvas: '1440 viewport',
    inspect: null,
    announcement: '',
  };
}

export function lookFor(site: DemoSiteId, id: LookId): Look {
  return id === 'spec' ? specLook(site) : lookById(id);
}

function lookName(id: LookId): string {
  return id === 'spec' ? 'Spec A' : lookById(id).name;
}

class Aborted extends Error {}

interface DemoControls {
  state: DemoState;
  paused: boolean;
  /** Build a site from a suggestion, a use case, or a typed request. */
  build(site: DemoSiteId, prompt?: string): void;
  /** Re-skin the finished site. */
  restyle(id: LookId): void;
  togglePause(): void;
  replay(): void;
  builderRef: RefObject<HTMLDivElement | null>;
}

const DemoContext = createContext<DemoControls | null>(null);

export function useDemo(): DemoControls {
  const controls = useContext(DemoContext);
  if (!controls) throw new Error('useDemo outside <LiveBuild>');
  return controls;
}

/** Whether the reader asked for less motion, read after hydration only. */
function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function LiveBuild({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>(() => finished('pottery'));
  const [paused, setPausedState] = useState(false);
  const builderRef = useRef<HTMLDivElement | null>(null);
  const runId = useRef(0);
  const pausedRef = useRef(false);
  const cycling = useRef(true);

  const patch = useCallback(
    (next: Partial<DemoState> | ((s: DemoState) => Partial<DemoState>)) =>
      setState((s) => ({
        ...s,
        ...(typeof next === 'function' ? next(s) : next),
      })),
    [],
  );

  /**
   * A wait that stands still while paused and throws once a newer run has
   * started, so an abandoned run unwinds instead of fighting the new one.
   */
  const sleep = useCallback(
    (ms: number, id: number) =>
      new Promise<void>((resolve, reject) => {
        let elapsed = 0;
        let last = performance.now();
        const tick = (now: number) => {
          if (id !== runId.current) return reject(new Aborted());
          if (!pausedRef.current) elapsed += now - last;
          last = now;
          if (elapsed >= ms) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    [],
  );

  const stream = useCallback(
    async (
      id: number,
      tab: string,
      lines: string[],
      status: string,
      speed: number,
    ) => {
      patch({ code: { tab, status, lines: [], partial: '', freshFrom: 0 } });
      for (const line of lines) {
        for (let c = 0; c <= line.length; c += speed) {
          const typed = line.slice(0, c);
          patch((s) => ({ code: { ...s.code, partial: typed } }));
          await sleep(16, id);
        }
        patch((s) => ({
          code: { ...s.code, lines: [...s.code.lines, line], partial: '' },
        }));
      }
      patch((s) => ({ code: { ...s.code, partial: null } }));
    },
    [patch, sleep],
  );

  const run = useCallback(
    async (site: DemoSiteId, prompt: string) => {
      const id = ++runId.current;
      cycling.current = true;
      const s = DEMO_SITES[site];
      const say = (step: Step) =>
        patch({ step, announcement: STEP_ANNOUNCEMENTS[step] });
      try {
        setState({
          ...finished(site),
          prompt,
          typed: 0,
          step: 'prompt',
          logDone: -1,
          sketches: 0,
          chosen: false,
          wire: true,
          building: true,
          shown: [],
          code: {
            tab: 'waiting',
            status: '',
            lines: [],
            partial: null,
            freshFrom: 0,
          },
          canvas: 'empty canvas',
          announcement: STEP_ANNOUNCEMENTS.prompt,
        });
        await sleep(400, id);
        for (let i = 1; i <= prompt.length; i++) {
          patch({ typed: i });
          await sleep(prompt[i - 1] === ' ' ? 30 : 18, id);
        }
        patch({ typed: null });
        await sleep(300, id);

        say('directions');
        patch({ logDone: 0 });
        for (let d = 1; d <= 3; d++) {
          await sleep(180, id);
          patch({ sketches: d });
        }
        await sleep(450, id);
        patch({ chosen: true, logDone: 1 });
        await sleep(350, id);

        say('spec');
        await stream(id, 'DESIGN.md', specLines(s), 'writing', 6);
        patch({ logDone: 2 });
        await sleep(300, id);

        say('build');
        patch({ canvas: 'wireframe' });
        const app = appLines(s);
        patch({
          code: {
            tab: 'src/App.tsx',
            status: 'writing',
            lines: [],
            partial: null,
            freshFrom: 0,
          },
        });
        for (const [region, from, to] of APP_CHUNKS) {
          patch((current) => ({
            shown: [...current.shown, region],
            inspect: region,
          }));
          for (const line of app.slice(from, to)) {
            for (let c = 0; c <= line.length; c += 5) {
              const typed = line.slice(0, c);
              patch((current) => ({
                code: { ...current.code, partial: typed },
              }));
              await sleep(16, id);
            }
            patch((current) => ({
              code: {
                ...current.code,
                lines: [...current.code.lines, line],
                partial: '',
              },
            }));
          }
          patch((current) => ({ code: { ...current.code, partial: null } }));
          await sleep(110, id);
        }
        await sleep(250, id);
        patch({ canvas: 'filling tokens', wire: false });
        await sleep(900, id);
        patch({ building: false, shown: [], inspect: null });

        say('checks');
        patch({ logDone: 3 });
        await stream(id, 'design checks', checkLines(s), 'running', 7);
        patch((current) => ({
          logDone: LOG.length,
          step: 'preview',
          announcement: STEP_ANNOUNCEMENTS.preview,
          canvas: '1440 viewport',
          code: { ...current.code, status: 'accepted' },
        }));

        await sleep(1500, id);
        let index = 0;
        for (;;) {
          if (!cycling.current) {
            await sleep(400, id);
            continue;
          }
          const next = CYCLE[index % CYCLE.length]!;
          index++;
          patch({ look: next });
          await stream(
            id,
            'src/index.css',
            next === 'spec' ? specCss(s) : lookCss(next),
            'restyled',
            7,
          );
          patch((current) => ({
            code: { ...current.code, status: 'accepted' },
          }));
          await sleep(2600, id);
        }
      } catch (error) {
        if (!(error instanceof Aborted)) throw error;
      }
    },
    [patch, sleep, stream],
  );

  const setPaused = useCallback((next: boolean) => {
    pausedRef.current = next;
    setPausedState(next);
  }, []);

  const bringIntoView = useCallback(() => {
    const builder = builderRef.current;
    if (!builder) return;
    const box = builder.getBoundingClientRect();
    if (box.top < -box.height * 0.3 || box.top > window.innerHeight * 0.55) {
      builder.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'start',
      });
    }
  }, []);

  const build = useCallback(
    (site: DemoSiteId, prompt?: string) => {
      const text = prompt ?? DEMO_SITES[site].prompt;
      setPaused(false);
      bringIntoView();
      if (prefersReducedMotion()) {
        // No build to watch: the finished site, straight away.
        runId.current++;
        setState({
          ...finished(site),
          prompt: text,
          announcement: `Showing the finished ${DEMO_SITES[site].label.toLowerCase()} demonstration.`,
        });
        return;
      }
      void run(site, text);
    },
    [bringIntoView, run, setPaused],
  );

  const restyle = useCallback((id: LookId) => {
    cycling.current = false;
    setState((s) => {
      // Picking a style mid-build finishes the build first, rather than
      // re-skinning a wireframe.
      if (s.building || s.step !== 'preview') runId.current++;
      const base = s.building || s.step !== 'preview' ? finished(s.site) : s;
      return {
        ...base,
        prompt: s.prompt,
        look: id,
        code: {
          tab: 'src/index.css',
          status: 'restyled',
          lines: id === 'spec' ? specCss(DEMO_SITES[s.site]) : lookCss(id),
          partial: null,
          freshFrom: 0,
        },
        announcement: `Restyled as ${lookName(id)}.`,
      };
    });
  }, []);

  const replay = useCallback(() => {
    setPaused(false);
    if (prefersReducedMotion()) {
      runId.current++;
      setState((s) => ({
        ...finished(s.site),
        prompt: s.prompt,
        announcement: 'Showing the finished build.',
      }));
      return;
    }
    void run(state.site, state.prompt);
  }, [run, setPaused, state.prompt, state.site]);

  // Autoplay: once, when the builder is first on screen, and never for a
  // reader who asked for less motion. Until then the finished build stands.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const builder = builderRef.current;
    if (!builder) return;
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      void run('pottery', DEMO_SITES.pottery.prompt);
    };
    if (!('IntersectionObserver' in window)) {
      start();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          start();
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(builder);
    return () => {
      observer.disconnect();
      runId.current++;
    };
  }, [run]);

  const controls = useMemo<DemoControls>(
    () => ({
      state,
      paused,
      build,
      restyle,
      togglePause: () => setPaused(!pausedRef.current),
      replay,
      builderRef,
    }),
    [build, paused, replay, restyle, setPaused, state],
  );

  return (
    <DemoContext.Provider value={controls}>{children}</DemoContext.Provider>
  );
}

/**
 * "What do you want to build?", and the suggestions under it.
 *
 * A real form so Enter submits it, but it goes nowhere: without JavaScript
 * it reloads this page at the builder, which is already showing a finished
 * build, and with it the request only picks which invented site to draw.
 */
export function AskForm() {
  const { build, state } = useDemo();
  const inputId = useId();
  const [value, setValue] = useState('');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const request = value.replace(/\s+/g, ' ').trim().slice(0, 240);
    build(request ? siteForRequest(request) : 'pottery', request || undefined);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <form className="lb-ask" action="#builder" onSubmit={submit}>
      <label htmlFor={inputId}>What do you want to build?</label>
      <div className="lb-ask__row">
        <textarea
          id={inputId}
          rows={2}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="A site for my Saturday wheel-throwing classes, where people pick a two-hour slot."
        />
        <button className="button lb-ask__go" type="submit">
          Watch it build
          <Arrow />
        </button>
      </div>
      <div
        className="lb-sugg"
        role="group"
        aria-label="Suggestions. Each one starts the demonstration below."
      >
        <span className="lb-sugg__label" aria-hidden="true">
          Try
        </span>
        {DEMO_SITE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className="lb-sug"
            aria-pressed={state.site === id}
            onClick={() => build(id)}
          >
            <i
              aria-hidden="true"
              style={{ background: DEMO_SITES[id].colors.primary.fill }}
            />
            {DEMO_SITES[id].label}
          </button>
        ))}
      </div>
    </form>
  );
}

export function Arrow() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

/** The builder window: progress, conversation, preview and code. */
export function BuilderWindow() {
  const { state, paused, togglePause, replay, restyle, builderRef } = useDemo();
  const site = DEMO_SITES[state.site];
  const look = lookFor(state.site, state.look);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const stepIndex = STEPS.indexOf(state.step);
  const stepsRef = useRef<HTMLOListElement | null>(null);

  // On a phone the progress strip scrolls sideways. Keep the current step in
  // it, by moving the strip alone rather than the page.
  useEffect(() => {
    const list = stepsRef.current;
    const now = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !now) return;
    const left = now.offsetLeft - (list.clientWidth - now.offsetWidth) / 2;
    list.scrollLeft = Math.max(0, left);
  }, [stepIndex]);
  const typed =
    state.typed === null ? state.prompt : state.prompt.slice(0, state.typed);

  return (
    <div
      ref={builderRef}
      className="lb-builder"
      id="builder"
      role="region"
      aria-label="A demonstration of vibld building a site, drawn in this page"
    >
      <p className="sr-only" aria-live="polite">
        {state.announcement}
      </p>
      <div className="lb-bar">
        <div className="lb-bar__dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <span className="lb-bar__proj">
          vibld / <b>{site.slug}</b>
        </span>
        <ol className="lb-steps" aria-label="Build progress" ref={stepsRef}>
          {STEPS.map((step, index) => (
            <li
              key={step}
              className={
                index < stepIndex
                  ? 'is-done'
                  : index === stepIndex
                    ? 'is-now'
                    : ''
              }
              aria-current={index === stepIndex ? 'step' : undefined}
            >
              {STEP_LABELS[step]}
            </li>
          ))}
        </ol>
        <div className="lb-bar__ctl">
          {/*
            The accessible name is set outright because the visible label is
            hidden on a phone, and it starts with the visible word so the two
            agree wherever both exist.
          */}
          <button
            type="button"
            className="lb-icon-btn"
            aria-label={
              paused ? 'Play the demonstration' : 'Pause the demonstration'
            }
            onClick={togglePause}
          >
            {paused ? (
              <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M4 2.5v11l9-5.5z" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <rect x="3" y="2.5" width="3.5" height="11" rx="1" />
                <rect x="9.5" y="2.5" width="3.5" height="11" rx="1" />
              </svg>
            )}
            <span className="lb-icon-btn__label" aria-hidden="true">
              {paused ? 'Play' : 'Pause'}
            </span>
          </button>
          <button
            type="button"
            className="lb-icon-btn"
            aria-label="Replay the demonstration"
            onClick={replay}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M2.5 8a5.5 5.5 0 1 0 1.7-4" />
              <path d="M2.5 2.5v3h3" />
            </svg>
            <span className="lb-icon-btn__label" aria-hidden="true">
              Replay
            </span>
          </button>
        </div>
      </div>

      <div className="lb-panes">
        <div className="lb-pane lb-prompt">
          <p className="lb-pane__h">
            Conversation <b>1 prompt</b>
          </p>
          <div className="lb-chat">
            <div className="lb-bubble lb-bubble--you">
              <span className="lb-who">You</span>
              <span>{typed}</span>
              {state.typed !== null ? (
                <span className="lb-caret" aria-hidden="true" />
              ) : null}
              <span className="lb-ref">
                <LinkIcon />
                reference URL: optional
              </span>
            </div>
            <div className="lb-bubble">
              <span className="lb-who">vibld</span>
              Three directions. Pick one, or ask for more.
              <ul className="lb-dirs" aria-label="Three mockup directions">
                {(['a', 'b', 'c'] as const).map((key, index) => (
                  <li
                    key={key}
                    className={`lb-dir lb-dir--${key}${
                      state.chosen && index === 0 ? ' is-chosen' : ''
                    }${index < state.sketches ? '' : ' is-dim'}`}
                  >
                    <span className="lb-dir__img" aria-hidden="true" />
                    <span>
                      {key.toUpperCase()}{' '}
                      {key === 'a' ? 'calm' : key === 'b' ? 'serif' : 'blocks'}
                      {state.chosen && index === 0 ? (
                        <span className="sr-only">, chosen</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <ol className="lb-log" aria-label="Run log">
              {LOG.map((entry, index) => (
                <li
                  key={entry}
                  className={
                    index < state.logDone
                      ? 'is-done'
                      : index === state.logDone
                        ? 'is-now'
                        : 'is-pending'
                  }
                >
                  {entry}
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="lb-pane lb-canvas-pane">
          <p className="lb-pane__h">
            Preview <b>style: {lookName(state.look)}</b>
          </p>
          <div className="lb-canvas" ref={canvasRef}>
            <div className="lb-ruler-x" aria-hidden="true" />
            <div className="lb-ruler-y" aria-hidden="true" />
            <div className="lb-canvas__meta">
              <span className="lb-pill">
                <LockIcon />
                Private preview
              </span>
              <span className="lb-pill lb-pill--sig">{state.canvas}</span>
            </div>
            <div className="lb-frame">
              <SiteMiniature
                site={site}
                look={look}
                stage={{
                  wire: state.wire,
                  building: state.building,
                  shown: new Set(state.shown),
                }}
              />
              <p className="sr-only">
                Preview of {site.text.brand}, an invented site, in the{' '}
                {lookName(state.look)} style.
              </p>
            </div>
            <Inspector
              canvasRef={canvasRef}
              target={state.inspect}
              version={`${state.site}:${state.look}:${state.shown.length}`}
              idle={!state.building && state.step === 'preview' && !paused}
            />
          </div>
          <div
            className="lb-chips"
            role="group"
            aria-label="Re-skin the preview with a style"
          >
            <span className="lb-chips__label" aria-hidden="true">
              Style
            </span>
            {BUILDER_LOOKS.map((id) => (
              <button
                key={id}
                type="button"
                className="lb-chip"
                aria-pressed={state.look === id}
                onClick={() => restyle(id)}
              >
                {lookName(id)}
              </button>
            ))}
          </div>
        </div>

        <div className="lb-pane lb-code-pane">
          <p className="lb-pane__h">
            <span className="lb-tab">{state.code.tab}</span>
            <b>{state.code.status}</b>
          </p>
          <CodeView code={state.code} />
        </div>
      </div>
    </div>
  );
}

function CodeView({ code }: { code: CodeState }) {
  const preRef = useRef<HTMLPreElement | null>(null);
  const writing = code.partial !== null;

  // Follow the cursor while lines are being written, and only then: a reader
  // scrolling a finished file should not be pulled back to its end.
  useEffect(() => {
    if (!writing) return;
    const pre = preRef.current;
    if (pre) pre.scrollTop = pre.scrollHeight;
  }, [writing, code.lines.length, code.partial]);

  return (
    <pre
      ref={preRef}
      className="lb-code"
      tabIndex={0}
      aria-label={`${code.tab}, illustrative code`}
    >
      <code>
        {code.lines.map((line, index) => (
          <span
            key={`${code.tab}-${index}`}
            className={index >= code.freshFrom ? 'lb-l lb-l--new' : 'lb-l'}
          >
            <Highlighted line={line} />
          </span>
        ))}
        {code.partial !== null ? (
          <span className="lb-l lb-l--new">
            <Highlighted line={code.partial} />
            <span className="lb-cur" aria-hidden="true" />
          </span>
        ) : null}
      </code>
    </pre>
  );
}

function Highlighted({ line }: { line: string }) {
  return (
    <>
      {highlight(line).map((token, index) =>
        token.kind ? (
          <span key={index} className={`lb-t-${token.kind}`}>
            {token.text}
          </span>
        ) : (
          token.text
        ),
      )}
    </>
  );
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
  flip: boolean;
}

/**
 * The outline a design tool draws around what is under the pointer, with
 * the region's name and its size at a 1440 viewport. It follows a mouse,
 * shows what is being built while a build runs, and wanders on its own when
 * the builder is idle and motion is welcome. Decoration only: everything it
 * shows is also in the code pane.
 */
function Inspector({
  canvasRef,
  target,
  version,
  idle,
}: {
  canvasRef: RefObject<HTMLDivElement | null>;
  target: MiniatureRegion | null;
  version: string;
  idle: boolean;
}) {
  const [box, setBox] = useState<Box | null>(null);
  const [cross, setCross] = useState<{
    x: number;
    y: number;
    label: string;
  } | null>(null);
  const [wander, setWander] = useState<MiniatureRegion | null>(null);
  const pointerIn = useRef(false);

  const measure = useCallback(
    (element: Element | null) => {
      const canvas = canvasRef.current;
      const site = canvas?.querySelector('.ms');
      if (!canvas || !site || !element) {
        setBox(null);
        return;
      }
      const c = canvas.getBoundingClientRect();
      const r = element.getBoundingClientRect();
      const s = site.getBoundingClientRect();
      if (!s.width || !r.width) {
        setBox(null);
        return;
      }
      const scale = 1440 / s.width;
      const region = element.getAttribute('data-el');
      const name =
        region === 'Section' ? element.getAttribute('data-name') : region;
      setBox({
        left: r.left - c.left,
        top: r.top - c.top,
        width: r.width,
        height: r.height,
        label: `<${name}> ${Math.round(r.width * scale)}x${Math.round(r.height * scale)}`,
        flip: r.top - c.top < 44,
      });
    },
    [canvasRef],
  );

  const region = target ?? wander;
  useLayoutEffect(() => {
    if (pointerIn.current) return;
    const canvas = canvasRef.current;
    measure(
      region
        ? (canvas?.querySelector(`.ms [data-el="${region}"]`) ?? null)
        : null,
    );
  }, [canvasRef, measure, region, version]);

  useEffect(() => {
    const clear = () => setBox(null);
    window.addEventListener('resize', clear);
    return () => window.removeEventListener('resize', clear);
  }, []);

  // Idle wandering, for a reader who has not asked for less motion.
  useEffect(() => {
    if (!idle || target) return;
    if (prefersReducedMotion()) return;
    const order: MiniatureRegion[] = [
      'Hero',
      'HeroCopy',
      'HeroArt',
      'Section',
      'Nav',
    ];
    let index = 0;
    const timer = window.setInterval(() => {
      if (pointerIn.current) return;
      setWander(order[index % order.length]!);
      index++;
    }, 1900);
    return () => window.clearInterval(timer);
  }, [idle, target]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      pointerIn.current = true;
      const c = canvas.getBoundingClientRect();
      const site = canvas.querySelector('.ms')?.getBoundingClientRect();
      const scale = site?.width ? 1440 / site.width : 1;
      const x = event.clientX - c.left;
      const y = event.clientY - c.top;
      setCross({
        x,
        y,
        label: `x ${Math.max(0, Math.round((event.clientX - (site?.left ?? 0)) * scale))}  y ${Math.max(0, Math.round((event.clientY - (site?.top ?? 0)) * scale))}`,
      });
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      measure(hit?.closest('.ms [data-el]') ?? null);
    };
    const leave = () => {
      pointerIn.current = false;
      setCross(null);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerleave', leave);
    return () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerleave', leave);
    };
  }, [canvasRef, measure]);

  return (
    <div className="lb-insp" aria-hidden="true">
      {cross ? (
        <>
          <div className="lb-insp__x" style={{ top: cross.y }} />
          <div className="lb-insp__y" style={{ left: cross.x }} />
          <div
            className="lb-insp__xy"
            style={{ left: cross.x + 8, top: Math.max(cross.y - 20, 20) }}
          >
            {cross.label}
          </div>
        </>
      ) : null}
      <div
        className={`lb-insp__box${box ? ' is-on' : ''}${box?.flip ? ' is-flip' : ''}`}
        style={
          box
            ? {
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
              }
            : undefined
        }
      >
        <i />
        <i />
        <i />
        <i />
        <span className="lb-insp__tag">{box?.label ?? ''}</span>
      </div>
    </div>
  );
}

function LinkIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <rect x="2" y="5" width="8" height="6" rx="1.5" />
      <path
        d="M4 5V3.8a2 2 0 0 1 4 0V5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}
