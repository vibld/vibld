/**
 * Diagram craft, retrieved on demand -- the same closed-set keyword match the
 * rest of this package uses, applied to the one thing a generated page often
 * needs and almost always gets wrong.
 *
 * A request that says "show how the system fits together" today gets one of
 * three bad answers: a stack of styled divs pretending to be a diagram, an
 * `<img>` pointing at a file that does not exist, or a chart library added
 * against STACK. Inline SVG in a React component is the answer that fits the
 * stack exactly, and the reason it is not already the answer is that the
 * craft is unusually unforgiving: a diagram is either legible or it is
 * decoration, and the difference is a handful of specific rules about where
 * lines go.
 *
 * Adapted from cathrynlavery/diagram-design (MIT License,
 * https://github.com/cathrynlavery/diagram-design). Its own deliverable is a
 * standalone HTML file sized to a fixed viewBox, produced through an
 * interactive pipeline with a style-guide gate, a confirm-before-drawing
 * step and a Python geometry verifier. None of that transfers to one-shot
 * generation of a React project, and none of it is ported. What is ported is
 * the part that is pure craft: its six connector rules, the elbow and hop
 * path formulae, and the layout grammar for the diagram types a product page
 * actually asks for.
 *
 * Two of its rules are deliberately left behind. It bans shadows outright
 * ("Shadows are out. Borders are in.") and caps corner radius at 6-10px.
 * Those are house style for its own output, and adopting them as general
 * rules would contradict the `claymorphism`, `neumorphism` and `depth`
 * presets this package ships. The diagram should look like the page it is
 * on, so these entries defer to the project's own tokens instead.
 *
 * Closed set, same security property as its siblings.
 */

export interface DiagramType {
  id: string;
  name: string;
  /** Lowercase words/phrases matched against the request text. */
  triggers: readonly string[];
  /** Appended to the request when this type matches. */
  guidance: string;
}

/**
 * The rules that hold for every diagram, prepended once when any type
 * matches. Kept separate from the per-type grammar so two matching types do
 * not repeat it, and so the connector rules cannot drift apart between
 * entries.
 */
export const DIAGRAM_CRAFT = `Draw it as inline SVG inside a React component, never as an <img> to a file
that does not exist and never with a charting library. Give the <svg> a
viewBox, width="100%", height="auto" and a max-width, so it scales instead
of overflowing. It needs role="img" and an aria-label saying what it shows,
plus a <title> as the first child; a diagram no screen reader can describe is
decoration. Use the project's own CSS custom properties for every colour
(fill="var(--card)", stroke="var(--border)", text fill="var(--foreground)"),
never hardcoded hex, or the diagram breaks the moment the palette changes.

Connectors are where diagrams fail, so these are not optional:
- Any connection between two boxes that do not share an x or y coordinate
  uses a rounded right-angle elbow, never a diagonal line. Two-bend form,
  with mid = (x1+x2)/2:
  M x1,y1 H mid-8 Q mid,y1 mid,y1+8 V y2-8 Q mid,y2 mid+8,y2 H x2
  Use a straight line only when the endpoints really do share an axis.
- When the destination sits clearly above or below the source, leave and
  enter through top/bottom edges with a single-bend L path, not the sides.
  A mainly-vertical arrow entering a side edge looks like it punctures the
  box rather than arriving at it.
- A label never sits on its line. Put an opaque mask rect behind the text in
  the surface colour, and leave a visible 6-10px gap between that rect and
  the stroke. Place it on a segment crossing open canvas, clear of every box.
- Two connectors never share an attach point. For N connectors on one edge of
  length L, attach point k sits at L*k/(N+1) from the leading corner, at
  least 12px apart, and parallel runs stay 12px apart along their whole
  length.
- Where two connectors must cross, hop the less important one:
  ... H cx-8 a 8,8 0 0,1 16,0 H x2
- A connector does not pass behind a box that is not its own endpoint.
  Reroute. If the geometry genuinely forbids it, dash that stroke
  (stroke-dasharray="4 3") so the reader can see the box is not an endpoint.

Define the arrowhead once in <defs> as a <marker> and reference it; do not
draw triangles by hand. Keep it to a dozen boxes at most: past that the
answer is two diagrams, not a smaller font.`;

