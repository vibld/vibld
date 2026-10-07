import { useEffect, useId, useRef, useState } from 'react';
import type { StyleColorEdits } from '@vibld/ai/style-gallery';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import { MAX_REFERENCE_URL_CHARS } from '@vibld/ai/limits';
import { STYLE_PRESETS } from '@vibld/ai/style-presets';
import type { StylePresetId } from '@vibld/ai/style-presets';
import type { StyleDna } from '@vibld/ai/style-dna';
import type { BuilderState } from '../generation/session.ts';
import type { PlanMode } from '../generation/plan-builder.ts';
import { KnowledgePanel } from './KnowledgePanel.tsx';
import { MediaLibrary } from './MediaLibrary.tsx';
import { ModelPicker } from './ModelPicker.tsx';
import { buildEstimateText } from '../generation/build-estimate.ts';
import { StyleDnaPanel } from './StyleDnaPanel.tsx';
import { ScreenPicker } from './ScreenPicker.tsx';
import { StyleGalleryPicker } from './StyleGalleryPicker.tsx';
import { TemplatePicker } from './TemplatePicker.tsx';
import { StylePicker } from './StylePicker.tsx';
import {
  MAX_BRIEF_CHARS,
  briefStorage,
  takeTemplateBrief,
} from '../templates/template-brief.ts';

/** A short label on the chip, and the whole request it puts in the box. */
const EXAMPLES = [
  {
    label: 'Cybersecurity SaaS landing page',
    prompt:
      'A landing page for a cybersecurity SaaS with pricing, FAQ and a contact form',
  },
  {
    label: 'Coffee roaster website',
    prompt:
      'A marketing site for an indie coffee roaster with features and testimonials',
  },
  {
    label: 'Photographer portfolio',
    prompt:
      'A portfolio for a wedding photographer with a gallery, packages and a booking form',
  },
];

type OptionId =
  | 'style'
  | 'gallery'
  | 'reference'
  | 'templates'
  | 'screens'
  | 'media'
  | 'preferences';

export interface PromptPanelProps {
  state: BuilderState;
  onSubmit: (
    prompt: string,
    mode: PlanMode,
    style: StylePresetId | null,
    referenceUrl: string | null,
  ) => void;
  /**
   * Ask for three directions instead of building (internal issue 185). Carries the same
   * prompt and style the build would have used, because it is the same
   * request asked a smaller way.
   */
  onExplore: (
    prompt: string,
    style: StylePresetId | null,
    referenceUrl: string | null,
  ) => void;
  onReset: () => void;
  onCancel: () => void;
  /**
   * Stop a look that is running (internal PR 189 review). Its own handler, because it
   * stops a different run from `onCancel` and leaves the build untouched.
   */
  onCancelExplore: () => void;
  onModelChange: (model: string | null) => void;
  /**
   * Standing instructions and visual preferences. Optional so the composer
   * can be mounted on its own; where they are absent their options are not
   * offered.
   */
  knowledge?: string;
  onKnowledgeChange?: (value: string) => void;
  styleDna?: StyleDna;
  onStyleDnaChange?: (value: StyleDna) => void;
  /**
   * The style preset and reference page, when something above the composer
   * holds them. The session does, since a project remembers both
   * (docs/decisions.md, 2026-09-28, projects) and has to be able to put
   * them back when it is opened. Without these the composer keeps them
   * itself, as it always did.
   */
  style?: StylePresetId | null;
  onStyleChange?: (style: StylePresetId | null) => void;
  referenceUrl?: string;
  onReferenceUrlChange?: (value: string) => void;
  /**
   * The style gallery style, by id (D144). Offered only where something
   * above holds it, since it is a project setting.
   */
  galleryStyle?: string | null;
  onGalleryStyleChange?: (id: string | null) => void;
  /** The gallery style's color edits (D147). */
  galleryColors?: StyleColorEdits | null;
  onGalleryColorsChange?: (edits: StyleColorEdits | null) => void;
  /**
   * What the button beside the label says. "Start over" discards the
   * conversation in place; where the conversation is a saved project, the
   * same place offers a new project instead, which leaves this one intact.
   */
  resetLabel?: string;
}

