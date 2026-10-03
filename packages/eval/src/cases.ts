import type { GenerationPlan, ProjectFile } from '@vibld/core';
import type { StylePresetId } from '@vibld/ai/style-presets';
import { tokenCss, withScaffold } from '@vibld/ai';

/**
 * The versioned prompt set.
 *
 * Versioned because a score is meaningless without knowing what was asked.
 * Changing a prompt, adding one, or changing what counts as success changes
 * the number, so `PROMPT_SET_VERSION` moves with it and every report carries
 * it. Comparing runs across versions is comparing different exams.
 */
export const PROMPT_SET_VERSION = '1.9.0';

export interface EvalCase {
  id: string;
  prompt: string;
  /**
   * The style preset the run is asked for, as a user picks one from the
   * chips. Each case has a different one (ADR-0014): with none, every case
   * converged on the same look, which is not what a real run looks like and
   * made the examples catalogue read as one site nine times.
   */
  style?: StylePresetId;
  /** What a correct result must contain, beyond building at all. */
  expects: {
    /** Paths the accepted project must include. */
    files: string[];
    /**
     * Text that must appear in the project's code: every file except
     * Markdown, with comments removed. A README that repeats the brief, or
     * a comment that does, is not the project doing what was asked.
     *
     * An entry that is a list is one expectation with several wordings, any
     * one of which meets it. For a claim a page can make in more than one
     * way, a single word fails the page that made the claim in other words,
     * and that is the eval measuring its own vocabulary rather than the
     * model's work.
     */
    content: Expectation[];
  };
}

/** One thing the project must say, in one wording or any of several. */
export type Expectation = string | readonly string[];

export const CASES: EvalCase[] = [
  {
    id: 'coffee-roaster',
    style: 'warmPaper',
    prompt:
      'A marketing site for an indie coffee roaster with features and testimonials',
    expects: {
      files: ['package.json', 'README.md', 'index.html'],
      content: ['coffee'],
    },
  },
  {
    id: 'security-saas',
    style: 'acidDark',
    prompt:
      'A landing page for a cybersecurity SaaS with pricing, FAQ and a contact form',
    expects: {
      files: ['package.json', 'README.md', 'index.html'],
      content: ['pricing'],
    },
  },
  {
    id: 'dental-practice',
    style: 'organic',
    prompt:
      'A site for a dental practice with opening hours, services and directions',
    expects: {
      files: ['package.json', 'README.md', 'index.html'],
      content: ['dental'],
    },
  },
  {
    id: 'freelance-portfolio',
    style: 'editorial',
    prompt:
      'A portfolio for a freelance illustrator with a gallery and a short bio',
    expects: {
      files: ['package.json', 'README.md', 'index.html'],
      content: ['portfolio'],
    },
  },
  {
    // The one case whose subject we can actually judge. The other five are
    // plausible briefs nobody can grade beyond "does it mention coffee": the
    // site this one describes is live at vibld.com, so its output can be held
    // against a real page with real copy rather than against a guess. It is
    // deliberately a brief, not a design: what the page must say and do, with
    // every visual decision left to the model, because the design is the
    // thing being measured.
    id: 'vibld-marketing',
    style: 'aiNative',
    prompt: [
      'A marketing home page for Vibld, an AI application builder that is not',
      'launched yet and is collecting a waitlist. The tagline is',
      '"Vibe. Build. Ship."',
      'The promise to make clearly: a conversation turns into a working',
      'project, and what you get at the end is a conventional, portable',
      'codebase you can read and take with you, never a proprietary format',
      'that only runs inside the product. No lock-in and no required runtime.',
      'The core is open source under Apache-2.0.',
      'Include a hero with the tagline and that promise, an email waitlist',
      'form, a sign-in link for people who already have an account, a link to',
      'the GitHub repository, and an illustration of how it works (what you',
      'say, the code it writes, what you get back). Label that illustration as',
      'an illustration rather than a screenshot, because no public build',
      'exists to screenshot yet, and saying otherwise would be a lie.',
    ].join(' '),
    expects: {
      // DESIGN.md and src/styles.css are named here and in no other case on
      // purpose. This case exists to produce a design worth porting, and the
      // tokens are the portable part of it: a run that renders something
      // handsome but records none of its decisions has not delivered the
      // thing this case is for.
      files: [
        'package.json',
        'README.md',
        'index.html',
        'DESIGN.md',
        'src/styles.css',
      ],
      // Portability is the claim the whole page exists to make. A generated
      // page that sells an AI builder without it has missed the brief, not
      // the styling.
      //
      // Any of these wordings makes it. Until 1.8.0 this was the one word
      // "portable", and in the 2026-09-27 bakeoff every model lost a run to
      // a page that made the claim in other words ("no lock-in", "take it
      // with you"). Each wording still has to mean the claim: a bare
      // "export" is not here because every component file says `export`,
      // and a bare "lock in" is not here because Tailwind's `block inset-0`
      // contains it. Both would pass a page that never made the claim.
      content: [
        'Vibld',
        'waitlist',
        [
          'portable',
          'portability',
          'lock-in',
          'locked in',
          'take it with you',
          'take with you',
          'take your code',
          'take the code',
          'walk away with',
          'yours to keep',
          'export your code',
          'export your project',
          'export the code',
          'proprietary format',
        ],
      ],
    },
  },
  // The three apps below exist for the examples catalogue on vibld.com
  // (/examples). Every other case is a site that tells; these are apps that
  // do something, which is the other half of what people build. Each one
  // keeps its data in the browser and must say so, the same honesty the
  // first acceptance scenario asks of a form without a backend.
  {
    id: 'pottery-booking',
    style: 'claymorphism',
    prompt:
      'A booking app for a weekend pottery studio. Visitors pick a class, choose an open two-hour slot from a week view, enter their name and email, and see a confirmation they can cancel. Slots that are already booked show as taken. There is no backend, so bookings are kept in the browser, and the app says so plainly.',
    expects: {
      files: ['package.json', 'README.md', 'index.html'],
      // What the brief asks the app to do, not only what it is called: a
      // page that merely describes a booking app mentions "booking" too.
      // "browser" is the disclosure. Whether it really saves is checked by
      // reloading it in a browser (internal PR 72): read from the source, that took
      // five review rounds and was still wrong in both directions.
      content: ['booking', 'slot', 'cancel', 'browser'],
    },
  },
  {
    id: 'budget-tracker',
    style: 'bentoGrid',
    prompt:
      "A personal budget tracker. Add income and expenses with an amount, a category and a date; see the month's balance and a breakdown by category; switch between months; and export the month as CSV. Everything is stored in the browser, and the app says so plainly.",
    expects: {
      files: ['package.json', 'README.md', 'index.html'],
      content: ['budget', 'category', 'csv', 'browser'],
    },
  },
  {
    id: 'recipe-box',
    style: 'vibrantBlocks',
    prompt:
      'A recipe box. Save recipes with ingredients and numbered steps, search by name or ingredient, scale the servings up or down with the quantities following, and mark favourites. Everything is stored in the browser, and the app says so plainly.',
    expects: {
      files: ['package.json', 'README.md', 'index.html'],
      content: ['recipe', 'ingredient', 'servings', 'search', 'browser'],
    },
  },
  {
    id: 'conference',
    style: 'cinematic',
    prompt:
      'A one-page site for a two-day developer conference with a schedule and speakers',
    expects: {
      files: ['package.json', 'README.md', 'index.html'],
      content: ['schedule'],
    },
  },
];