export const DIAGRAM_TYPES: readonly DiagramType[] = [
  {
    id: 'architecture',
    name: 'Architecture or system diagram',
    triggers: [
      'architecture diagram',
      'system diagram',
      'how it works diagram',
      'infrastructure diagram',
      'system architecture',
    ],
    guidance:
      'Group boxes into labelled zones (client, service, data) drawn first as a soft-filled container behind them, so containment is read before connection. Flow runs one way, left-to-right or top-to-bottom, and every arrow agrees with that direction: a single backward arrow is what makes a diagram feel like a maze. Label each box with what it is, not what it is called internally. Put the technology on a second line at a smaller size if it matters, and leave it off if it does not.',
  },
  {
    id: 'flow',
    name: 'Flowchart or process diagram',
    triggers: [
      'flowchart',
      'flow chart',
      'process diagram',
      'decision tree',
      'user flow',
      'onboarding flow',
    ],
    guidance:
      'One start and one end, both visually distinct from the steps between them (a pill rather than a rectangle). A decision is a diamond with exactly two labelled exits, and the labels go on the connectors, not inside the diamond. Keep the happy path running straight down the centre so it can be read without tracing, and push exception branches to one side. If a branch rejoins, it rejoins on the main spine rather than into the middle of another step.',
  },
  {
    id: 'sequence',
    name: 'Sequence diagram',
    triggers: [
      'sequence diagram',
      'request flow',
      'api flow',
      'message flow',
      'handshake diagram',
    ],
    guidance:
      'Participants across the top, each with a vertical dashed lifeline dropping from it. Messages are horizontal arrows between lifelines, ordered strictly top to bottom, with the label above the line and a mask behind it. A response is a dashed arrow back; a call to self is a small square loop off the same lifeline. Shade the activation span on a lifeline while that participant is working, so the reader can see who holds the work at any point in time.',
  },
  {
    id: 'timeline',
    name: 'Timeline or roadmap',
    triggers: ['timeline', 'roadmap diagram', 'milestones', 'project phases'],
    guidance:
      'One axis line with evenly spaced markers, and labels alternating above and below it so long ones do not collide. Space markers by their real interval when the dates are real, and evenly when they are only ordered; do not mix the two, which quietly misrepresents the gaps. Mark the present moment distinctly if past and future are both shown. Dates go in one consistent format, on the same side as their label.',
  },
  {
    id: 'comparison',
    name: 'Quadrant or comparison matrix',
    triggers: [
      'quadrant',
      'comparison matrix',
      'positioning chart',
      '2x2',
      'feature matrix',
    ],
    guidance:
      'Both axes need named poles at each end, not just an axis title: a reader must be able to tell what "high" means without a caption. Place items by their actual position on both axes, and never crowd them into corners to make a point. Label each item beside its marker with a 6-10px gap, and where two items sit close, offset the labels rather than shrinking them. If one quadrant is meant to be the desirable one, say so in a caption rather than by colouring it and hoping.',
  },
];

export function selectDiagrams(
  promptText: string,
  limit = 1,
): readonly DiagramType[] {
  const lower = promptText.toLowerCase();
  const matched = DIAGRAM_TYPES.filter((type) =>
    type.triggers.some((trigger) => lower.includes(trigger)),
  );
  return matched.slice(0, limit);
}

export function findDiagramType(id: string): DiagramType | null {
  return DIAGRAM_TYPES.find((type) => type.id === id) ?? null;
}

/**
 * The craft rules plus the matched type's grammar, or null when the request
 * asks for no diagram. Capped at one type by default: unlike a page pattern,
 * two diagram grammars in one prompt describe two different pictures.
 */
export function diagramGuidance(promptText: string): string | null {
  const types = selectDiagrams(promptText);
  if (types.length === 0) return null;
  const sections = types
    .map((type) => `${type.name}: ${type.guidance}`)
    .join('\n\n');
  return `This request asks for a diagram. Where any of this conflicts with an instruction in the request above, follow the request.

${DIAGRAM_CRAFT}

${sections}`;
}
