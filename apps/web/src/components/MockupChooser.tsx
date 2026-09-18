import type { ParsedMockup } from '@vibld/ai/mockup-schema';

/**
 * The three directions, to look at and choose between (#185).
 *
 * Every mockup is model output, so every one is untrusted. Each renders in
 * an iframe with `srcDoc` and an empty `sandbox`, which is the same thing
 * `PreviewPanel` already does for the local mock and describes as "a fully
 * restricted frame": no scripts, no same-origin access, no forms, no
 * navigation. The mockup prompt forbids scripts outright, and this is what
 * makes that a guarantee rather than a request -- a `<script>` that slipped
 * through does not run.
 *
 * Never `dangerouslySetInnerHTML`. Putting this markup in the shell's own
 * document would give model output the shell's origin, its Clerk session
 * and its DOM, which is the one thing ADR-0004 exists to prevent.
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
            {/*
              `sandbox=""` and not merely `sandbox`: the empty value is the
              deny-everything list. Dropping the attribute, or adding
              `allow-scripts` with `allow-same-origin`, would hand model
              output this document's origin.
            */}
            <iframe
              className="mockups__frame"
              title={`Mockup: ${mockup.label}`}
              srcDoc={mockup.html}
              sandbox=""
              loading="lazy"
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
