/**
 * A small, real catalogue of page/screen patterns (docs/decisions.md
 * L50-L52): 10 marketing page types and 6 SaaS app screens, each carrying
 * structural guidance concrete enough to act on -- the same idea
 * `style-presets.ts` already applies to visual direction, applied here to
 * content and layout instead.
 *
 * L50 calls for retrieval "on demand -- a handful of relevant patterns
 * injected per request," not the whole catalogue held permanently in the
 * system prompt. Issue #12's real retrieval path needs storage and an
 * embedding provider Vibld does not yet have (see that issue and ADR-0009),
 * so this does the smallest thing that satisfies L50's actual requirement
 * without either dependency: a closed set, matched by keyword against the
 * request text, same as a search index's cheapest tier. It is not semantic
 * search and does not claim to be -- a request that names a page type
 * directly ("a pricing page") matches; one that only implies it ("show what
 * the plans cost") may not, and that is an accepted gap, not a bug, until
 * #12 exists.
 *
 * The set is closed for the same reason `STYLE_PRESETS` is: nothing here
 * crosses the network from a caller, so there is no injection surface to
 * defend. `selectPatterns` only ever returns entries from this file.
 */

export interface PagePattern {
  id: string;
  name: string;
  /** Lowercase words/phrases matched against the request text. */
  triggers: readonly string[];
  /** Appended to the request when this pattern matches. */
  guidance: string;
}

/** L51: "about 10 marketing page types." */
export const MARKETING_PAGE_PATTERNS: readonly PagePattern[] = [
  {
    id: 'landing',
    name: 'Landing page',
    triggers: ['landing page', 'home page', 'homepage', 'marketing site'],
    guidance:
      "A hero that states the offer in one sentence with a single clear call to action, repeated once more further down the page rather than competing with other primary actions. Proof the visitor can trust before asking them to act -- logos, numbers or testimonials, real or clearly marked as placeholder. Benefit sections that answer a visitor's actual doubts, not a bare feature list.",
  },
  {
    id: 'pricing',
    name: 'Pricing page',
    triggers: ['pricing page', 'pricing', 'plans page', 'plans and pricing'],
    guidance:
      'A small number of tiers (two or three) as parallel cards, the recommended one visually distinguished but not the only one that looks viable. A monthly/annual toggle if both exist, with the annual saving stated in plain terms. One primary action per tier. Answer the two questions a pricing page always raises -- what happens at the limit, and can this be cancelled -- either inline or in an FAQ immediately below.',
  },
  {
    id: 'about',
    name: 'About page',
    triggers: ['about page', 'about us', 'our story', 'company page'],
    guidance:
      'A specific reason this exists, not a generic mission statement -- what problem, for whom, why now. Real people or a real timeline if the request supplies them; a placeholder clearly marked as one if it does not. This page earns trust through specificity, not through more adjectives.',
  },
  {
    id: 'contact',
    name: 'Contact page',
    triggers: ['contact page', 'contact us', 'get in touch'],
    guidance:
      'A form asking only what a first reply needs -- name, a way to respond, and the message -- plus a direct alternative (an email address, a scheduling link) for someone who does not want to fill in a form. State the expected response time if one is known; do not invent one.',
  },
  {
    id: 'faq',
    name: 'FAQ page',
    triggers: ['faq page', 'faq', 'frequently asked questions'],
    guidance:
      'Group questions the way a visitor actually thinks about them (pricing, setup, security) rather than one long flat list. Each answer is a real answer, not a redirect to "contact us" -- that is the question a support inbox is already answering, and this page exists to reduce that inbox, not restate it.',
  },
  {
    id: 'features',
    name: 'Features / product page',
    triggers: [
      'features page',
      'product page',
      'features and benefits',
      'what it does page',
    ],
    guidance:
      'Organize by the outcome a feature produces, not by the internal name of the feature -- a visitor cares what changes for them, not what the engineering team calls it. One feature per section with enough specificity to be checked for truth, not a grid of icons with three words each.',
  },
  {
    id: 'testimonials',
    name: 'Testimonials / case studies page',
    triggers: [
      'testimonials page',
      'case studies',
      'customer stories',
      'success stories',
    ],
    guidance:
      'A specific result attributed to a specific person or company beats a generic quote attributed to "a happy customer." Where the request supplies no real testimonials, use clearly labelled placeholder quotes (e.g. "[Customer name], [Company]") rather than inventing a real-sounding person -- a fabricated testimonial is a fabricated claim, not a design placeholder.',
  },
  {
    id: 'blog-index',
    name: 'Blog / articles index',
    triggers: ['blog page', 'blog index', 'articles page', 'news page'],
    guidance:
      'A card per post with a title, date, and one-line summary -- enough to decide whether to click, not the full post. If no real posts exist yet, a small number of placeholder entries clearly marked as such, rather than an empty page or invented article content presented as real.',
  },
  {
    id: 'careers',
    name: 'Careers page',
    triggers: ['careers page', 'jobs page', 'we are hiring', 'open positions'],
    guidance:
      'Open roles as a real list (title, team, location/remote), even if the list is a single placeholder role -- do not invent a roster of fictional openings. A short section on why someone would want to work here, specific to this company rather than generic perks copy.',
  },
  {
    id: 'changelog',
    name: 'Changelog / release notes',
    triggers: ['changelog', 'release notes', 'whats new page', "what's new"],
    guidance:
      'Reverse-chronological entries, each dated, each stating what changed in terms a user notices (not an internal commit message). Group by version or date, not one undifferentiated stream.',
  },
];