/**
 * The sample gallery on vibld.com/examples (internal issue 186, D153): one brief per site
 * type, each built in six styles, so a visitor can see what a style does to
 * the same request and what each kind of site comes out as.
 *
 * Apart from `CASES` on purpose. Those ask for a different style each
 * (ADR-0014) and are what a blank selection runs; this grid shares its
 * styles by design and is 30 paid builds, run only when named.
 */
export const GALLERY_SITE_TYPES = [
  {
    id: 'consultancy',
    title: 'A consultancy',
    prompt:
      'A site for a small management consultancy with its services, two short case studies and a contact form',
    content: [['consult', 'advis']],
  },
  {
    id: 'portfolio',
    title: 'A portfolio',
    prompt:
      'A portfolio for a freelance photographer with a gallery of recent work, a short bio and a way to get in touch',
    content: ['photo'],
  },
  {
    id: 'shop',
    title: 'A shop',
    prompt:
      'A storefront for a small candle maker with products, prices and a cart. There is no checkout backend, so the cart is kept in the browser, and the site says so plainly.',
    content: ['cart', 'browser'],
  },
  {
    id: 'docs',
    title: 'A docs site',
    prompt:
      'A documentation site for an open-source command-line tool with installation, a quick start and a command reference',
    content: ['install', 'command'],
  },
  {
    id: 'event',
    title: 'An event',
    prompt:
      'A site for a weekend food festival with the lineup, a schedule, tickets and directions',
    content: ['schedule', 'ticket'],
  },
] as const satisfies readonly {
  id: string;
  title: string;
  prompt: string;
  content: readonly Expectation[];
}[];

export type GallerySiteType = (typeof GALLERY_SITE_TYPES)[number]['id'];

/** The six styles each brief is built in (D153). */
export const GALLERY_STYLES = [
  'minimalist',
  'editorial',
  'brutalism',
  'glassmorphism',
  'warmPaper',
  'acidDark',
] as const satisfies readonly StylePresetId[];

