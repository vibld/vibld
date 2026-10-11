/**
 * Showcase prompts: requests written to show what a build can do, each
 * built around a 3D scene the model designs on Vibld's stage (`scenes.ts`,
 * D205), one of the animated backgrounds Vibld writes (`backdrops.ts`,
 * D75), or motion alone.
 *
 * vibld.com lists them on /showcase, and the builder offers them on an
 * empty project. Either way one click puts the prompt in the composer
 * through the "Start from this template" link (D106,
 * `apps/web/src/templates/template-brief.ts`), with the build's cost shown
 * before anything is spent.
 *
 * Each prompt names its effect in the words that select it, and
 * `showcase.test.ts` holds every prompt to that: a prompt that stops
 * selecting its scene example or background fails there, not in a build.
 * The scene is still written for each build; the example only teaches the
 * stage. Types only are imported from those modules, so a page that lists
 * these prompts does not carry the scenes' sources.
 */

import type { BackdropId } from './backdrops.ts';
import type { SceneExample } from './scenes.ts';

export interface ShowcasePrompt {
  /** Lowercase letters, digits and hyphens: a template id in the link. */
  id: string;
  /** The made-up product the prompt builds. */
  name: string;
  /** One sentence, for the card. */
  summary: string;
  /** The effect it is built around, shown on the card. */
  effect: string;
  /** The example scene the prompt's guidance shows, if it names one. */
  scene?: SceneExample['id'];
  /** The animated background the prompt selects, if any. */
  backdrop?: BackdropId;
  /** Two CSS colors for the card's art until it has a screenshot. */
  colors: readonly [string, string];
  /** The request, exactly as it goes into the composer. */
  prompt: string;
}