/**
 * The composer: a message box, one row of options, and the send button.
 *
 * It used to be a form. Every option was on screen at once (reference URL,
 * media library, two model dropdowns with a sentence of pricing, twenty-three
 * style chips, a test checkbox), with project instructions and visual
 * preferences stacked above it, so the one field that matters most sat in
 * the middle of a column somebody had to scroll. Chris's decision D6
 * (2026-09-28): the message and the send button stay put, and each option
 * is a button in one row that opens its panel in place, with a line saying
 * what it changes about the result. The model sits beside Send, because
 * it is a choice about who answers rather than about the result. An option that is set says so on its
 * button, so nothing shapes a build out of sight.
 *
 * Panels are hidden rather than unmounted: what somebody typed into one
 * survives closing it, and the media library does not refetch on every
 * open.
 */
export function PromptPanel({
  state,
  onSubmit,
  onExplore,
  onReset,
  onCancel,
  onCancelExplore,
  onModelChange,
  knowledge,
  onKnowledgeChange,
  styleDna,
  onStyleDnaChange,
  style: heldStyle,
  onStyleChange,
  referenceUrl: heldReferenceUrl,
  onReferenceUrlChange,
  galleryStyle = null,
  onGalleryStyleChange,
  galleryColors = null,
  onGalleryColorsChange,
  resetLabel = 'Start over',
}: PromptPanelProps) {
  // A template's brief, when vibld.com sent one (D106): filled once, to be
  // read, edited or sent like anything typed.
  const [sentBrief] = useState(() => takeTemplateBrief(briefStorage()));
  const [prompt, setPrompt] = useState(sentBrief?.brief ?? '');
  // The screens chosen with it (D110), added once their text has loaded,
  // unless the message was changed first.
  useEffect(() => {
    if (!sentBrief || sentBrief.screens.length === 0) return;
    let live = true;
    import('@vibld/ai/screen-patterns').then(
      ({ screenSections }) => {
        const room = MAX_BRIEF_CHARS - sentBrief.brief.trimEnd().length - 2;
        const text = screenSections(sentBrief.screens, room);
        if (!live || !text) return;
        setPrompt((current) =>
          current === sentBrief.brief
            ? `${current.trimEnd()}\n\n${text}`
            : current,
        );
      },
      () => {
        // The brief is still there; the screens can be added from the
        // Screens option.
      },
    );
    return () => {
      live = false;
    };
  }, [sentBrief]);
  const [failNext, setFailNext] = useState(false);
  const [ownStyle, setOwnStyle] = useState<StylePresetId | null>(null);
  const [ownReferenceUrl, setOwnReferenceUrl] = useState('');
  // Held above when a handler is given, and here otherwise. One of the two,
  // never both, so there is no copy to fall out of step with the other.
  const style = onStyleChange ? (heldStyle ?? null) : ownStyle;
  const setStyle = onStyleChange ?? setOwnStyle;
  const referenceUrl = onReferenceUrlChange
    ? (heldReferenceUrl ?? '')
    : ownReferenceUrl;
  const setReferenceUrl = onReferenceUrlChange ?? setOwnReferenceUrl;
  const [open, setOpen] = useState<OptionId | null>(null);
  // Set when the browser refuses the form over the reference field while
  // its panel is closed, so the panel can open and then show why.
  const [revealReference, setRevealReference] = useState(false);
  const promptId = useId();
  // What a build on the chosen model is expected to cost (Chris,
  // 2026-10-05), only where a model answers: the fake costs nothing.
  const chosenModel =
    state.models.find((model) => model.id === state.model) ?? state.models[0];
  const estimate =
    state.generation === 'model'
      ? buildEstimateText(
          chosenModel?.buildEstimate,
          state.acceptedSnapshot === null,
        )
      : null;
  const failId = useId();
  const referenceId = useId();
  const panelId = useId();
  const referenceRef = useRef<HTMLInputElement | null>(null);
  // Opening a project holds the composer too: a message sent in that
  // moment would go to the project being left. So does restoring a
  // checkpoint, whose code a build sent meanwhile would not start from.
  const disabled =
    state.running ||
    state.exploring ||
    state.chatting ||
    state.opening ||
    state.restoring;
  // Once there is a conversation, the examples are noise: what to type next
  // comes from what was just built, not from a generic starting point.
  const started = state.transcript.length > 0;
  // "Force a validation failure" exists to exercise the failure path
  // against the deterministic provider. Against a real model it only
  // spends a run on a checkpoint designed to be rejected, so it is not
  // offered there.
  const testing = state.generation !== 'model';

  /**
   * Everything that belonged to the request that just started.
   *
   * One function because the rule is one rule, and it was written for one
   * path (internal PR 189 review). Choosing a direction submits through the session
   * rather than through this form, so the composer still held the original
   * request and its reference page while the label above it asked "What
   * should change?" -- and submitting that repeated the build and refetched
   * the reference.
   *
   * - The prompt, because this is a composer, not a field that holds the
   *   last thing submitted.
   * - The reference URL, which is scoped to the request it went with rather
   *   than being a standing preference the way `knowledge` is, so a later
   *   unrelated turn never refetches a page nobody meant it for.
   * - "Force a validation failure", which costs the most: left ticked it
   *   quietly spends every later run on a checkpoint designed to be
   *   rejected.
   */
  // The message and the test switch belong to one turn. The reference page
  // does not: a project remembers it, and every build reads it until it is
  // cleared (D93, Chris, 2026-09-30).
  function clearPerRequestFields() {
    setPrompt('');
    setFailNext(false);
  }

  // Fires for a run this form did not start, which is the case that was
  // missing: `chooseMockup` goes straight to the session. Keyed on the run
  // id rather than on `running`, so a run that finishes before this renders
  // still clears, and so a re-render during a run does not wipe what
  // somebody has begun typing for the turn after it.
  useEffect(() => {
    if (state.runId === null) return;
    clearPerRequestFields();
    setOpen(null);
    // `clearPerRequestFields` only calls setters, which React guarantees are
    // stable; listing it would mean re-running on every render rather than
    // on every run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.runId]);

  // The browser cannot show why a field is invalid while the field is
  // hidden, so the refusal opened the panel; now that it is on screen, say
  // why, in the field's own words.
  useEffect(() => {
    if (!revealReference || open !== 'reference') return;
    setRevealReference(false);
    referenceRef.current?.reportValidity();
  }, [revealReference, open]);

  function trimmedReference(): string | null {
    const trimmed = referenceUrl.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || prompt.trim().length === 0) return;
    onSubmit(
      prompt,
      failNext ? 'fail-validation' : 'succeed',
      style,
      trimmedReference(),
    );
    // Here as well as in the effect above, deliberately: the effect cannot
    // run until the session has reported a new run, and a composer that
    // still showed the sent message for that round trip would read as a
    // click that did nothing.
    clearPerRequestFields();
    setOpen(null);
  }

  // Enter sends, Shift+Enter is a new line: what every chat box does. Not
  // while an input method is composing, where Enter confirms a character.
  function onPromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  const chosenStyle = STYLE_PRESETS.find((preset) => preset.id === style);
  const referenceHost = (() => {
    const value = trimmedReference();
    if (!value) return null;
    try {
      return new URL(value).hostname;
    } catch {
      return value;
    }
  })();
  const lookCount = styleDna ? Object.keys(styleDna).length : 0;
  const instructionsSet = (knowledge ?? '').trim().length > 0;

  const options: {
    id: OptionId;
    label: string;
    value: string | null;
    about: string;
    body: ReactNode;
  }[] = [
    {
      id: 'style',
      label: 'Style',
      value: chosenStyle?.name ?? null,
      about:
        'Sets the overall look. A treatment is a surface finish; a complete system also brings its own colors and fonts.',
      body: (
        <StylePicker
          value={style}
          onChange={setStyle}
          disabled={disabled}
          prompt={prompt}
        />
      ),
    },
    ...(onGalleryStyleChange
      ? [
          {
            id: 'gallery' as const,
            label: 'Gallery',
            value: galleryStyle ? 'set' : null,
            about:
              'Builds in one complete style: its colors, fonts, type scale, shapes and guardrails. Choosing one replaces the style above.',
            body: (
              <StyleGalleryPicker
                active={open === 'gallery'}
                value={galleryStyle}
                onChange={onGalleryStyleChange}
                colors={galleryColors}
                {...(onGalleryColorsChange
                  ? { onColorsChange: onGalleryColorsChange }
                  : {})}
                disabled={disabled}
              />
            ),
          },
        ]
      : []),
    {
      id: 'reference',
      label: 'Reference',
      value: referenceHost,
      about:
        "vibld reads this page's text, colors, fonts and spacing and uses them as a starting point. It adapts rather than copies. This project remembers it: every build reads it until you clear the field.",
      body: (
        <>
          <label className="option-panel__label" htmlFor={referenceId}>
            Reference URL
          </label>
          <input
            id={referenceId}
            ref={referenceRef}
            type="url"
            className="prompt__input"
            // The same bound the Worker's guard enforces, declared where the
            // value is entered (internal PR 189 review).
            maxLength={MAX_REFERENCE_URL_CHARS}
            value={referenceUrl}
            placeholder="https://example.com"
            onChange={(event) => setReferenceUrl(event.target.value)}
            onInvalid={() => {
              if (open !== 'reference') {
                setOpen('reference');
                setRevealReference(true);
              }
            }}
            disabled={disabled}
          />
        </>
      ),
    },
    {
      id: 'templates',
      label: 'Templates',
      value: null,
      about:
        "A design from vibld's template catalog as a starting point. Its brief is added to your message, to edit or send.",
      body: (
        <TemplatePicker
          active={open === 'templates'}
          disabled={disabled}
          message={prompt}
          room={MAX_BRIEF_CHARS - prompt.trimEnd().length}
          onAdd={(text) =>
            setPrompt((current) =>
              current.trim().length > 0
                ? `${current.trimEnd()}\n\n${text}`
                : text,
            )
          }
        />
      ),
    },
    {
      id: 'screens',
      label: 'Screens',
      value: null,
      about:
        'App screens such as a dashboard, settings or an empty state, each with its states and guardrails. They are added to your message, built in your design.',
      body: (
        <ScreenPicker
          active={open === 'screens'}
          disabled={disabled}
          room={MAX_BRIEF_CHARS - prompt.trimEnd().length}
          onAdd={(text) =>
            setPrompt((current) =>
              current.trim().length > 0
                ? `${current.trimEnd()}\n\n${text}`
                : text,
            )
          }
        />
      ),
    },
  ];
  if (state.generation === 'model') {
    options.push({
      id: 'media',
      label: 'Media',
      value: null,
      about:
        'Images and video you upload here are placed in the site wherever your request calls for them.',
      body: <MediaLibrary disabled={disabled} />,
    });
  }
  // Instructions (free text) and look (closed-set choices) are one option:
  // both are standing preferences applied to every build, and as two
  // buttons they pushed the row onto a second line for no gain.
  if (onKnowledgeChange || onStyleDnaChange) {
    const setCount = (instructionsSet ? 1 : 0) + lookCount;
    options.push({
      id: 'preferences',
      label: 'Preferences',
      value: setCount > 0 ? String(setCount) : null,
      about:
        'Applied to every message, so you only say it once. What you type in a message wins.',
      body: (
        <>
          {onKnowledgeChange ? (
            <KnowledgePanel
              knowledge={knowledge ?? ''}
              disabled={state.running}
              onChange={onKnowledgeChange}
            />
          ) : null}
          {onStyleDnaChange ? (
            <StyleDnaPanel
              styleDna={styleDna ?? {}}
              disabled={state.running}
              onChange={onStyleDnaChange}
            />
          ) : null}
        </>
      ),
    });
  }

  return (
    <form className="prompt" onSubmit={handleSubmit}>
      <div className="prompt__head">
        <label className="prompt__label" htmlFor={promptId}>
          {started ? 'Message vibld' : 'Describe your application'}
        </label>
        {started || state.running ? (
          <button
            type="button"
            className="linkbutton"
            onClick={onReset}
            disabled={!started && !state.running}
          >
            {resetLabel}
          </button>
        ) : null}
      </div>

      {started ? null : (
        <div className="prompt__examples" aria-label="Examples">
          {EXAMPLES.map((example) => (
            <button
              key={example.label}
              type="button"
              className="chip"
              title={example.prompt}
              onClick={() => setPrompt(example.prompt)}
              disabled={disabled}
            >
              {example.label}
            </button>
          ))}
        </div>
      )}

      <textarea
        id={promptId}
        className="prompt__input prompt__message"
        value={prompt}
        rows={started ? 2 : 3}
        placeholder={
          started
            ? 'Ask a question, or describe a change…'
            : 'A landing page for…'
        }
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={onPromptKeyDown}
        disabled={disabled}
      />

      {options.map((option) => (
        <div
          key={option.id}
          id={`${panelId}-${option.id}`}
          className="option-panel"
          role="group"
          aria-label={option.label}
          hidden={open !== option.id}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(null);
          }}
        >
          <p className="option-panel__about">{option.about}</p>
          {option.body}
        </div>
      ))}

      {testing ? (
        <div className="prompt__row">
          <input
            id={failId}
            type="checkbox"
            checked={failNext}
            onChange={(event) => setFailNext(event.target.checked)}
            disabled={disabled}
          />
          <label htmlFor={failId} className="prompt__checkbox-label">
            Force a validation failure (staged file escapes the project root)
          </label>
        </div>
      ) : null}

      <div className="prompt__toolbar">
        <div className="options" role="group" aria-label="Options">
          {options.map((option) => {
            const isOpen = open === option.id;
            return (
              <button
                key={option.id}
                type="button"
                className={`option${isOpen ? ' option--open' : ''}${option.value ? ' option--set' : ''}`}
                aria-expanded={isOpen}
                aria-controls={`${panelId}-${option.id}`}
                onClick={() => setOpen(isOpen ? null : option.id)}
              >
                {option.label}
                {option.value ? (
                  <span className="option__value">{option.value}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="prompt__send">
          <ModelPicker
            models={state.models}
            note={state.modelsNote}
            value={state.model}
            onChange={onModelChange}
            disabled={disabled}
          />
          <div className="prompt__actions">
            {/*
            Offered until a project exists (internal issue 185), and only where there is
            a model to ask: `explore` always calls the real `/api/mockups`,
            which the fake mode cannot answer. `acceptedSnapshot` is what
            answers "is there a project", so it is the thing to ask: a
            failed first build still appends a transcript turn.
          */}
            {state.acceptedSnapshot === null && state.generation === 'model' ? (
              <button
                type="button"
                className="button"
                onClick={(event) => {
                  // The browser's own check, not a second URL parser (internal PR 189
                  // review): this is a `button`, so clicking it skips the
                  // native validation `Generate` gets, and a malformed
                  // reference would be paid for and then refused.
                  const form = event.currentTarget.form;
                  if (form && !form.checkValidity()) {
                    setOpen('reference');
                    setRevealReference(true);
                    return;
                  }
                  onExplore(prompt, style, trimmedReference());
                }}
                disabled={disabled || prompt.trim().length === 0}
                title="Three quick sketches to choose from, for about a tenth of a build"
              >
                {state.exploring ? 'Sketching…' : 'Show me three directions'}
              </button>
            ) : null}
            {/*
            A generation can run for a minute or more, and a look about a
            minute; both are billed. Without these the only way out is to
            close the tab, and the run keeps spending either way.
          */}
            {state.running || state.chatting ? (
              <button type="button" className="button" onClick={onCancel}>
                Cancel
              </button>
            ) : null}
            {state.exploring ? (
              <button
                type="button"
                className="button"
                onClick={onCancelExplore}
              >
                Cancel
              </button>
            ) : null}
            {estimate ? (
              <span className="prompt__estimate" title={estimate.title}>
                {estimate.text}
              </span>
            ) : null}
            <button
              type="submit"
              className="button button--primary"
              disabled={disabled || prompt.trim().length === 0}
            >
              {state.running
                ? 'Generating…'
                : state.chatting
                  ? 'Thinking…'
                  : started
                    ? 'Send'
                    : 'Generate'}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
