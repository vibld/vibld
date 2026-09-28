import type { ParsedMockup } from '@vibld/ai/mockup-schema';
import { MockupFrame } from './MockupFrame.tsx';

/**
 * The three directions, to look at and choose between (internal issue 185).
 *
 * Every mockup is model output, so every one is untrusted. Each renders in
 * `MockupFrame`, which says what makes that safe: a fully restricted frame
 * and the content policy `mockupFrameDocument` adds, never the shell's own
 * document.
 *
 * Renders what arrived rather than assuming three. The schema accepts two
 * to four on purpose (`mockup-schema.ts`): a run is already paid for by the
 * time it parses, and two usable directions are still a choice.
 */
export function MockupChooser({
  mockups,
  onChoose,
  onDiscard,
  disabled = false,
}: {
  mockups: ParsedMockup[];
  onChoose: (mockup: ParsedMockup) => void;
  onDiscard: () => void;
  disabled?: boolean;
}) {
  if (mockups.length === 0) return null;

  return (
    <section className="mockups" aria-label="Directions to choose from">
      <div className="mockups__head">
        <div>
          <h2 className="mockups__title">Pick a direction</h2>
          <p className="pane-note">
            Sketches, not the finished thing. The one you pick is what gets
            built.
          </p>
        </div>
        <button
          type="button"
          className="linkbutton"
          onClick={onDiscard}
          disabled={disabled}
        >
          None of these
        </button>
      </div>

      <ul className="mockups__grid">
        {mockups.map((mockup, index) => (
          <li className="mockups__tile" key={`${mockup.label}-${index}`}>
            <MockupFrame
              className="mockups__frame"
              title={`Mockup: ${mockup.label}`}
              html={mockup.html}
              lazy
            />
            <div className="mockups__meta">
              <h3 className="mockups__label">{mockup.label}</h3>
              <p className="pane-note">{mockup.rationale}</p>
              <button
                type="button"
                className="button"
                onClick={() => onChoose(mockup)}
                disabled={disabled}
              >
                Build this one
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
