/**
 * The public roadmap (/roadmap): what is being built, what comes next, what
 * is being considered and what has shipped (Chris, 2026-09-27).
 *
 * One list, and each item carries its own status, so moving an item between
 * groups is a change to one line rather than a cut from one array and a
 * paste into another. The ids are the keys votes are stored under
 * (worker/roadmap.ts), so an id is never renamed: a renamed id starts again
 * at zero votes and strands the old ones under a key nothing shows.
 *
 * The Worker imports this file to decide which ids may be voted on, so it
 * imports nothing itself. Anything here is bundled into the Worker as well
 * as the page.
 *
 * Every description is held to ROADMAP.md and to the code it describes: a
 * shipped item is something the product does today, and nothing else is
 * described as if it were.
 */

export type RoadmapStatus =
  'in-progress' | 'upcoming' | 'considering' | 'shipped';

export interface RoadmapGroup {
  status: RoadmapStatus;
  /** The eyebrow, and what the group is called anywhere else. */
  label: string;
  title: string;
  /** One sentence under the heading. */
  lead: string;
}

/** In the order the page draws them. */
export const ROADMAP_GROUPS: readonly RoadmapGroup[] = [
  {
    status: 'in-progress',
    label: 'In progress',
    title: 'Being built now',
    lead: 'Work that is under way today.',
  },
  {
    status: 'upcoming',
    label: 'Upcoming',
    title: 'Planned next',
    lead: 'Committed to and not scheduled: no dates, and no promised order.',
  },
  {
    status: 'considering',
    label: 'Considering',
    title: 'Being considered',
    lead: 'On the roadmap and not yet planned. Vote for the ones you want sooner.',
  },
  {
    status: 'shipped',
    label: 'Shipped',
    title: 'In the builder today',
    lead: 'Finished, so there is nothing left to vote on.',
  },
];

export interface RoadmapItem {
  /** Stable. Votes are stored under it; see the note at the top. */
  id: string;
  status: RoadmapStatus;
  title: string;
  /** One plain sentence. */
  description: string;
}

