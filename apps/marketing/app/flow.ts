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
    body: 'Plain words, with specifics: what it is, who uses it, what it has to do. Style, Reference, Media and Preferences sit in a row under the message. The agent may ask a question or two, then builds.',
    doc: { href: '/docs/getting-started', label: 'Getting started' },
  },
  {
    id: 'directions',
    short: 'Directions',
    title: 'Pick a direction',
    body: 'Before the first build, ask for three sketches that differ in look, not just colour, for about a tenth of a build, and choose one. Or skip the sketches and name one of the style presets.',
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
    title: 'It builds the project',
    body: 'A run writes a project in React and TypeScript on Vite, and there is no accept step: it becomes the project. A draft of the page shows while the first build runs, and the code is shown as soon as it exists, badged while it is checked.',
    doc: { href: '/docs/getting-started', label: 'Getting started' },
  },
  {
    id: 'checks',
    short: 'Checks',
    title: 'It checks its own design',
    body: 'The files are read against the spec: the named colours, the display face, the breakpoints, alt text, a reduced-motion rule. Only an error the checker is sure of buys a repair, which is another paid call, and a repair patches only the files at fault.',
    doc: { href: '/features#checks', label: 'Design checks' },
  },
  {
    id: 'preview',
    short: 'Preview',
    title: 'Look at it privately',
    body: 'Run live preview installs the project in a private sandbox and starts a real dev server, which takes each new version in place. A share link lets someone else see it until you revoke it. None of this makes anything public.',
    doc: { href: '/docs/running-your-project', label: 'Running and sharing' },
  },
  {
    id: 'ship',
    short: 'Publish',
    title: 'Publish it, or take the code',
    body: 'Under Ship: Export downloads the checkpoint as an archive. Push to GitHub opens a pull request in the project’s own repository. Publish puts it on the web at a name you choose, in two presses, and takes it down the same way.',
    doc: { href: '/docs/taking-your-code', label: 'Taking your code with you' },
  },
];