/** L51: "6 SaaS app screens." */
export const SAAS_SCREEN_PATTERNS: readonly PagePattern[] = [
  {
    id: 'dashboard',
    name: 'Dashboard / overview',
    triggers: ['dashboard', 'overview screen', 'home screen', 'app home'],
    guidance:
      'Lead with the small number of things a returning user actually checks (status, recent activity, one or two key numbers), not every metric the system can produce. One clear next action, not a wall of equally-weighted widgets.',
  },
  {
    id: 'settings',
    name: 'Settings / account',
    triggers: [
      'settings page',
      'account settings',
      'account page',
      'profile settings',
    ],
    guidance:
      'Group related settings under clear headings (profile, security, notifications, billing) rather than one long form. Destructive actions (delete account, revoke access) are visually separated from routine ones and require explicit confirmation.',
  },
  {
    id: 'onboarding',
    name: 'Onboarding flow',
    triggers: [
      'onboarding flow',
      'onboarding screen',
      'setup wizard',
      'getting started flow',
    ],
    guidance:
      'A small number of steps with visible progress, each asking for only what is needed to reach a working first result -- not every field the data model eventually wants. Let a user skip anything genuinely optional rather than blocking on it.',
  },
  {
    id: 'auth',
    name: 'Sign-in / sign-up',
    triggers: [
      'sign in page',
      'sign up page',
      'login page',
      'auth screen',
      'authentication screen',
    ],
    guidance:
      'One primary path (email/password, or a named SSO provider if the request specifies one) presented clearly, with a secondary path never competing visually with it. State what happens after -- where sign-up leads -- rather than leaving a user at a dead end.',
  },
  {
    id: 'billing',
    name: 'Billing / subscription management',
    triggers: [
      'billing screen',
      'billing page',
      'subscription management',
      'manage subscription',
    ],
    guidance:
      'Show the current plan and what it costs before anything else on the screen. Make upgrading, downgrading and cancelling equally easy to find -- burying cancellation is the kind of dark pattern this should not reproduce even as a demonstration.',
  },
  {
    id: 'empty-state',
    name: 'Empty state / data list',
    triggers: [
      'empty state',
      'data table screen',
      'list view screen',
      'records screen',
    ],
    guidance:
      'An empty list explains what would appear here and offers the one action that creates the first item -- never a bare table with a header row and nothing under it. A populated list gets sort/filter only where the request implies enough items to need it.',
  },
];

const ALL_PATTERNS: readonly PagePattern[] = [
  ...MARKETING_PAGE_PATTERNS,
  ...SAAS_SCREEN_PATTERNS,
];

/**
 * A handful of relevant patterns for this request, matched by keyword
 * (see the file-level comment for why keyword matching, not semantic
 * retrieval). Capped at `limit` so a request that happens to name several
 * page types does not balloon the prompt -- L50's "a handful," not the
 * whole catalogue.
 */
export function selectPatterns(
  promptText: string,
  limit = 2,
): readonly PagePattern[] {
  const lower = promptText.toLowerCase();
  const matched = ALL_PATTERNS.filter((pattern) =>
    pattern.triggers.some((trigger) => lower.includes(trigger)),
  );
  return matched.slice(0, limit);
}

/**
 * The sentence(s) appended to a request for the patterns it matched, or
 * null when nothing matched. Phrased as guidance, not a requirement, for
 * the same reason `styleDirection` is: an explicit instruction in the
 * request itself outranks a pattern's default advice.
 */
export function patternGuidance(promptText: string): string | null {
  const patterns = selectPatterns(promptText);
  if (patterns.length === 0) return null;
  const sections = patterns
    .map((pattern) => `${pattern.name}: ${pattern.guidance}`)
    .join('\n\n');
  return `This request matches the following page pattern(s). Use this as structural guidance, not a checklist to satisfy mechanically -- where it conflicts with an instruction in the request above, follow the request.

${sections}`;
}
