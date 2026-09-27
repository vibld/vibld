/**
 * The flow from a request to a project you own, in the seven steps the home
 * page and /how-it-works both show.
 *
 * Each step names the guide it was checked against, and the claims in it are
 * that guide's, not the design's: the mockup this site was ported from said
 * "every build" sketches three directions, when sketching is something you
 * ask for; the step below says so.
 */

export interface FlowStep {
  id: string;
  /** The stepper's one-word label. */
  short: string;
  title: string;
  body: string;
  /** The guide this step is held to. */
  doc: { href: string; label: string };
}

export const FLOW: FlowStep[] = [
  {
    id: 'prompt',
    short: 'Prompt',
    title: 'Say what you want',
    body: 'Plain words, with specifics: what it is, who uses it, what it has to do. Knowledge holds standing instructions, Style DNA holds the visual direction, and a reference URL points at a page to start from.',
    doc: { href: '/docs/getting-started', label: 'Getting started' },
  },
  {
    id: 'directions',
    short: 'Directions',
    title: 'Pick a direction',
    body: 'Ask for three sketches that differ in look, not just colour, and choose one. Or skip the sketches and name one of the style presets.',
    doc: { href: '/styles', label: 'The style catalogue' },
  },
  {
    id: 'spec',
    short: 'Spec',
    title: 'It writes the spec down',
    body: 'The direction becomes DESIGN.md: the colours, type, breakpoints and motion the build has to honour, written into the project where you can read it.',
    doc: { href: '/features#checks', label: 'Design checks' },
  },
  {
    id: 'build',
    short: 'Build',
    title: 'It stages a checkpoint',
    body: 'A run produces a staged checkpoint: a plan and a set of files in React and TypeScript on Vite. Nothing downstream acts on staged files. Read them in the Code pane and accept them when they are right.',
    doc: { href: '/docs/getting-started', label: 'Getting started' },
  },
  {
    id: 'checks',
    short: 'Checks',
    title: 'It checks its own design',
    body: 'The files are read against the spec: the named colours, the display face, the breakpoints, alt text, a reduced-motion rule. Only an error the checker is sure of buys a repair, because a repair rewrites the project.',
    doc: { href: '/features#checks', label: 'Design checks' },
  },
  {
    id: 'preview',
    short: 'Preview',
    title: 'Look at it privately',
    body: 'The first preview is a picture of the plan that runs nothing. Run in sandbox installs the project and starts a real dev server, and a share link lets someone else see it until you revoke it. None of this makes anything public.',
    doc: { href: '/docs/running-your-project', label: 'Running and sharing' },
  },
  {
    id: 'ship',
    short: 'Publish',
    title: 'Publish it, or take the code',
    body: 'Export downloads the accepted checkpoint as an archive. Push to GitHub opens a pull request in a repository you connect. Publish puts it on the web at a name you choose, in two presses, and takes it down the same way.',
    doc: { href: '/docs/taking-your-code', label: 'Taking your code with you' },
  },
];