export const ROADMAP_ITEMS: readonly RoadmapItem[] = [
  {
    id: 'public-beta',
    status: 'in-progress',
    title: 'Public beta',
    description:
      'Opening the builder to anyone who signs up, rather than by invitation only.',
  },
  {
    id: 'component-stack',
    status: 'in-progress',
    title: 'Modern component stack',
    description:
      'Generated projects are written with Tailwind CSS v4, shadcn/ui components and Motion for animation.',
  },
  {
    id: 'checkpoint-history',
    status: 'upcoming',
    title: 'Checkpoint history and rollback',
    description:
      'A history that lists every accepted checkpoint and restores any one of them in a single step.',
  },
  {
    id: 'custom-domains',
    status: 'upcoming',
    title: 'Custom domains',
    description:
      'Publish a site on your own domain as well as its vibld-preview.dev address.',
  },
  {
    id: 'image-import',
    status: 'upcoming',
    title: 'Screenshot and image import',
    description:
      'Start from a mockup or a picture of a page, measured the way a reference URL already is.',
  },
  {
    id: 'figma-import',
    status: 'considering',
    title: 'Figma import',
    description:
      'Turn Figma frames, components and variables into pages, components and design tokens.',
  },
  {
    id: 'github-import',
    status: 'considering',
    title: 'GitHub repository import',
    description:
      'Start from a repository you already have on GitHub instead of from a sentence.',
  },
  {
    id: 'app-auth',
    status: 'considering',
    title: 'Authentication for your app’s users',
    description:
      'Sign-in for the people who use the app you build, in code you can export like the rest.',
  },
  {
    id: 'forms-email',
    status: 'considering',
    title: 'Forms and email capture',
    description:
      'Forms and email sign-ups that work without you setting up a backend first.',
  },
  {
    id: 'app-payments',
    status: 'considering',
    title: 'Payments in your app',
    description:
      'Take payments in the app you build, starting with Stripe Checkout.',
  },
  {
    id: 'editable-content',
    status: 'considering',
    title: 'Blog and editable content',
    description:
      'Content such as a blog that someone who does not write code can edit.',
  },
  {
    id: 'own-model-key',
    status: 'considering',
    title: 'Bring your own model key',
    description:
      'Use your own model provider’s API key, for cost control and for self-hosted copies.',
  },
  {
    id: 'preview-comments',
    status: 'considering',
    title: 'Comments on shared previews',
    description:
      'Comment on a shared preview, as the first step toward working as a team.',
  },
  {
    id: 'cli-sync',
    status: 'considering',
    title: 'Command-line sync',
    description:
      'A command-line tool that pulls a project into your own editor and pushes your changes back as a checkpoint.',
  },
  {
    id: 'sandbox-previews',
    status: 'shipped',
    title: 'Sandbox previews with share links',
    description:
      'Run a real installed copy of your project in a sandbox, and share it with a link you can revoke.',
  },
  {
    id: 'one-step-publishing',
    status: 'shipped',
    title: 'One-step publishing',
    description:
      'Name the site and press Publish to put the built project on a vibld-preview.dev address, and take it down the same way.',
  },
  {
    id: 'github-pull-requests',
    status: 'shipped',
    title: 'GitHub pull requests',
    description:
      'Push a checkpoint and it opens a pull request on a vibld/ branch in the project’s own repository, one vibld creates or one you pick.',
  },
  {
    id: 'style-presets',
    status: 'shipped',
    // test/roadmap.test.ts holds this number to the builder's own list.
    title: '20+ style presets',
    description:
      'Choose a visual direction from the builder’s presets, each a full colour system or a surface treatment.',
  },
  {
    id: 'reference-url',
    status: 'shipped',
    title: 'Build from a reference URL',
    description:
      'Give it a page to start from, and vibld reads its text, colours, fonts and spacing and adapts them rather than copying.',
  },
  {
    id: 'projects',
    status: 'shipped',
    title: 'Projects',
    description:
      'Every project keeps its code, its conversation and its settings, and can be renamed, duplicated, archived or deleted.',
  },
  {
    id: 'share-and-remix',
    status: 'shipped',
    title: 'Project links and remix',
    description:
      'Share a project by link, read-only, and let somebody signed in remix it into a project of their own.',
  },
  {
    id: 'chat',
    status: 'shipped',
    title: 'Chat before building',
    description:
      'The agent answers a question in words or builds, and may ask one or two questions before the first build.',
  },
  {
    id: 'draft-preview',
    status: 'shipped',
    title: 'Draft preview',
    description:
      'A draft of the page fills the preview while the first build runs, and the code shows, badged, while it is checked.',
  },
  {
    id: 'media-library',
    status: 'shipped',
    title: 'Media uploads',
    description:
      'Upload images and video once and a build places them where the request calls for them.',
  },
  {
    id: 'style-moods',
    status: 'shipped',
    title: 'Style moods and suggestions',
    description:
      'Narrow the styles by mood, and see the ones your request’s own words suggest.',
  },
  {
    id: 'animated-backgrounds',
    status: 'shipped',
    title: 'Animated backgrounds',
    description:
      'Four moving backgrounds drawn in code from the project’s colours, used when a request asks for one.',
  },
  {
    // Shipped as a gallery on vibld.com (internal PR 323, D100); picking a design inside
    // the builder is not built, so the description does not claim it.
    id: 'template-gallery',
    status: 'shipped',
    title: 'Template gallery',
    description:
      'Browse designs by use case at vibld.com/templates, each with its palette, its type and a build prompt to copy into the builder.',
  },
  {
    id: 'build-and-repair',
    status: 'shipped',
    title: 'Build-and-repair reliability',
    description:
      'Every generated project is installed and built, and a build that fails on its own code gets one repair turn that is sent the exact error.',
  },
];

/** Shipped work is done, so there is nothing left for a vote to say. */
export function isVotable(item: RoadmapItem): boolean {
  return item.status !== 'shipped';
}

export function itemsIn(status: RoadmapStatus): RoadmapItem[] {
  return ROADMAP_ITEMS.filter((item) => item.status === status);
}

export function roadmapItem(id: string): RoadmapItem | undefined {
  return ROADMAP_ITEMS.find((item) => item.id === id);
}

/** Every id a vote may be cast for, in page order. */
export const VOTABLE_IDS: readonly string[] = ROADMAP_ITEMS.filter(
  isVotable,
).map((item) => item.id);