export const SHOWCASE_PROMPTS: readonly ShowcasePrompt[] = [
  {
    id: 'showcase-atlas',
    name: 'Atlas Freight',
    summary:
      'A global logistics landing page with a spinning 3D globe, live lane stats and a bento of features.',
    effect: '3D globe',
    scene: 'globe',
    colors: ['#0b1530', '#38bdf8'],
    prompt: `Build a landing page for Atlas Freight, a freight-forwarding platform that books ocean, air and road shipments in one place for mid-size importers.

Look: deep navy background, crisp white type, one electric sky-blue accent and a warm amber second accent. A confident geometric sans for headlines, generous spacing.

Hero: headline "Every lane, one dashboard" with a short subhead and two buttons (Get a quote, See the platform). On the right, a spinning 3D globe with arcs of light between ports, tilting toward the pointer. On phones the globe sits above the text.

Then:
- A row of four stats that count up when scrolled into view (ports covered, shipments a month, on-time rate, carriers).
- A bento grid of six features (instant quotes, live tracking, customs documents, carbon reports, team approvals, API), each card lifting slightly on hover.
- "How it works" in three numbered steps that reveal in sequence.
- One customer quote with a name, role and company.
- A closing call to action band and a simple footer.

Motion: calm and precise. Sections fade up as they enter, never bounce.`,
  },
  {
    id: 'showcase-halo',
    name: 'Halo',
    summary:
      'An AI writing assistant with an iridescent liquid orb behind the headline and a typing demo.',
    effect: '3D liquid orb',
    scene: 'liquid-orb',
    colors: ['#120d24', '#c084fc'],
    prompt: `Build a landing page for Halo, an AI writing assistant that drafts emails, briefs and posts in your own voice.

Look: near-black background with a violet tint, soft white type, accents of violet, cyan and pink. Rounded, friendly sans.

Hero: centered headline "Write like you, only faster", a one-line subhead and an email field with a "Join the beta" button. Behind the headline, an iridescent liquid orb that breathes and swells toward the pointer, with a dark scrim so the text stays readable.

Then:
- A live demo panel: a prompt is typed out letter by letter, then Halo's draft streams in below it, looping every few seconds.
- Three feature cards (learns your voice, works in every app, private by default) that tilt slightly toward the pointer.
- Pricing with three tiers (Free, Pro at $12 a month, Team at $10 per seat), monthly and yearly toggle, Pro highlighted.
- An FAQ accordion with five questions.
- A footer.

Motion: smooth and airy, staggered fade-ups, nothing faster than 200ms.`,
  },
  {
    id: 'showcase-prism',
    name: 'Prism Studio',
    summary:
      'A playful design studio portfolio with glossy floating 3D shapes and scroll-revealed case studies.',
    effect: '3D floating shapes',
    scene: 'floating-shapes',
    colors: ['#14102a', '#f472b6'],
    prompt: `Build a portfolio site for Prism Studio, a small brand and product design studio known for bold, playful work.

Look: deep indigo background, off-white type, candy accents of pink, teal and violet. A big expressive display face for headlines, a clean sans for body text.

Hero: glossy floating 3D shapes in the brand colors drift behind a huge headline, "We make brands people want to touch", with a scrim behind the text. One button: See our work.

Then:
- A marquee of client names that scrolls slowly and pauses on hover.
- Four case studies as large cards (image, client, one-line result, tags) that slide up and fade in one after another as you scroll.
- Services in three columns: brand identity, product design, motion.
- A short "About the studio" section with three team portraits.
- A contact section with a simple form (name, email, project budget select, message) and a footer.

Motion: playful but controlled, springy hovers on cards and buttons.`,
  },
  {
    id: 'showcase-tide',
    name: 'Tide Festival',
    summary:
      'An electronic music festival site with a synthwave dot wave, a countdown and a lineup by day.',
    effect: '3D dot wave',
    scene: 'dot-wave',
    colors: ['#0a0618', '#22d3ee'],
    prompt: `Build a website for Tide, a three-day electronic music festival on a beach in late August.

Look: synthwave night, almost-black background, neon cyan and magenta accents, a wide condensed display face in uppercase for headlines.

Hero: a dot wave rolls toward a low horizon across the bottom half of the screen, rippling where the pointer is. Above the horizon: "TIDE", the dates, the location and a "Get tickets" button.

Then:
- A countdown to opening night (days, hours, minutes, seconds) that ticks live.
- The lineup in tabs by day (Friday, Saturday, Sunday), each a grid of artist names with set times, headliners larger.
- Tickets: three passes (Day, Weekend, VIP) as cards with what each includes and a price.
- A venue section with a stylized map of stages and a short travel guide.
- An FAQ accordion and a footer with social links.

Motion: energetic. The countdown digits flip, lineup names stagger in, buttons glow on hover.`,
  },
  {
    id: 'showcase-northlight',
    name: 'Northlight',
    summary:
      'A savings app landing page with an aurora behind the hero, a phone mockup and scroll-staggered features.',
    effect: 'Aurora background',
    backdrop: 'aurora-mesh',
    colors: ['#06141f', '#34d399'],
    prompt: `Build a landing page for Northlight, a savings app that rounds up purchases and grows them in high-yield pots.

Look: dark teal-black background, white type, aurora greens and violets as accents. A clean, trustworthy sans.

Hero: a slow aurora of the page's colors behind the hero, the headline "Watch your savings glow", a subhead, App Store and Google Play buttons, and a phone mockup showing a pot balance growing.

Then:
- Three steps (connect your card, choose a goal, watch it grow), each with a small illustration, revealed one by one on scroll.
- A savings calculator: a slider for monthly round-ups and a live total after one, three and five years.
- Security: four short points (bank-level encryption, FDIC-insured partner banks, no hidden fees, cancel anytime) with icons.
- Three reviews with star ratings.
- A closing call to action and a footer with legal links.

Motion: gentle, numbers animate when they change, cards fade up in sequence.`,
  },
  {
    id: 'showcase-orbit',
    name: 'Orbit Voyages',
    summary:
      'A space tourism site with a galaxy of particles, a mission timeline and a booking form.',
    effect: 'Particle galaxy',
    backdrop: 'particle-field',
    colors: ['#05060f', '#a5b4fc'],
    prompt: `Build a website for Orbit Voyages, a company selling week-long trips to a private orbital hotel.

Look: black space background, cool white type, pale indigo and warm gold accents. An elegant wide sans for headlines.

Hero: a slowly turning galaxy of particles behind the hero, the headline "The best window seat there is", a subhead and a "Reserve a voyage" button.

Then:
- A mission timeline from training to launch to return, as a vertical line that fills in as you scroll, each stage appearing beside it.
- Three cabin options as cards (Window, Suite, Observatory) with what is included and a price.
- A gallery of six large photos: views from the hotel and its interior.
- A booking form: name, email, preferred launch month (select), party size, and a submit button that shows a confirmation.
- A footer.

Motion: slow and cinematic, long eased fades, nothing jumpy.`,
  },
  {
    id: 'showcase-ember',
    name: 'Ember & Oak',
    summary:
      'A specialty coffee roaster with warm grainy gradient blobs, origin stories and a subscription builder.',
    effect: 'Grain blobs background',
    backdrop: 'grain-blobs',
    colors: ['#2a1810', '#f59e0b'],
    prompt: `Build a website for Ember & Oak, a small-batch coffee roaster that sells beans by subscription.

Look: warm and editorial. Espresso-brown background, cream type, amber and terracotta accents, a classic serif for headlines and a simple sans for body text.

Hero: soft gradient blobs of the page's colors drifting under a fine film grain behind the headline "Roasted on Tuesday, in your cup by Friday" and a "Start a subscription" button.

Then:
- Three origin stories (Ethiopia, Colombia, Guatemala) as alternating image and text rows, each with tasting notes.
- A subscription builder: choose roast (light, medium, dark), grind, bag size and frequency, with the price updating live and a summary card.
- "From the roastery": three short journal entries as cards.
- Reviews and a footer with the café's address and opening hours.

Motion: unhurried, images ease in as you scroll, the builder's price counts to its new value.`,
  },
  {
    id: 'showcase-signal',
    name: 'Signal',
    summary:
      'An API observability tool with flowing lines of light, a live log terminal and code tabs.',
    effect: 'Flowing lines background',
    backdrop: 'flow-lines',
    colors: ['#07090d', '#4ade80'],
    prompt: `Build a landing page for Signal, an observability tool that traces every API request across services.

Look: technical and dark. Near-black background, light gray type, one signal-green accent, a monospace face for code and labels and a neat sans for headlines.

Hero: flowing lines of light drift behind the hero like signals on a scope. Headline "See every request, end to end", a subhead and two buttons (Start free, Read the docs).

Then:
- A terminal window where log lines stream in one at a time with timestamps, status codes and latencies, looping.
- Code tabs (Node, Python, Go) showing a three-line install snippet with a copy button.
- Six integrations as a grid of logos with names.
- Pricing: Free, Team and Enterprise, with request volumes per tier.
- A footer with docs, status and changelog links.

Motion: crisp, short fades and slides, the terminal is the moving piece.`,
  },
  {
    id: 'showcase-kinetic',
    name: 'Kinetic',
    summary:
      'A creative agency site built on motion alone: kinetic type, pinned sections and a horizontal gallery.',
    effect: 'Scroll motion',
    colors: ['#0f0f0f', '#facc15'],
    prompt: `Build a website for Kinetic, a creative agency that makes launch campaigns for consumer brands.

Look: black and white with one yellow accent. A huge, tight display face for headlines, a plain sans for body text.

Hero: the headline "We make launches move" assembles word by word, each word rising into place, with a short subhead fading in after it.

Then:
- A services section where the section title stays pinned while three service panels scroll past it.
- Selected work as a horizontal gallery that moves sideways as you scroll down, six projects with a client name and a one-line result.
- A stats row (campaigns launched, countries, awards) whose numbers count up.
- A testimonial that fades between three quotes.
- A big "Start a project" call to action and a footer.

Motion: bold and choreographed, with scroll-linked movement and staggered reveals, and every effect off under reduced motion.`,
  },
  {
    id: 'showcase-lumen',
    name: 'Lumen',
    summary:
      'A smart lighting product launch in 3D, with a sticky product story and an interactive color picker.',
    effect: '3D, designed for it',
    colors: ['#101018', '#fb923c'],
    prompt: `Build a product launch page for Lumen, a smart light bulb that changes color with music and the time of day.

Look: 3D and premium. Dark charcoal background, white type, warm orange and soft violet accents, a refined sans.

Hero: a 3D scene that suits a glowing product, the headline "Light that listens", the price ($39) and a "Pre-order" button.

Then:
- A product story with the image of the bulb pinned on one side while four short feature paragraphs scroll past on the other.
- An interactive color picker: choosing a swatch or dragging a hue slider changes the glow of a large illustrated bulb.
- A comparison table of Lumen and two ordinary smart bulbs.
- An FAQ accordion and a footer.

Motion: smooth and glowing, with the pinned story crossfading its image between features.`,
  },
];

/** A showcase prompt by id, or undefined. */
export function findShowcasePrompt(id: string): ShowcasePrompt | undefined {
  return SHOWCASE_PROMPTS.find((entry) => entry.id === id);
}
