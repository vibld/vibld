import type { DemoSiteId } from './demo-sites.ts';

/**
 * The kinds of project the use-case pages describe (/use-cases/<slug>).
 *
 * Each one links to real output where some exists: `examples` names entries
 * in `examples/catalogue.json` by slug, and the page shows that entry's
 * prompt and model as the catalogue records them, never a paraphrase. The
 * test beside this file fails if a slug here stops existing there.
 *
 * What a page says vibld produces is held to what the product does: a
 * conventional React and TypeScript project on Vite, with the files the
 * builder writes (see `docs/taking-your-code`), and the rule the builder's
 * own prompt sets that a form with no backend says so on the page
 * (`packages/ai/src/plan-schema.ts`). Nothing here promises a feature a
 * generated project does not have, such as a server behind a booking form.
 */

export interface UseCase {
  slug: string;
  /** Short, for cards and navigation. */
  label: string;
  title: string;
  description: string;
  lead: string;
  /** What somebody might ask for, as they might write it. */
  asks: string[];
  /** What comes back, specific to this kind of project. */
  produces: string[];
  /** What to know before starting, stated plainly. */
  limits: string[];
  /** Entries in examples/catalogue.json that are this kind of project. */
  examples: string[];
  /** The home page's demonstration that is closest to this kind. */
  demo: DemoSiteId;
  /** A marketing-local tint for the card, see app.css. */
  tint: 'peach' | 'mint' | 'sun' | 'sky' | 'rose' | 'sand';
}