export type GalleryStyle = (typeof GALLERY_STYLES)[number];

/** The case id for one cell of the grid. */
export function galleryCaseId(
  siteType: GallerySiteType,
  style: GalleryStyle,
): string {
  return `gallery-${siteType}-${style.toLowerCase()}`;
}

export const GALLERY_CASES: EvalCase[] = GALLERY_SITE_TYPES.flatMap((type) =>
  GALLERY_STYLES.map((style) => ({
    id: galleryCaseId(type.id, style),
    style,
    prompt: type.prompt,
    expects: {
      files: ['package.json', 'README.md', 'index.html'],
      content: [...type.content],
    },
  })),
);

/** A case by id, from the set or the gallery. */
export function findCase(id: string): EvalCase | undefined {
  return (
    CASES.find((entry) => entry.id === id) ??
    GALLERY_CASES.find((entry) => entry.id === id)
  );
}

/**
 * A deterministic stand-in for a model, used so CI can exercise the harness
 * without credentials or spend.
 *
 * It is not a model and the harness says so in its report: a score measured
 * against this measures the machinery, not generation quality. The real
 * baseline needs a provider and an approved spend cap (internal issue 9, internal issue 18).
 *
 * It emits the same file set a real build has, rather than the minimum the
 * older cases happened to assert: the files a model writes (src/App.tsx,
 * src/styles.css, and the DESIGN.md a real build renders from its spec),
 * and Vibld's own files from the same templates a real build uses (D71,
 * `withScaffold`), so CI's build of this stub installs and compiles exactly
 * the package.json, tsconfig.json and vite.config.ts a real generation gets.
 * A stub that produces less than the contract demands is not a stand-in: it
 * passes cases a real run would fail, and fails cases that ask for a file
 * the contract already requires. Until internal PR 59 the stub declared no vite at
 * all, and the project it reported accepted stopped at "vite: not found".
 */
export function stubPlan(testCase: EvalCase): GenerationPlan {
  // The prompt and the words the case expects, echoed into the page's
  // description. A stub
  // meets a case's expectations by construction: what it exercises is the
  // harness, and a stub that failed the set would say nothing about it.
  const subject = [testCase.prompt, ...testCase.expects.content.flat()]
    .join(' ')
    .toLowerCase();
  const own: ProjectFile[] = [
    {
      path: 'DESIGN.md',
      content: `---\nrounded: 4px\n---\n\n# Design\n\nPlaceholder tokens for: ${testCase.prompt}\n`,
    },
    {
      path: 'src/styles.css',
      content: `@import 'tailwindcss';\n@import 'tw-animate-css';\n\n${tokenCss(
        {
          primary: '#1a1a1a',
          onPrimary: '#ffffff',
          secondary: '#f2f2f2',
          onSecondary: '#1a1a1a',
          accent: '#e8e2d4',
          onAccent: '#1a1a1a',
          background: '#ffffff',
          foreground: '#1a1a1a',
          card: '#ffffff',
          cardForeground: '#1a1a1a',
          muted: '#f2f2f2',
          mutedForeground: '#555555',
          border: '#e5e5e5',
          destructive: '#b42318',
          onDestructive: '#ffffff',
        },
      )}\n`,
    },
    {
      path: 'src/App.tsx',
      // Every animated background (D75), so CI compiles each templated one
      // under the project's own tsconfig, as a build that imports it would.
      content: `import { ArrowRight } from 'lucide-react';
import { MotionConfig, motion } from 'motion/react';
import { AuroraMesh } from '@/components/backdrop/aurora-mesh';
import { FlowLines } from '@/components/backdrop/flow-lines';
import { GrainBlobs } from '@/components/backdrop/grain-blobs';
import { ParticleField } from '@/components/backdrop/particle-field';
import { cn } from '@/lib/utils';

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <motion.main
        className={cn('relative isolate min-h-screen overflow-hidden bg-background text-foreground')}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <AuroraMesh className="opacity-80" speed={0.6} />
        ${testCase.id} <ArrowRight aria-hidden="true" className="size-4" />
        <div className="relative isolate h-40 overflow-hidden">
          <ParticleField count={800} colors={['var(--accent)']} />
        </div>
        <div className="relative isolate h-40 overflow-hidden">
          <GrainBlobs grain={0.1} />
        </div>
        <div className="relative isolate h-40 overflow-hidden">
          <FlowLines speed={0} />
        </div>
      </motion.main>
    </MotionConfig>
  );
}
`,
    },
  ];
  const files = withScaffold(
    own,
    { title: testCase.id, description: subject },
    false,
  );
  return { summary: `Static site for: ${testCase.prompt}`, files };
}