export const USE_CASES: UseCase[] = [
  {
    slug: 'small-business',
    label: 'Small business site',
    title: 'A site for a small business',
    description:
      'A cafe, a practice, a studio or a shop: what to ask vibld for, what it hands back, and real sites it built from one sentence.',
    lead: 'Opening hours, services, a way to find you and a way to get in touch. The site most small businesses actually need is small, and it should be yours to keep.',
    asks: [
      'A site for a dental practice with opening hours, services and directions.',
      'A cafe site with the menu, opening hours and a map link.',
      'A site for my bike repair shop: services with prices, a photo of the workshop, and how to book a repair by phone.',
    ],
    produces: [
      'A one-page or few-page React and TypeScript site on Vite, styled with Tailwind and shadcn/ui components.',
      'Sections for what you named (hours, services, directions), with the copy written for your business rather than lorem ipsum.',
      'A DESIGN.md recording the colours, type and breakpoints it chose, which the build is checked against.',
    ],
    limits: [
      'A contact or booking form has no server behind it until you add one. The builder is told to say so on the page rather than pretend it sends.',
      'Put the real hours, prices and address in the request. Anything you leave out, it has to invent.',
    ],
    examples: ['dental-practice-opus-5-5', 'coffee-roaster-opus-5-5'],
    demo: 'clinic',
    tint: 'peach',
  },
  {
    slug: 'portfolio',
    label: 'Portfolio',
    title: 'A portfolio',
    description:
      'A portfolio for your work, built by vibld as a plain React project you can host anywhere: what to ask for, what you get, and a real example.',
    lead: 'Big images, a short bio, and one page for each body of work. A portfolio is mostly layout and restraint, which is what a named style direction is for.',
    asks: [
      'A portfolio for a freelance illustrator with a gallery and a short bio.',
      'A portfolio for my ceramics, big images, one page per series.',
      'A photography portfolio in the editorial style, with a contact link and nothing else.',
    ],
    produces: [
      'A gallery layout built from your description, in a style you pick from three sketches or name outright.',
      'Components you can read and edit: the gallery, the bio, the navigation, in files under src/.',
      'Alt text on every image, which the design checks look for before the build is called clean.',
    ],
    limits: [
      'It does not have your photographs. It lays out places for them, and you replace the files in the project.',
    ],
    examples: ['freelance-portfolio-opus-5-5'],
    demo: 'portfolio',
    tint: 'sand',
  },
  {
    slug: 'saas-landing',
    label: 'SaaS landing page',
    title: 'A landing page for a software product',
    description:
      'A landing page for a SaaS product, with pricing, an FAQ and a sign-up form: what to ask vibld for, what it produces, and a real example.',
    lead: 'A headline, the three things the product does, a pricing table and a form. A landing page is a conventional shape, and a conventional codebase is the right thing to hand a developer afterwards.',
    asks: [
      'A landing page for a cybersecurity SaaS with pricing, FAQ and a contact form.',
      'A landing page for an invoicing tool, with a pricing table and a sign-up form.',
    ],
    produces: [
      'A landing page with the sections you asked for, in React and TypeScript, with shadcn/ui components to hand for things like an FAQ accordion and the form.',
      'Motion for the entrances, from the Motion library, with a reduced-motion rule the design checks look for.',
      'A project a developer can push to GitHub as a pull request and review like any other change.',
    ],
    limits: [
      'The sign-up form needs an endpoint of yours to post to. Until it has one, the page says the form is a demonstration.',
      'Prices, plan names and claims about your product are whatever you put in the request. Check them before you publish.',
    ],
    examples: ['security-saas-opus-5-5'],
    demo: 'saas',
    tint: 'sun',
  },
  {
    slug: 'events',
    label: 'Events and bookings',
    title: 'A page for an event or a booking',
    description:
      'A page for a conference, a class or a fair, with a schedule and a way to sign up: what to ask vibld for, what it produces, and a real example.',
    lead: 'A date, a schedule, who is speaking or teaching, and a way to take part. Event pages are short-lived, which is a good reason to want one quickly and a bad reason to be locked into a platform for it.',
    asks: [
      'A one-page site for a two-day developer conference with a schedule and speakers.',
      'A site for my Saturday wheel-throwing classes. People pick a two-hour slot and see a confirmation.',
      'A page for our community pottery fair, with a schedule and a signup.',
    ],
    produces: [
      'A schedule laid out for the days you describe, with speakers or sessions as separate components.',
      'A slot picker or signup form as its own React component, with labelled fields, which the design checks look for.',
      'A site you can publish at a vibld address for the weeks it matters, then take down, or export and host yourself.',
    ],
    limits: [
      'Picking a slot does not reserve anything until the form posts somewhere that records it. The builder says so on the page instead of faking a confirmation email.',
    ],
    examples: ['conference-gpt-6-sol'],
    demo: 'event',
    tint: 'rose',
  },
  {
    slug: 'tools',
    label: 'Small tools and apps',
    title: 'A small tool or app',
    description:
      'A small app that runs in the browser, such as a budget tracker or a recipe box: what to ask vibld for, what it produces, and real examples.',
    lead: 'Add things, change them, see a total, keep it between visits. A lot of useful software is one screen and a list, and it should not need an account somewhere to keep working.',
    asks: [
      'A personal budget tracker: add income and expenses with a category and a date, see the month’s balance, and export the month as CSV.',
      'A recipe box: save recipes with ingredients and steps, search them, and scale the servings.',
      'A habit tracker: add a habit, tick it off each day, see the streak.',
    ],
    produces: [
      'A single-page app in React and TypeScript whose state lives in the browser, so it works without a server.',
      'Browser storage read inside try/catch, because the builder’s instructions require it: blocked or malformed data should start the app empty rather than blank.',
      'A project you can run with npm install and npm run dev, or run in a vibld sandbox before you take it anywhere.',
    ],
    limits: [
      'Data kept in the browser stays in that browser. Syncing between devices or sharing with other people needs a backend that a generated project does not come with.',
      'Instructions are not guarantees. The recipe box on the examples page reads its storage without a fallback, and its note says what that breaks. Read the code before you rely on it.',
    ],
    examples: ['budget-tracker-gpt-6-sol', 'recipe-box-deepseek-v4-pro'],
    demo: 'app',
    tint: 'sky',
  },
];

export function useCaseFor(slug: string): UseCase | undefined {
  return USE_CASES.find((useCase) => useCase.slug === slug);
}
