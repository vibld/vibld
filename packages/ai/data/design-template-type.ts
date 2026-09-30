/**
 * Each design's own typefaces (docs/decisions.md, D103), read by
 * `bin/import-design-catalog.ts`, which swaps every family a set `replaces`
 * into the design's words, word for word, and adds any face its prompt does
 * not yet name.
 *
 * Chosen for vibld, not taken from the catalog: the catalog named Inter in
 * 92 of its 207 designs. Every family is on Google Fonts; a replacement is
 * of the same construction as what it replaces, so the words around it stay
 * true; no two designs share a set, and no family is in more than four.
 */
export type TypeRole = 'display' | 'body' | 'accent' | 'mono' | 'script' | 'ui';

export interface TypeFace {
  family: string;
  role: TypeRole;
  /** What the design uses it for. */
  use: string;
}

export interface TypeSet {
  faces: readonly TypeFace[];
  /** Each family the catalog named that this set changes, to what. */
  replaces: Readonly<Record<string, string>>;
  /** Families replaced by one of another Google category, on purpose. */
  categoryChangeOk?: readonly string[];
  /**
   * Whole phrases rewritten before any name is swapped, where a swap alone
   * would leave the words untrue ("a heavy grotesk (e.g. Archivo 800 ...)").
   */
  phrases?: Readonly<Record<string, string>>;
  why: string;
}

export const TYPE_SETS: Readonly<Record<string, TypeSet>> = {
  tallyroot: {
    faces: [
      {
        family: 'Barlow Semi Condensed',
        role: 'display',
        use: 'headings, 600, -0.05em tracking',
      },
      {
        family: 'Martian Mono',
        role: 'body',
        use: 'body, labels and all figures, tabular numerals',
      },
    ],
    replaces: {
      Barlow: 'Barlow Semi Condensed',
      'Geist Mono': 'Martian Mono',
      'JetBrains Mono': 'Martian Mono',
    },
    why: 'A condensed grotesk over a wide monospace keeps the ledger/terminal feel the catalog describes, in faces no other template uses together.',
  },
  warmlist: {
    faces: [
      {
        family: 'Rethink Sans',
        role: 'display',
        use: 'hero 72-88px bold, H2 48px semibold',
      },
      {
        family: 'Rethink Sans',
        role: 'body',
        use: 'body 16px, card text 13px, weights 400+',
      },
    ],
    replaces: {
      Inter: 'Rethink Sans',
    },
    why: 'A warm, slightly rounded neo-grotesk that holds up at 86px bold and stays crisp at 13px, so one family still carries the whole plum-wrapped tool.',
  },
  loanlight: {
    faces: [
      {
        family: 'Lexend',
        role: 'display',
        use: 'question headline 56-64px semibold',
      },
      {
        family: 'Lexend',
        role: 'body',
        use: 'body 16px, labels 14px, 36px input values',
      },
    ],
    replaces: {
      'Plus Jakarta Sans': 'Lexend',
    },
    why: 'Lexend has open, even geometric shapes that feel calm and conversational, and its figures are very clear for the large loan inputs.',
  },
  eventgrain: {
    faces: [
      {
        family: 'Instrument Serif',
        role: 'display',
        use: 'hero 96px, H2 60px and KPI figures',
      },
      {
        family: 'Karla',
        role: 'body',
        use: 'UI and body 16px, buttons 14px medium',
      },
    ],
    replaces: {
      Inter: 'Karla',
    },
    why: 'Instrument Serif keeps the gentle editorial headlines and figures, and the slightly quirky Karla grotesk makes the UI warmer than Inter, which suits the garden framing.',
  },
  scanwell: {
    faces: [
      {
        family: 'Kumbh Sans',
        role: 'display',
        use: 'section titles 20px medium',
      },
      {
        family: 'Kumbh Sans',
        role: 'body',
        use: 'body 16px, tile labels and helper text 14px',
      },
    ],
    replaces: {
      'Plus Jakarta Sans': 'Kumbh Sans',
    },
    why: 'A tidy, friendly geometric sans close to Satoshi in spirit, crisp at the small sizes this utility mostly uses.',
  },
  quillmark: {
    faces: [
      {
        family: 'Public Sans',
        role: 'display',
        use: 'two-line title 36px bold',
      },
      {
        family: 'Public Sans',
        role: 'body',
        use: 'interface text 16px, card titles 18px bold',
      },
      {
        family: 'Dancing Script',
        role: 'script',
        use: 'typed signature style: neat cursive',
      },
      {
        family: 'Homemade Apple',
        role: 'script',
        use: 'typed signature style: loose handwriting',
      },
      {
        family: 'La Belle Aurore',
        role: 'script',
        use: 'typed signature style: quick pen signature',
      },
    ],
    replaces: {
      Inter: 'Public Sans',
      Caveat: 'La Belle Aurore',
    },
    why: 'Public Sans is a plain, system-like neutral sans that keeps the desk tool quiet; the three scripts give distinct signature styles, and La Belle Aurore looks more like a real pen signature than Caveat.',
  },
  cutline: {
    faces: [
      {
        family: 'Azeret Mono',
        role: 'display',
        use: 'headings 20px medium',
      },
      {
        family: 'Azeret Mono',
        role: 'body',
        use: 'body and helper text 16px, control labels 14px, timecodes 12px',
      },
    ],
    replaces: {
      'Geist Mono': 'Azeret Mono',
      'JetBrains Mono': 'Azeret Mono',
    },
    why: 'Azeret Mono has squared, engineered digits that read like timecode, so the all-monospace editing bay keeps its feel in a face no other template uses.',
  },
  specwright: {
    faces: [
      {
        family: 'Source Sans 3',
        role: 'display',
        use: 'headings 48px bold, H2 24px',
      },
      {
        family: 'Source Sans 3',
        role: 'body',
        use: 'prose 16px at line-height 1.7',
      },
      {
        family: 'Source Code Pro',
        role: 'mono',
        use: 'code blocks and inline code 14px',
      },
    ],
    replaces: {
      Inter: 'Source Sans 3',
      'JetBrains Mono': 'Source Code Pro',
    },
    why: 'Source Sans 3 and Source Code Pro are a matched, long-established documentation pairing, familiar and legible the way mature developer docs should be.',
  },
  lanternbase: {
    faces: [
      {
        family: 'Mona Sans',
        role: 'display',
        use: 'display 56-64px bold at -0.05em, H2 30px',
      },
      {
        family: 'Mona Sans',
        role: 'body',
        use: 'body 16px at line-height 1.7',
      },
      {
        family: 'Fragment Mono',
        role: 'mono',
        use: 'code samples',
      },
    ],
    replaces: {
      Manrope: 'Mona Sans',
      'JetBrains Mono': 'Fragment Mono',
    },
    why: 'Mona Sans has the tight, heavy presence of a launch keynote at display sizes and a clean text cut; Fragment Mono is a grotesk-flavored mono that keeps code sleek and monochrome.',
  },
  snagline: {
    faces: [
      {
        family: 'Geist',
        role: 'display',
        use: 'display 48-52px medium at -0.04em',
      },
      {
        family: 'Geist',
        role: 'body',
        use: 'body 16px, dense issue rows 15px',
      },
      {
        family: 'Geist Mono',
        role: 'mono',
        use: 'issue IDs, keys and timestamps',
      },
    ],
    replaces: {},
    why: 'Geist with its own mono is already a distinctive engineering pair that few templates use, and it is exactly the precise, medium-weight voice this tool needs.',
  },
  chalkmark: {
    faces: [
      {
        family: 'Hanken Grotesk',
        role: 'display',
        use: 'headings 600 at -0.03em, italic emphasis words',
      },
      {
        family: 'Hanken Grotesk',
        role: 'body',
        use: 'UI and body 16px, buttons 14px medium',
      },
      {
        family: 'Libre Baskerville',
        role: 'accent',
        use: 'wordmark and occasional pull quotes',
      },
    ],
    replaces: {
      Inter: 'Hanken Grotesk',
    },
    why: 'Hanken Grotesk is a humane, neutral grotesk with real italics for the emphasis words, and Libre Baskerville keeps the bookish, academic wordmark.',
  },
  recallr: {
    faces: [
      {
        family: 'Urbanist',
        role: 'display',
        use: 'hero 80px bold at -0.025em, H2 48px',
      },
      {
        family: 'Atkinson Hyperlegible Next',
        role: 'body',
        use: 'body 17px and flashcard text',
      },
    ],
    replaces: {
      'Plus Jakarta Sans': 'Urbanist',
    },
    why: 'Urbanist gives the bright, rounded geometric headline, and Atkinson Hyperlegible Next was designed so every letter is distinct, which suits study cards read at speed.',
  },
  'liftoff-lab': {
    faces: [
      {
        family: 'Sofia Sans',
        role: 'display',
        use: 'display 80-96px, 800, uppercase, -0.05em',
      },
      {
        family: 'Sofia Sans',
        role: 'body',
        use: 'body 17px in sentence case',
      },
    ],
    replaces: {
      Inter: 'Sofia Sans',
    },
    why: 'Sofia Sans runs from black-weight, tightly tracked caps to relaxed text, so a single family can still be pushed to keynote-poster extremes.',
  },
  paysprout: {
    faces: [
      {
        family: 'Red Hat Mono',
        role: 'display',
        use: 'hero 80px bold, disposable figure 56px',
      },
      {
        family: 'Red Hat Mono',
        role: 'body',
        use: 'body 16px, dense lists 15px, tabular numerals',
      },
    ],
    replaces: {
      'Geist Mono': 'Red Hat Mono',
      'IBM Plex Mono': 'Red Hat Mono',
    },
    why: 'Red Hat Mono is calm and rounded for a monospace, so the all-mono money notebook keeps its aligned figures without feeling like a terminal.',
  },
  clearpath: {
    faces: [
      {
        family: 'Gantari',
        role: 'display',
        use: 'hero 56-64px semibold, card titles 30px',
      },
      {
        family: 'Gantari',
        role: 'body',
        use: 'body 16px, labels 13px, numeric inputs',
      },
    ],
    replaces: {
      'Plus Jakarta Sans': 'Gantari',
    },
    why: 'Gantari is a soft, open geometric sans that keeps a heavy money topic approachable and hopeful, with clear figures for the plan inputs.',
  },
  receiptly: {
    faces: [
      {
        family: 'Hubot Sans',
        role: 'display',
        use: 'wordmark 96-128px, 900, uppercase',
      },
      {
        family: 'Hubot Sans',
        role: 'body',
        use: 'body 16px, 12px uppercase field labels',
      },
    ],
    replaces: {
      Inter: 'Hubot Sans',
    },
    why: 'Hubot Sans has a heavy, slightly wide black weight that gives the neon fintech wordmark more bite than Inter, while its text weights stay neutral.',
  },
  cashtide: {
    faces: [
      {
        family: 'Red Hat Display',
        role: 'display',
        use: 'headings 600, 20-24px',
      },
      {
        family: 'Red Hat Text',
        role: 'body',
        use: 'UI, labels, dense tables, tabular numbers',
      },
    ],
    replaces: {
      Manrope: 'Red Hat Display',
      Inter: 'Red Hat Text',
    },
    why: 'Red Hat Display and Red Hat Text are a matched corporate pair built for headings and small UI text respectively, which gives the dependable fintech SaaS look.',
  },
  kitlog: {
    faces: [
      {
        family: 'Onest',
        role: 'display',
        use: 'hero 48-52px regular at -0.025em',
      },
      {
        family: 'Onest',
        role: 'body',
        use: 'body 16px, dense tables 15px, KPI semibold',
      },
    ],
    replaces: {},
    why: 'Onest is already a soft, friendly grotesk that no other template uses, and it suits the paper-toned stockroom ledger.',
  },
  varianceboard: {
    faces: [
      {
        family: 'Schibsted Grotesk',
        role: 'display',
        use: 'display 800-900 at -0.025em, 60px',
      },
      {
        family: 'IBM Plex Sans',
        role: 'body',
        use: 'body 16px',
      },
      {
        family: 'IBM Plex Mono',
        role: 'mono',
        use: 'eyebrows and tabular figures',
      },
    ],
    replaces: {
      'Space Grotesk': 'Schibsted Grotesk',
    },
    why: 'Schibsted Grotesk is a newspaper grotesk with a true black weight for the stark headlines, and the Plex pair keeps the editorial-meets-terminal finance tone.',
  },
  'boardroom-lens': {
    faces: [
      {
        family: 'Bricolage Grotesque',
        role: 'display',
        use: 'title 36-40px bold, sections 20px',
      },
      {
        family: 'Golos Text',
        role: 'body',
        use: 'body 16px, controls 14px, dense tables 15px',
      },
      {
        family: 'Chivo Mono',
        role: 'mono',
        use: 'figures, eyebrows, month pills, ledger IDs',
      },
    ],
    replaces: {
      'Inter Tight': 'Golos Text',
      'JetBrains Mono': 'Chivo Mono',
    },
    why: 'Bricolage Grotesque keeps its characterful title voice; Golos Text is a compact, highly legible body, and Chivo Mono gives the figures an editorial, trading-desk look.',
  },
  payoutly: {
    faces: [
      {
        family: 'Instrument Sans',
        role: 'display',
        use: 'hero 56-60px semibold, H2 36px',
      },
      {
        family: 'Instrument Sans',
        role: 'body',
        use: 'body 16px, teal eyebrows, tabular figures',
      },
    ],
    replaces: {
      Inter: 'Instrument Sans',
    },
    why: 'Instrument Sans is crisp and businesslike but slightly warmer than Inter, a good fit for a finance tool meant to feel approachable to sales teams.',
  },
  conversia: {
    faces: [
      {
        family: 'Readex Pro',
        role: 'display',
        use: 'section titles 18-20px semibold, wordmark',
      },
      {
        family: 'Geologica',
        role: 'body',
        use: 'body 16px, controls 14px',
      },
      {
        family: 'Spline Sans Mono',
        role: 'mono',
        use: 'all numerals and percentages, tabular',
      },
    ],
    replaces: {
      Sora: 'Readex Pro',
      Manrope: 'Geologica',
      'JetBrains Mono': 'Spline Sans Mono',
    },
    why: 'A precise geometric title face, a technical body sans and a clean mono for every number give the machined, lab-instrument feel.',
  },
  churnwatch: {
    faces: [
      {
        family: 'Newsreader',
        role: 'display',
        use: 'titles 28-32px, section heads 24px',
      },
      {
        family: 'Work Sans',
        role: 'body',
        use: 'body 16px, dense tables 15px',
      },
      {
        family: 'IBM Plex Mono',
        role: 'mono',
        use: '12px uppercase labels, figures',
      },
    ],
    replaces: {},
    why: 'Newsreader and Work Sans are already uncommon here, and with Plex Mono they read like a financial newspaper data desk, so the set stays as it is.',
  },
  closerail: {
    faces: [
      {
        family: 'Outfit',
        role: 'display',
        use: 'display 48-56px bold at -0.025em',
      },
      {
        family: 'Outfit',
        role: 'body',
        use: 'body 16-18px at line-height 1.6',
      },
    ],
    replaces: {},
    why: 'Outfit is a rounded geometric sans that makes the CRM feel people-first; it keeps it here while other templates move off it.',
  },
  seatplot: {
    faces: [
      {
        family: 'Plus Jakarta Sans',
        role: 'display',
        use: 'hero 56-60px semibold, H2 36px',
      },
      {
        family: 'Plus Jakarta Sans',
        role: 'body',
        use: 'body 16px at line-height 1.6',
      },
    ],
    replaces: {},
    why: 'The bright, friendly office tool is the most natural home for Plus Jakarta Sans, so it keeps it while most other templates move off it.',
  },
  spendgate: {
    faces: [
      {
        family: 'Arimo',
        role: 'display',
        use: 'H1 30px bold at -0.025em',
      },
      {
        family: 'Arimo',
        role: 'body',
        use: 'body 16px, dense tables 15px, tabular figures',
      },
    ],
    replaces: {
      Inter: 'Arimo',
    },
    why: 'Arimo is metrically compatible with Arial, so it keeps the default, system-stack neutrality of a standard enterprise tool.',
  },
  hubshift: {
    faces: [
      {
        family: 'Jost',
        role: 'display',
        use: 'headings 30/24/20px semibold',
      },
      {
        family: 'Jost',
        role: 'body',
        use: 'body 16px, 12px uppercase divider labels',
      },
    ],
    replaces: {
      'DM Sans': 'Jost',
    },
    why: 'Jost is a Futura-like geometric sans that keeps the sunny, welcoming front door, with more character than DM Sans.',
  },
  shortlister: {
    faces: [
      {
        family: 'Noto Sans',
        role: 'display',
        use: 'product name and headings 20-28px bold',
      },
      {
        family: 'Noto Sans',
        role: 'body',
        use: 'body 16px, dense tables 13px',
      },
    ],
    replaces: {
      Inter: 'Noto Sans',
    },
    why: 'A white-label base that each company rebrands needs the most neutral sans possible, and Noto Sans also covers almost any language a customer might add.',
  },
  billsmith: {
    faces: [
      {
        family: 'Anton',
        role: 'display',
        use: 'uppercase titles 24-40px',
      },
      {
        family: 'Space Mono',
        role: 'body',
        use: 'body 16px, controls 14px, 12px uppercase labels',
      },
    ],
    replaces: {
      'Geist Mono': 'Space Mono',
    },
    why: "Anton keeps the condensed poster voice, and Space Mono has quirky, designed letterforms that suit a designer's invoicing tool better than a plain code mono.",
  },
  plainask: {
    faces: [
      {
        family: 'Mona Sans',
        role: 'display',
        use: 'headings 28-40px semibold',
      },
      {
        family: 'Mona Sans',
        role: 'body',
        use: 'body 16px at line-height 1.5',
      },
      {
        family: 'Fira Code',
        role: 'mono',
        use: 'SQL and figures',
      },
    ],
    replaces: {
      Inter: 'Mona Sans',
      'JetBrains Mono': 'Fira Code',
    },
    why: 'Mona Sans is a calm, controlled grotesk for the slate workspace, and Fira Code is a proven SQL-reading mono, which keeps attention on the data.',
  },
  brieflane: {
    faces: [
      {
        family: 'Sora',
        role: 'display',
        use: 'hero ~64px 700; eyebrows 600 uppercase, 0.28em',
      },
      {
        family: 'Albert Sans',
        role: 'body',
        use: 'body 17px, light gray on black',
      },
    ],
    replaces: {
      Manrope: 'Albert Sans',
    },
    why: 'Sora keeps the geometric display voice; Albert Sans is a clean, slightly humanist body that stays readable in light gray on black.',
  },
  slotwise: {
    faces: [
      {
        family: 'Pathway Extreme',
        role: 'display',
        use: 'hero 40px and section titles 32px, 600, -0.04em',
      },
      {
        family: 'Pathway Extreme',
        role: 'body',
        use: 'body 16px, UI labels 13px 500',
      },
    ],
    replaces: {
      Geist: 'Pathway Extreme',
    },
    why: 'Pathway Extreme is a neutral grotesk with optical sizes, so it takes the aggressive negative tracking on headings and stays crisp in small UI labels.',
  },
  branchwise: {
    faces: [
      {
        family: 'Libre Franklin',
        role: 'display',
        use: 'hero 60px and section titles 48px, 700-800',
      },
      {
        family: 'Libre Franklin',
        role: 'body',
        use: 'body 16px, slate secondary text',
      },
    ],
    replaces: {
      Inter: 'Libre Franklin',
    },
    why: 'Libre Franklin carries the confident, heavy-weight American corporate tone of Franklin Gothic, a better fit for an enterprise SaaS landing page than generic Inter.',
  },
  renewcast: {
    faces: [
      {
        family: 'Montserrat',
        role: 'display',
        use: 'hero 60px 700 (all caps only when 4 words or fewer), section titles 600',
      },
      {
        family: 'Nunito Sans',
        role: 'body',
        use: 'body 16px',
      },
    ],
    replaces: {
      Sora: 'Montserrat',
      Manrope: 'Nunito Sans',
    },
    why: 'Montserrat gives the bold, confident geometric headline, and Nunito Sans is soft and rounded, keeping the clinical claim friendly.',
  },
  bidwell: {
    faces: [
      {
        family: 'Urbanist',
        role: 'display',
        use: 'headlines 800 at 60px, section titles 700 at 36px',
      },
      {
        family: 'Mulish',
        role: 'body',
        use: 'UI copy 16px, slate-gray secondary text',
      },
    ],
    replaces: {
      'Plus Jakarta Sans': 'Urbanist',
      'DM Sans': 'Mulish',
    },
    why: 'Two friendly geometric faces: Urbanist for punchy headlines and the minimal Mulish for readable UI copy, keeping the polished B2B tone.',
  },
  shortlist: {
    faces: [
      {
        family: 'Familjen Grotesk',
        role: 'display',
        use: 'hero 60px 700 with italic second line, section titles 30px',
      },
      {
        family: 'Rethink Sans',
        role: 'body',
        use: 'body 16px, gray secondary',
      },
    ],
    replaces: {
      'Space Grotesk': 'Familjen Grotesk',
      Inter: 'Rethink Sans',
    },
    why: 'Familjen Grotesk is a quirky grotesk that, unlike Space Grotesk, has real italics for the editorial second line; Rethink Sans keeps the body warm and neutral.',
  },
  'sparring-room': {
    faces: [
      {
        family: 'Schibsted Grotesk',
        role: 'display',
        use: 'hero 72px, section titles 60px, 600, -0.02em',
      },
      {
        family: 'Schibsted Grotesk',
        role: 'body',
        use: 'body 16px, spaced uppercase micro-labels',
      },
    ],
    replaces: {
      Inter: 'Schibsted Grotesk',
    },
    why: 'Schibsted Grotesk was drawn for editorial media, so oversized headings on warm paper read like a serious training publication.',
  },
  signoff: {
    faces: [
      {
        family: 'Chivo',
        role: 'display',
        use: 'card titles ~24px, 600-700',
      },
      {
        family: 'Chivo',
        role: 'body',
        use: 'body and UI 14-16px, 400/500',
      },
    ],
    replaces: {
      Inter: 'Chivo',
    },
    why: 'Chivo is a sharp, high-contrast-friendly grotesk with firm weights, suiting a pure-black enterprise console where weight is the only hierarchy.',
  },
  breakeven: {
    faces: [
      {
        family: 'Be Vietnam Pro',
        role: 'display',
        use: 'headline ~56px 700 with italic emphasis word, form headings 30px',
      },
      {
        family: 'Be Vietnam Pro',
        role: 'body',
        use: 'body 16px',
      },
      {
        family: 'B612 Mono',
        role: 'mono',
        use: 'uppercase labels and meta, 12px minimum, 0.2em',
      },
    ],
    replaces: {
      'Plus Jakarta Sans': 'Be Vietnam Pro',
      Inter: 'Be Vietnam Pro',
      'JetBrains Mono': 'B612 Mono',
    },
    why: 'Be Vietnam Pro is a precise, slightly geometric sans with real italics, and B612 Mono was drawn for aircraft cockpits, which reinforces the calculator/engineering precision.',
  },
  creditline: {
    faces: [
      {
        family: 'Epilogue',
        role: 'display',
        use: 'headline ~30px 700, panel titles 600 18px',
      },
      {
        family: 'Commissioner',
        role: 'body',
        use: 'body 14-16px',
      },
      {
        family: 'Inconsolata',
        role: 'mono',
        use: 'numbers, axis ticks, uppercase eyebrows',
      },
    ],
    replaces: {
      Sora: 'Epilogue',
      Manrope: 'Commissioner',
      'JetBrains Mono': 'Inconsolata',
    },
    why: 'A geometric-leaning display grotesk, a humanist body and a narrow tabular mono give the explanatory, data-journalism feel.',
  },
  snippetly: {
    faces: [
      {
        family: 'Figtree',
        role: 'display',
        use: 'hero 40px 600 at -2.4px, quote text 32-40px',
      },
      {
        family: 'Figtree',
        role: 'body',
        use: 'body 16px, UI 13px 500',
      },
    ],
    replaces: {},
    why: 'Figtree fits this airy single-purpose utility well; it stays here while the other templates that used it move to other faces.',
  },
  'relay-desk': {
    faces: [
      {
        family: 'Fraunces',
        role: 'display',
        use: 'hero 72px 400 with italic accent word, section titles 700 40px, card titles',
      },
      {
        family: 'Outfit',
        role: 'body',
        use: 'body 16px, warm gray',
      },
    ],
    replaces: {
      Manrope: 'Outfit',
    },
    why: 'Fraunces keeps the soft, artisan serif voice, and Outfit is a clean, round geometric body that keeps the sunlit-studio warmth.',
  },
  shelfwise: {
    faces: [
      {
        family: 'Overpass',
        role: 'display',
        use: 'hero 52px 600, section titles 30px',
      },
      {
        family: 'Overpass',
        role: 'body',
        use: 'body 16px',
      },
      {
        family: 'Overpass Mono',
        role: 'mono',
        use: 'SKUs and quantities',
      },
    ],
    replaces: {
      Geist: 'Overpass',
      'JetBrains Mono': 'Overpass Mono',
      'Geist Mono': 'Overpass Mono',
      Inter: 'Overpass',
    },
    why: 'Overpass descends from Highway Gothic road signage, apt for logistics, and its matching mono handles SKUs and quantities.',
  },
  tidewatch: {
    faces: [
      {
        family: 'Sofia Sans Semi Condensed',
        role: 'display',
        use: 'titles 15px 600 and panel headings',
      },
      {
        family: 'Sofia Sans Semi Condensed',
        role: 'body',
        use: 'body 14-16px',
      },
      {
        family: 'JetBrains Mono',
        role: 'mono',
        use: 'KPI numerals ~32px, uppercase labels, codes',
      },
    ],
    replaces: {
      Barlow: 'Sofia Sans Semi Condensed',
    },
    why: 'A semi-condensed humanist sans with mono data gives the air-traffic-control feel; JetBrains Mono stays because its tall, open digits carry the KPI numerals.',
  },
  rollcall: {
    faces: [
      {
        family: 'Nunito',
        role: 'display',
        use: 'headings 40px 600 at -2.4px',
      },
      {
        family: 'Nunito',
        role: 'body',
        use: 'body 16px, UI labels 13px, 12px uppercase group labels',
      },
    ],
    replaces: {
      Figtree: 'Nunito',
    },
    why: 'Nunito is a fully rounded sans, which makes the tool feel like a team yearbook rather than HR software.',
  },
  stillpage: {
    faces: [
      {
        family: 'Inclusive Sans',
        role: 'display',
        use: 'title 40px 600, tight tracking',
      },
      {
        family: 'Inclusive Sans',
        role: 'body',
        use: 'entry text 16px, relaxed line height',
      },
      {
        family: 'Newsreader',
        role: 'accent',
        use: 'optional serif for entry text in the editor',
      },
    ],
    replaces: {
      Inter: 'Inclusive Sans',
    },
    why: 'Inclusive Sans is quiet and very legible, with a soft personal tone, so the writing stays the focus of the evening journal.',
  },
  stagecraft: {
    faces: [
      {
        family: 'IBM Plex Sans',
        role: 'display',
        use: 'title slides 88px 700, slide headings 44px',
      },
      {
        family: 'IBM Plex Sans',
        role: 'body',
        use: 'body 16px',
      },
      {
        family: 'IBM Plex Mono',
        role: 'mono',
        use: 'labels and data',
      },
    ],
    replaces: {},
    why: 'The Plex sans and mono pair is the engineered voice this code-driven slide tool is built around, and few other templates use it.',
  },
  trailmap: {
    faces: [
      {
        family: 'Cabin',
        role: 'display',
        use: 'headings 48px 700, section titles 30px',
      },
      {
        family: 'Cabin',
        role: 'body',
        use: 'body 16px, italic for the testimonial',
      },
    ],
    replaces: {
      Figtree: 'Cabin',
    },
    why: 'Cabin is a friendly, slightly humanist geometric sans with a true italic, calm enough to let the watercolour illustration lead.',
  },
  ballotbox: {
    faces: [
      {
        family: 'Manrope',
        role: 'display',
        use: 'headings 56px 700 at -1.12px',
      },
      {
        family: 'Manrope',
        role: 'body',
        use: 'body 16px at an intermediate ~460 weight',
      },
    ],
    replaces: {},
    why: "The design relies on Manrope's variable weight for its richer body color, so it keeps Manrope while most other templates move off it.",
  },
  jotworks: {
    faces: [
      {
        family: 'Google Sans Flex',
        role: 'display',
        use: 'hero 128px 800, CTA heading ~64px',
      },
      {
        family: 'Google Sans Flex',
        role: 'body',
        use: 'body 16px, testimonials',
      },
    ],
    replaces: {
      'Plus Jakarta Sans': 'Google Sans Flex',
      Figtree: 'Google Sans Flex',
    },
    why: 'Google Sans Flex is already unique in the catalog, and its rounded, flexible weights make the bold, friendly consumer voice.',
  },
  cellwright: {
    faces: [
      {
        family: 'Fira Sans',
        role: 'display',
        use: 'headings 60px 600-700 at -1.5px',
      },
      {
        family: 'Fira Sans',
        role: 'body',
        use: 'UI and body 16px',
      },
      {
        family: 'Fira Mono',
        role: 'mono',
        use: 'grid cells and formulas',
      },
    ],
    replaces: {
      'JetBrains Mono': 'Fira Mono',
    },
    why: 'Fira Sans and Fira Mono are a plain, utilitarian pair made for software interfaces, which keeps the tool feeling native and fast with clear data in the grid.',
  },
  tomatick: {
    faces: [
      {
        family: 'Sora',
        role: 'display',
        use: 'countdown ~72px 800, tabular figures',
      },
      {
        family: 'Sora',
        role: 'body',
        use: 'UI 13-16px, 400-500',
      },
    ],
    replaces: {
      'Plus Jakarta Sans': 'Sora',
    },
    why: "Sora's wide, geometric numerals make the huge countdown read at a glance, and they stay friendly at small UI sizes.",
  },
  plainwrite: {
    faces: [
      {
        family: 'Geist',
        role: 'display',
        use: 'headings 70px 600 at -2.1px, section heads 32px',
      },
      {
        family: 'Geist',
        role: 'body',
        use: 'body 16px, UI 13px',
      },
      {
        family: 'Sometype Mono',
        role: 'mono',
        use: 'counts',
      },
    ],
    replaces: {
      'Geist Mono': 'Sometype Mono',
    },
    why: "Geist's calm, monochrome precision is the brand of this writing app, and few templates use it, so it stays.",
  },
  shipyard: {
    faces: [
      {
        family: 'Archivo',
        role: 'display',
        use: 'hero 112px 600 at -0.04em, section heads 48px 700',
      },
      {
        family: 'Archivo',
        role: 'body',
        use: 'body 16px, uppercase tracked stat captions',
      },
      {
        family: 'Martian Mono',
        role: 'mono',
        use: 'ticket keys',
      },
    ],
    replaces: {
      Inter: 'Archivo',
      'JetBrains Mono': 'Martian Mono',
    },
    why: 'Archivo is a sturdy grotesk that keeps its punch at keynote scale, and Martian Mono gives ticket keys an engineering look without the usual code mono.',
  },
  swimlane: {
    faces: [
      {
        family: 'Parkinsans',
        role: 'display',
        use: 'headline 70px 600 at -2.1px',
      },
      {
        family: 'Parkinsans',
        role: 'body',
        use: 'card text 13-16px',
      },
    ],
    replaces: {
      Figtree: 'Parkinsans',
    },
    why: "Parkinsans is a friendly, slightly quirky geometric sans that matches the candy-pink board's upbeat mood better than a neutral face.",
  },
  lookback: {
    faces: [
      {
        family: 'Hanken Grotesk',
        role: 'display',
        use: 'headings 56px 700 at -0.04em',
      },
      {
        family: 'Hanken Grotesk',
        role: 'body',
        use: 'body 16px, gray secondary',
      },
    ],
    replaces: {
      'Schibsted Grotesk': 'Hanken Grotesk',
      'Inter Tight': 'Hanken Grotesk',
    },
    why: 'Hanken Grotesk is a tight, candid grotesk close to Camera Plain, heavy enough for the headlines and plain enough to let the doodles bring the warmth.',
  },
  hueprint: {
    faces: [
      {
        family: 'Playfair',
        role: 'display',
        use: 'display 112px at 300, italic accent word, never below 40px',
      },
      {
        family: 'Libre Baskerville',
        role: 'body',
        use: 'body 16px',
      },
      {
        family: 'Courier Prime',
        role: 'mono',
        use: '12px uppercase UI labels and buttons, ~0.22em',
      },
    ],
    replaces: {
      'Cormorant Garamond': 'Playfair',
    },
    why: "Playfair's variable optical sizes give a delicate, high-contrast light display with italics, while Libre Baskerville and Courier Prime keep the washi-and-ink studio notebook.",
  },
  cutbench: {
    faces: [
      {
        family: 'Space Grotesk',
        role: 'display',
        use: 'hero 72px 700, section heads 36px',
      },
      {
        family: 'Space Grotesk',
        role: 'body',
        use: 'body 16-18px, gray secondary',
      },
    ],
    replaces: {},
    why: 'The quirky tech/creator grotesk is the core of this night-mode studio, so Space Grotesk stays here while most other templates move off it.',
  },
  driftbox: {
    faces: [
      {
        family: 'Golos Text',
        role: 'display',
        use: 'headings 60px 700 at -1.5px, section heads 48px',
      },
      {
        family: 'Golos Text',
        role: 'body',
        use: 'body 16px',
      },
    ],
    replaces: {
      Inter: 'Golos Text',
    },
    why: 'Golos Text is a calm, neutral grotesk with slightly softer shapes than Inter, which fits the warm near-white productivity suite.',
  },
  cadenza: {
    faces: [
      {
        family: 'Lato',
        role: 'display',
        use: 'headlines 40px 700 at -2.4px',
      },
      {
        family: 'Karla',
        role: 'body',
        use: 'body 16px, UI 13px',
      },
    ],
    replaces: {
      Inter: 'Karla',
    },
    why: 'Lato stays for its humanist headlines, and Karla is a grotesk with a little more character than Inter, suiting the warm paper-toned workspace.',
  },
  steadyline: {
    faces: [
      {
        family: 'Nunito Sans',
        role: 'display',
        use: 'hero 60px 700 at -1.5px, section heads 36px',
      },
      {
        family: 'Nunito Sans',
        role: 'body',
        use: 'body 16px at 1.6, 12px uppercase eyebrows',
      },
    ],
    replaces: {
      'Plus Jakarta Sans': 'Nunito Sans',
    },
    why: 'Nunito Sans has soft, rounded terminals that make the planner feel like a cozy morning ritual rather than a productivity machine.',
  },
  glyphshelf: {
    faces: [
      {
        family: 'Inter',
        role: 'display',
        use: 'page titles 48px 700 at -0.02em',
      },
      {
        family: 'Inter',
        role: 'body',
        use: 'body 16px, meta 12px gray',
      },
    ],
    replaces: {
      'DM Sans': 'Inter',
    },
    why: "The font-specimen browser needs the most characterless UI face so the specimens carry all the personality, which is exactly Inter's job; it is one of few templates that keep it.",
  },
  pinwall: {
    faces: [
      {
        family: 'Albert Sans',
        role: 'display',
        use: 'headline 96px 600 at -0.05em',
      },
      {
        family: 'Albert Sans',
        role: 'body',
        use: 'body 16px',
      },
    ],
    replaces: {},
    why: 'Albert Sans is a clean grotesk no other template leads with, and it stays out of the way of the photos on the white wall.',
  },
  billwise: {
    faces: [
      {
        family: 'Sofia Sans Semi Condensed',
        role: 'display',
        use: 'headings 72-80px 700, tight leading',
      },
      {
        family: 'Sofia Sans Semi Condensed',
        role: 'body',
        use: 'body 16-18px, slate gray',
      },
    ],
    replaces: {
      'Inter Tight': 'Sofia Sans Semi Condensed',
    },
    why: 'A condensed-leaning grotesk with heavy weights keeps the polished, candy-gradient SaaS look in a face used only once elsewhere.',
  },
  murmur: {
    faces: [
      {
        family: 'Unbounded',
        role: 'display',
        use: 'headlines 900, uppercase for short ones, ~110px hero, 48px sections',
      },
      {
        family: 'Archivo Black',
        role: 'display',
        use: 'the named alternative heavy display for short headlines',
      },
      {
        family: 'Work Sans',
        role: 'body',
        use: 'body 18-20px, black',
      },
      {
        family: 'Spline Sans Mono',
        role: 'mono',
        use: 'tags and chips',
      },
    ],
    replaces: {
      Inter: 'Work Sans',
      'Space Mono': 'Spline Sans Mono',
    },
    why: 'Unbounded and Archivo Black keep the ultra-heavy neo-brutalist display, Work Sans is a slightly wider, friendlier body than Inter, and Spline Sans Mono covers the tags.',
  },
  northstar: {
    faces: [
      {
        family: 'Fira Sans Condensed',
        role: 'display',
        use: 'headings 40px 600 at -0.06em',
      },
      {
        family: 'Red Hat Mono',
        role: 'body',
        use: 'body and UI copy',
      },
    ],
    replaces: {
      Barlow: 'Fira Sans Condensed',
      'Geist Mono': 'Red Hat Mono',
      'JetBrains Mono': 'Red Hat Mono',
    },
    why: 'Fira Sans Condensed gives the condensed grotesk headline, and the rounded Red Hat Mono keeps the monospace body calm and ocean-toned rather than hard-edged.',
  },
  glimpse: {
    faces: [
      {
        family: 'Miranda Sans',
        role: 'display',
        use: 'headings 60px 600 at -0.03em',
      },
      {
        family: 'Miranda Sans',
        role: 'body',
        use: 'body 16-18px',
      },
      {
        family: 'Satisfy',
        role: 'script',
        use: 'handwritten wordmark only',
      },
    ],
    replaces: {
      'Mr Dafoe': 'Satisfy',
      Figtree: 'Miranda Sans',
      Caveat: 'Satisfy',
    },
    why: 'Miranda Sans is already unique and friendly; Satisfy supplies the handwritten logotype the design calls for.',
  },
  keyhollow: {
    faces: [
      {
        family: 'Unbounded',
        role: 'display',
        use: 'headings 72px 500, wide, sentence case',
      },
      {
        family: 'Public Sans',
        role: 'body',
        use: 'UI and body 16px, slate',
      },
    ],
    replaces: {
      Inter: 'Public Sans',
      Syne: 'Unbounded',
    },
    why: 'Unbounded stands in for the wide geometric Clash Display on Google Fonts, and Public Sans keeps the marketplace UI trustworthy and plain.',
  },
  roundup: {
    faces: [
      {
        family: 'Roboto Flex',
        role: 'display',
        use: 'page titles 40px 600',
      },
      {
        family: 'Roboto Flex',
        role: 'body',
        use: 'body 16px, dense lists 15px',
      },
    ],
    replaces: {
      Inter: 'Roboto Flex',
    },
    why: 'Roboto Flex feels native like a system font while its width and grade axes keep dense research lists crisp.',
  },
  signet: {
    faces: [
      {
        family: 'Rethink Sans',
        role: 'display',
        use: 'two-line headline 36px 700',
      },
      {
        family: 'Sen',
        role: 'body',
        use: 'list items and UI 16px, line-height 1.5',
      },
    ],
    replaces: {
      Inter: 'Rethink Sans',
      'Space Grotesk': 'Sen',
    },
    why: 'Rethink Sans gives clean, friendly headings and Sen has a little geometric quirk in the body, keeping the tidy-but-personal signature utility.',
  },
  wayfarer: {
    faces: [
      {
        family: 'Chivo',
        role: 'display',
        use: 'headlines 120px 900, uppercase, -2px',
      },
      {
        family: 'Lora',
        role: 'body',
        use: 'body and quotes 18px, italic wordmark',
      },
    ],
    replaces: {
      'Archivo Black': 'Chivo',
      Anton: 'Chivo',
    },
    why: "Chivo's black weight stands in for the Supreme-style brutal caps, and Lora keeps the warm, bookish serif of a retro travel poster.",
  },
  snip: {
    faces: [
      {
        family: 'Be Vietnam Pro',
        role: 'display',
        use: 'headline 70px 600 at -0.03em',
      },
      {
        family: 'Be Vietnam Pro',
        role: 'body',
        use: 'body 16px',
      },
    ],
    replaces: {
      Figtree: 'Be Vietnam Pro',
    },
    why: 'Be Vietnam Pro is crisp and a little geometric, which suits the fast, uncluttered utility with its blue signature.',
  },
  marginalia: {
    faces: [
      {
        family: 'Spectral',
        role: 'display',
        use: 'masthead 96px 300, essay titles 36px, quarter-card titles 24px at 500',
      },
      {
        family: 'Ysabeau Office',
        role: 'body',
        use: 'body 16-18px, 12px uppercase labels',
      },
    ],
    replaces: {
      'Cormorant Garamond': 'Spectral',
      Inter: 'Ysabeau Office',
    },
    why: 'Spectral is a delicate, light literary serif for the masthead, and Ysabeau Office is a Garamond-derived sans that keeps the metadata soft, like a printed zine.',
  },
  afterglow: {
    faces: [
      {
        family: 'Epilogue',
        role: 'display',
        use: 'wordmark ~30px in gold, review titles 56px',
      },
      {
        family: 'Epilogue',
        role: 'body',
        use: 'body 16px light gray, 12px meta',
      },
    ],
    replaces: {
      Inter: 'Epilogue',
    },
    why: 'Epilogue is a neutral grotesk with a slightly cinematic, wide-set rhythm that stays quiet so the posters provide the drama.',
  },
  'long-take': {
    faces: [
      {
        family: 'Geologica',
        role: 'display',
        use: 'review headlines 500-700, tight; wordmark 18px',
      },
      {
        family: 'Geologica',
        role: 'body',
        use: 'body 16-18px',
      },
    ],
    replaces: {
      Inter: 'Geologica',
    },
    why: 'Geologica is a stark, precise grotesk that reads like a high-end print magazine when set large and tight in monochrome.',
  },
  saltcellar: {
    faces: [
      {
        family: 'Antonio',
        role: 'display',
        use: 'hero ~117px uppercase, card titles 28px uppercase',
      },
      {
        family: 'Work Sans',
        role: 'body',
        use: 'body 16px/1.6, 12px uppercase dates',
      },
    ],
    replaces: {
      'Bebas Neue': 'Antonio',
      Inter: 'Work Sans',
    },
    why: 'Antonio is a refined condensed poster sans with several weights, and Work Sans is an open, friendly body, keeping the glossy food-magazine punch.',
  },
  plinth: {
    faces: [
      {
        family: 'Mulish',
        role: 'display',
        use: 'headings ~60px 600, tight leading',
      },
      {
        family: 'Mulish',
        role: 'body',
        use: 'body 16-18px, tall 2x line-height, uppercase tracked labels',
      },
    ],
    replaces: {},
    why: 'Mulish is a minimal, airy geometric sans with a Scandinavian softness that suits pastel architecture.',
  },
  'dogear-weekly': {
    faces: [
      {
        family: 'Montserrat',
        role: 'display',
        use: 'headlines 72px 900 at -0.05em',
      },
      {
        family: 'Source Sans 3',
        role: 'body',
        use: 'body 16-18px gray',
      },
    ],
    replaces: {
      Inter: 'Source Sans 3',
    },
    why: 'Montserrat stays for the ultra-black geometric cover lines, and Source Sans 3 is a quiet humanist body that reads well in the bento cards.',
  },
  slabwork: {
    faces: [
      {
        family: 'Familjen Grotesk',
        role: 'display',
        use: 'hero title 34-36px 700, card titles 18-20px',
      },
      {
        family: 'Familjen Grotesk',
        role: 'body',
        use: 'body 16px, 12px uppercase meta',
      },
    ],
    replaces: {
      'DM Sans': 'Familjen Grotesk',
    },
    why: 'Familjen Grotesk is a structured grotesk with a slightly raw edge, which suits the square, brutalist-leaning chrome around the photos.',
  },
  stillwater: {
    faces: [
      {
        family: 'Merriweather',
        role: 'display',
        use: 'headlines 56px 600, nav and buttons',
      },
      {
        family: 'Nunito Sans',
        role: 'body',
        use: 'body 18px, warm gray',
      },
    ],
    replaces: {
      Inter: 'Nunito Sans',
    },
    why: "Merriweather stays for the bookish warmth, and the rounded Nunito Sans echoes the café notebook's soft forms.",
  },
  hemline: {
    faces: [
      {
        family: 'Dela Gothic One',
        role: 'display',
        use: 'masthead 120px and card titles ~56px, uppercase',
      },
      {
        family: 'Libre Caslon Text',
        role: 'body',
        use: 'body 18px',
      },
    ],
    replaces: {
      Lora: 'Libre Caslon Text',
    },
    phrases: {
      'a heavy grotesk (e.g. Archivo 800 or Familjen Grotesk, sans-serif fallback)':
        'a heavy display face (Dela Gothic One, with a sans-serif fallback)',
    },
    why: 'Dela Gothic One is a heavy, playful poster sans for the candy zine masthead, and Libre Caslon Text gives the serious, bookish body the design contrasts it with.',
  },
  'driftwood-press': {
    faces: [
      {
        family: 'Lexend Zetta',
        role: 'display',
        use: 'masthead ~184px 600, card titles 26px bold',
      },
      {
        family: 'Archivo',
        role: 'body',
        use: 'intro 20px, body, 12px uppercase dates',
      },
    ],
    replaces: {
      Syne: 'Lexend Zetta',
    },
    why: 'Lexend Zetta is a very wide geometric sans that stands in for Clash Display on the night-black masthead, over plain Archivo text.',
  },
  'switchback-atlas': {
    faces: [
      {
        family: 'Alegreya',
        role: 'display',
        use: 'hero 72px 700 italic, section heads 36px',
      },
      {
        family: 'Alegreya Sans',
        role: 'body',
        use: 'body 16px, 12px uppercase eyebrows',
      },
    ],
    replaces: {
      'Cormorant Garamond': 'Alegreya',
      'DM Sans': 'Alegreya Sans',
    },
    why: "Alegreya's calligraphic italic has the wanderer's-handwriting romance, and its sans sibling keeps the travel details clean.",
  },
  'crumb-and-co': {
    faces: [
      {
        family: 'Fredoka',
        role: 'display',
        use: 'headings 70px 600 at -0.03em',
      },
      {
        family: 'Mulish',
        role: 'body',
        use: 'menus, prices, body 16px',
      },
    ],
    replaces: {
      Inter: 'Mulish',
    },
    why: 'Fredoka keeps the rounded bakery warmth, and Mulish is a soft, clear body for menus and prices.',
  },
  givebid: {
    faces: [
      {
        family: 'Commissioner',
        role: 'display',
        use: 'headings 60px 800 at -0.025em, over photos',
      },
      {
        family: 'Commissioner',
        role: 'body',
        use: 'body 16-18px',
      },
      {
        family: 'Roboto Mono',
        role: 'mono',
        use: 'money and countdown numerals',
      },
    ],
    replaces: {
      Inter: 'Commissioner',
      'JetBrains Mono': 'Roboto Mono',
    },
    why: "Commissioner is a warm, community-minded humanist grotesk with strong heavy weights, and Roboto Mono's plain tabular figures signal trust in the numbers.",
  },
  'daybreak-roasters': {
    faces: [
      {
        family: 'Fredoka',
        role: 'display',
        use: 'giant uppercase marquee words 80px+, wordmark 20px',
      },
      {
        family: 'Fredoka',
        role: 'body',
        use: 'body 16px cream, line-height 1.6',
      },
    ],
    replaces: {
      Inter: 'Fredoka',
    },
    why: 'The design asks for one rounded, friendly face everywhere, so Fredoka takes the body too and gives the dark roast brand its bubbly personality.',
  },
  aurelle: {
    faces: [
      {
        family: 'Josefin Sans',
        role: 'display',
        use: 'thin uppercase wordmark ~32px at 300',
      },
      {
        family: 'Josefin Sans',
        role: 'body',
        use: 'descriptions 16px, product names and prices 14px',
      },
    ],
    replaces: {
      'DM Sans': 'Josefin Sans',
    },
    why: 'Josefin Sans has elegant, wide geometric capitals with a vintage-fashion feel, ideal for a restrained luxury lookbook.',
  },
  fernwool: {
    faces: [
      {
        family: 'Lato',
        role: 'display',
        use: 'hero 96px 300, +2.4px tracking; section heads 36px',
      },
      {
        family: 'Lato',
        role: 'body',
        use: 'body 16px/1.6, 12px uppercase nav',
      },
    ],
    replaces: {
      Inter: 'Lato',
      Karla: 'Lato',
    },
    why: "Lato's light weights are warm and semi-rounded, giving the gentle, crafted autumn label without any decorative face.",
  },
  hearthwick: {
    faces: [
      {
        family: 'Bodoni Moda',
        role: 'display',
        use: 'hero 128px 500 with italic second line, section heads 60px',
      },
      {
        family: 'Figtree',
        role: 'body',
        use: 'body 16px/1.6, 12px uppercase eyebrows',
      },
    ],
    replaces: {
      'Cormorant Garamond': 'Bodoni Moda',
      Inter: 'Figtree',
    },
    why: 'Bodoni Moda is an elegant, high-contrast serif with italics for quiet luxury, and Figtree is a clean, friendly body.',
  },
  quietroom: {
    faces: [
      {
        family: 'Raleway',
        role: 'display',
        use: 'headline 128px 300, uppercase, 0.15em',
      },
      {
        family: 'Raleway',
        role: 'body',
        use: 'body 16-18px',
      },
    ],
    replaces: {
      Inter: 'Raleway',
      Jost: 'Raleway',
    },
    why: "Raleway's light, wide-set capitals give the hushed exhibition wall-text feel, and it is legible at body sizes.",
  },
  kilnlight: {
    faces: [
      {
        family: 'Noto Serif Display',
        role: 'display',
        use: 'hero up to 256px at 500, -2.5% tracking',
      },
      {
        family: 'Instrument Sans',
        role: 'body',
        use: 'body 16px, 14px uppercase nav',
      },
    ],
    replaces: {
      'Playfair Display': 'Noto Serif Display',
      Inter: 'Instrument Sans',
    },
    why: 'Noto Serif Display is a high-contrast, didone-like display serif that looks dramatic at huge sizes, set against the quiet, neutral Instrument Sans for utility text.',
  },
  'hardline-depot': {
    faces: [
      {
        family: 'Anton',
        role: 'display',
        use: 'hero 112px uppercase, section heads 48px',
      },
      {
        family: 'Arimo',
        role: 'body',
        use: 'UI 16px, 12px uppercase captions',
      },
      {
        family: 'Source Serif 4',
        role: 'accent',
        use: 'product descriptions only',
      },
    ],
    replaces: {
      Inter: 'Arimo',
    },
    why: 'Anton keeps the raw condensed poster caps, Arimo has the Helvetica-like proportions of a Swiss catalog, and Source Serif 4 stays for the editorial product copy.',
  },
  rushcut: {
    faces: [
      {
        family: 'Roboto',
        role: 'display',
        use: 'hero 40px 500 at -1px, price 64px',
      },
      {
        family: 'Roboto',
        role: 'body',
        use: 'body 16px, muted gray',
      },
    ],
    replaces: {
      Inter: 'Roboto',
      Geist: 'Roboto',
    },
    why: 'Roboto is a true system UI face, so the monochrome black stage stays neutral and lets the course thumbnails bring the color.',
  },
  'plain-matter': {
    faces: [
      {
        family: 'Roboto Mono',
        role: 'display',
        use: 'headings and nav 14px uppercase, 0.06em',
      },
      {
        family: 'Roboto Mono',
        role: 'body',
        use: 'body 16px, nav and labels 14px',
      },
    ],
    replaces: {
      'JetBrains Mono': 'Roboto Mono',
    },
    why: 'Roboto Mono already defines this label-maker voice, so the fallback is folded into it and the archival, clinical feel stays.',
  },
  'inkstand-courier': {
    faces: [
      {
        family: 'UnifrakturMaguntia',
        role: 'display',
        use: 'nameplate only, 72px',
      },
      {
        family: 'Libre Bodoni',
        role: 'display',
        use: 'headlines and uppercase section heads 700',
      },
      {
        family: 'Roboto Slab',
        role: 'body',
        use: 'body and meta 16px',
      },
    ],
    replaces: {
      'Playfair Display': 'Libre Bodoni',
    },
    why: 'Blackletter nameplate, a true Bodoni for headlines and a slab body reproduce the traditional broadsheet hierarchy.',
  },
  brightwire: {
    faces: [
      {
        family: 'Bebas Neue',
        role: 'display',
        use: 'nameplate 48px, promo headings, condensed caps',
      },
      {
        family: 'Schibsted Grotesk',
        role: 'body',
        use: 'headlines 700 at -0.02em, body 16px, kickers',
      },
    ],
    replaces: {
      Inter: 'Schibsted Grotesk',
    },
    why: 'Bebas Neue keeps the tabloid-caps punch, and Schibsted Grotesk was built for a news publisher, so headlines and body read as a contemporary daily.',
  },
  blockwise: {
    faces: [
      {
        family: 'Outfit',
        role: 'display',
        use: 'headlines 700, lead 30px, cards 20px',
      },
      {
        family: 'Public Sans',
        role: 'body',
        use: 'body 16px, muted gray excerpts',
      },
    ],
    replaces: {
      Inter: 'Public Sans',
    },
    why: 'Outfit keeps the neighborly rounded headlines, and Public Sans, drawn for civic websites, makes long local reads comfortable.',
  },
  'tessellate-lab': {
    faces: [
      {
        family: 'Red Hat Text',
        role: 'display',
        use: 'hero 60px 700 at -0.04em, section heads 36px',
      },
      {
        family: 'Red Hat Text',
        role: 'body',
        use: 'body 16px',
      },
      {
        family: 'JetBrains Mono',
        role: 'mono',
        use: 'dates, DOIs and counts',
      },
    ],
    replaces: {
      Inter: 'Red Hat Text',
    },
    why: 'Red Hat Text is a sturdy, open sans with an institutional authority that still reads warmly to students, and the mono nods to data and code.',
  },
  'northpoint-dispatch': {
    faces: [
      {
        family: 'Urbanist',
        role: 'display',
        use: 'hero headline 36px 700, card titles 18px',
      },
      {
        family: 'Urbanist',
        role: 'body',
        use: 'body 16px, 13px meta',
      },
    ],
    replaces: {},
    why: 'Urbanist is a clean geometric sans close to Satoshi, which keeps the resource center modern and SaaS-like.',
  },
  'clearing-house-weekly': {
    faces: [
      {
        family: 'Archivo',
        role: 'display',
        use: 'nameplate 900, headlines 700 at 36-44px',
      },
      {
        family: 'Asap',
        role: 'body',
        use: 'body 16px, 12px bold uppercase kickers',
      },
    ],
    replaces: {
      Inter: 'Asap',
    },
    why: 'Archivo keeps the no-nonsense heavy business voice, and Asap is a softer humanist body like Ranade, readable over long analysis.',
  },
  'loam-quarterly': {
    faces: [
      {
        family: 'Literata',
        role: 'display',
        use: 'nameplate and headlines 700, italic bylines',
      },
      {
        family: 'Karla',
        role: 'body',
        use: 'UI, labels and meta 12-16px',
      },
    ],
    replaces: {
      Inter: 'Karla',
    },
    why: 'Literata stays as the bookish serif, and Karla is a gentle grotesk that feels at home on uncoated stock.',
  },
  'ashgrove-herald': {
    faces: [
      {
        family: 'Playfair Display',
        role: 'display',
        use: 'nameplate 900 caps, headlines 700, italic section titles',
      },
      {
        family: 'Source Sans 3',
        role: 'body',
        use: 'body 16px, 12px uppercase labels',
      },
      {
        family: 'Lora',
        role: 'accent',
        use: 'italic bylines',
      },
    ],
    replaces: {
      Playfair: 'Playfair Display',
    },
    why: 'A heritage newspaper is the right home for Playfair Display\'s black caps; Source Sans 3 and Lora italics are unchanged. "Playfair" in the text means Playfair Display.',
  },
  gatherbox: {
    faces: [
      {
        family: 'Host Grotesk',
        role: 'display',
        use: 'boxed words 48-64px 500 at -6%',
      },
      {
        family: 'Host Grotesk',
        role: 'body',
        use: 'body 16-18px, 12px uppercase labels',
      },
    ],
    replaces: {
      'Space Grotesk': 'Host Grotesk',
    },
    why: "Host Grotesk is already the design's quirky grotesk, so the Space Grotesk fallback is folded into it.",
  },
  rsvpkit: {
    faces: [
      {
        family: 'Bricolage Grotesque',
        role: 'display',
        use: 'hero 68px 700 at -3.5%, italic pink emphasis, section heads 48px',
      },
      {
        family: 'DM Sans',
        role: 'body',
        use: 'body 16px, 12px buttons, pink eyebrows',
      },
    ],
    replaces: {},
    why: 'Bricolage Grotesque and DM Sans already form the festive, friendly pairing this invitation tool needs, and few other templates use them together.',
  },
  'rootline-commons': {
    faces: [
      {
        family: 'Nunito',
        role: 'display',
        use: 'hero 72px 700, slight negative tracking',
      },
      {
        family: 'Signika',
        role: 'body',
        use: 'body 16px, 14px uppercase buttons at +0.15em',
      },
    ],
    replaces: {
      Inter: 'Signika',
    },
    why: 'Nunito keeps the rounded, neighborly headline, and Signika is a soft, low-contrast humanist body that feels like a café noticeboard.',
  },
  fernhollow: {
    faces: [
      {
        family: 'Cormorant Garamond',
        role: 'display',
        use: 'names 128px at 300, section heads 72px, 500 italic accents',
      },
      {
        family: 'Montserrat',
        role: 'body',
        use: 'body 16px, 12-14px uppercase labels at 0.2em',
      },
    ],
    replaces: {
      Cormorant: 'Cormorant Garamond',
    },
    why: 'An airy high-contrast Garamond with a geometric sans in tracked caps is exactly this wedding magazine spread, and the pairing appears nowhere else.',
  },
  'pressed-petal': {
    faces: [
      {
        family: 'Libre Bodoni',
        role: 'display',
        use: 'headlines 96px 400 in charcoal, 500 italic accents',
      },
      {
        family: 'Rosario',
        role: 'body',
        use: 'body 16px charcoal, 12px tracked uppercase labels',
      },
    ],
    replaces: {
      'Playfair Display': 'Libre Bodoni',
      Inter: 'Rosario',
    },
    why: 'Libre Bodoni is a classic, slightly old-fashioned high-contrast serif that reads like a printed keepsake, and Rosario is a soft humanist sans for the serene scrapbook.',
  },
  'mesa-lantern': {
    faces: [
      {
        family: 'Great Vibes',
        role: 'script',
        use: 'couple names and monogram only, up to 128px',
      },
      {
        family: 'EB Garamond',
        role: 'display',
        use: 'section heads 36px and date line',
      },
      {
        family: 'Open Sans',
        role: 'body',
        use: 'body 16px, tracked uppercase nav',
      },
    ],
    replaces: {
      'Cormorant Garamond': 'EB Garamond',
    },
    why: "Great Vibes stays for the couple's names; EB Garamond is a warmer, sturdier classic serif for structure, and Open Sans keeps logistics clear.",
  },
  'makers-forum-26': {
    faces: [
      {
        family: 'Libre Franklin',
        role: 'display',
        use: 'hero 96px 500 at -4%, section heads 48px',
      },
      {
        family: 'Libre Franklin',
        role: 'body',
        use: 'body 16px',
      },
      {
        family: 'DM Mono',
        role: 'mono',
        use: 'ticker, buttons, table headers and meta, uppercase +0.2em',
      },
    ],
    replaces: {},
    why: 'Libre Franklin and DM Mono already make the sturdy, crafted builder tone, and neither is overused, so the set stays.',
  },
  'devharbor-live': {
    faces: [
      {
        family: 'Baloo 2',
        role: 'display',
        use: 'headlines 48-60px 700',
      },
      {
        family: 'Nunito',
        role: 'body',
        use: 'body 18px; also the named alternative display face',
      },
      {
        family: 'JetBrains Mono',
        role: 'mono',
        use: 'credits, durations and labels, uppercase +0.08em',
      },
    ],
    replaces: {
      Inter: 'Nunito',
    },
    why: 'Baloo 2 keeps the friendly heavy display, Nunito takes the body so the rounded warmth carries through, and JetBrains Mono gives the developer-event metadata.',
  },
  sunfade: {
    faces: [
      {
        family: 'Fraunces',
        role: 'display',
        use: 'names 96px 400, section heads 48px, italic for quotes',
      },
      {
        family: 'Quicksand',
        role: 'body',
        use: 'body 16px, 12px tracked uppercase labels',
      },
    ],
    replaces: {
      'Playfair Display': 'Fraunces',
      Nunito: 'Quicksand',
    },
    why: 'Fraunces has the soft, 1970s-flavored serif of vintage stationery, and Quicksand is a rounded sans that keeps the sweet, sunlit tone.',
  },
  vernissage: {
    faces: [
      {
        family: 'Instrument Serif',
        role: 'display',
        use: 'names ~100px and section heads 72px, italic',
      },
      {
        family: 'Space Mono',
        role: 'body',
        use: 'body 16px; 12px uppercase nav and buttons at 0.3em',
      },
    ],
    replaces: {},
    why: 'The condensed editorial serif against a typewriter mono is the museum-catalog idea itself, and this pairing is unique in the catalog.',
  },
  hollerday: {
    faces: [
      {
        family: 'Bodoni Moda',
        role: 'display',
        use: 'names 128px 900 uppercase at -2.5%, italic ampersand, two-tone section heads',
      },
      {
        family: 'Rubik',
        role: 'body',
        use: 'body 16px, red tracked uppercase eyebrows',
      },
    ],
    replaces: {
      'Playfair Display': 'Bodoni Moda',
      Inter: 'Rubik',
    },
    why: "Bodoni Moda's black weight gives a sharper, louder didone for gig-poster caps, and Rubik's slightly rounded grotesk keeps the jokes cheerful and readable.",
  },
  glossbound: {
    faces: [
      {
        family: 'Noto Serif Display',
        role: 'display',
        use: 'hero names 128px 400, section titles 60px, italic year',
      },
      {
        family: 'Jost',
        role: 'body',
        use: 'body 16px, tracked uppercase labels',
      },
    ],
    replaces: {
      'Playfair Display': 'Noto Serif Display',
      Inter: 'Jost',
    },
    why: 'Noto Serif Display is a dramatic high-contrast serif with italics for a bridal cover, and Jost is a tidy geometric sans for details.',
  },
  quillmoor: {
    faces: [
      {
        family: 'Cormorant Garamond',
        role: 'display',
        use: 'names 72px 300 at +1.8px, section heads 48px, italic seasons and quotes',
      },
      {
        family: 'Lora',
        role: 'body',
        use: 'centered prose 16-17px',
      },
    ],
    replaces: {},
    why: 'The display Garamond with Lora is already a quiet, bookish all-serif pair; the notes name "display Garamond", so it stays.',
  },
  groundplan: {
    faces: [
      {
        family: 'Barlow',
        role: 'display',
        use: 'hero 48px 700, section heads 36px',
      },
      {
        family: 'Barlow',
        role: 'body',
        use: 'body 16-18px slate',
      },
      {
        family: 'Chivo Mono',
        role: 'mono',
        use: 'dollar figures',
      },
    ],
    replaces: {
      Inter: 'Barlow',
      'JetBrains Mono': 'Chivo Mono',
    },
    why: 'Barlow is based on California highway signage, a sturdy, hard-hat grotesk for construction tech, and Chivo Mono gives the dollar figures a clear tabular look.',
  },
  syntaxfire: {
    faces: [
      {
        family: 'Funnel Sans',
        role: 'display',
        use: 'hero 60px 700 at -1.5px',
      },
      {
        family: 'Funnel Sans',
        role: 'body',
        use: 'body 16px',
      },
      {
        family: 'Newsreader',
        role: 'accent',
        use: 'italic highlight words and stat numerals in orange',
      },
    ],
    replaces: {
      Manrope: 'Funnel Sans',
      Lora: 'Newsreader',
    },
    why: "Funnel Sans stays as the techy sans, and Newsreader's italic has a sharper, more premium edge than Lora for the orange highlight words and stat numerals.",
  },
  queueline: {
    faces: [
      {
        family: 'Red Hat Display',
        role: 'display',
        use: 'headline 72px 600 at -1.8px, countdown numerals 64px tabular',
      },
      {
        family: 'Red Hat Display',
        role: 'body',
        use: 'body 16px gray, 13px uppercase countdown labels',
      },
    ],
    replaces: {
      'DM Sans': 'Red Hat Display',
    },
    why: 'Red Hat Display is a confident geometric-leaning sans with good tabular figures, which keeps the calm product-launch countdown.',
  },
  nightvault: {
    faces: [
      {
        family: 'Inter Tight',
        role: 'display',
        use: 'hero 70px 500 at -2%, section heads 48px',
      },
      {
        family: 'Inter Tight',
        role: 'body',
        use: 'body 16px, gray secondary',
      },
    ],
    replaces: {},
    why: "Inter Tight's medium weight is the sleek funded-fintech voice this nocturnal page is built on, and it stays in only a few templates.",
  },
  tandem: {
    faces: [
      {
        family: 'Google Sans',
        role: 'display',
        use: 'two-line heading 40px 700 at -1.2px',
      },
      {
        family: 'Google Sans',
        role: 'body',
        use: 'body 16px',
      },
    ],
    replaces: {
      Inter: 'Google Sans',
    },
    why: 'Google Sans is a clean, friendly platform-style sans, so the hardware teaser keeps the native product-page feel.',
  },
  'plinth-and-lathe': {
    faces: [
      {
        family: 'Anek Latin',
        role: 'display',
        use: 'hero 76px semibold, section heads 42px',
      },
      {
        family: 'Anek Latin',
        role: 'body',
        use: 'body 16px at 1.6, gray metadata',
      },
    ],
    replaces: {
      Inter: 'Anek Latin',
    },
    why: 'Anek Latin is a clean neo-grotesk with a slightly architectural, drawn precision, which echoes a Swiss studio monograph.',
  },
  tallyway: {
    faces: [
      {
        family: 'Funnel Sans',
        role: 'display',
        use: 'hero 68px semibold at -1.7px, H2 36px',
      },
      {
        family: 'Funnel Sans',
        role: 'body',
        use: 'body 16px at 1.6, muted meta',
      },
    ],
    replaces: {
      'Inter Tight': 'Funnel Sans',
    },
    why: 'Funnel Sans is a tight, modern grotesk with a little edge that suits the black hero and violet fintech CTA.',
  },
  'low-tide-signal': {
    faces: [
      {
        family: 'Barlow Condensed',
        role: 'display',
        use: 'hero name up to 208px bold uppercase, 24px wide-tracked dates',
      },
      {
        family: 'Barlow',
        role: 'body',
        use: 'body 16px at 1.6, warm off-white',
      },
    ],
    replaces: {},
    why: "The condensed poster face with its own regular-width sibling is the design's idea, and Barlow Condensed is used nowhere else, so the pair stays.",
  },
  brasa: {
    faces: [
      {
        family: 'Syne',
        role: 'display',
        use: 'hero 128px 700 at -3.2px, 12px uppercase section labels',
      },
      {
        family: 'Manrope',
        role: 'body',
        use: 'body 16px, 12px tracked uppercase nav',
      },
    ],
    replaces: {
      'Space Grotesk': 'Syne',
      Inter: 'Manrope',
    },
    why: "Syne's wide, idiosyncratic bold reads like a streetwear drop, and Manrope is a clean geometric body that stays out of its way.",
  },
  'delphine-rourke': {
    faces: [
      {
        family: 'Anton',
        role: 'display',
        use: 'decorative hero name ~230px uppercase',
      },
      {
        family: 'Bai Jamjuree',
        role: 'body',
        use: 'body 16px, 12px uppercase UI chips',
      },
    ],
    replaces: {
      'Space Grotesk': 'Bai Jamjuree',
    },
    why: 'Anton keeps the condensed album-cover impact, and Bai Jamjuree is a quirky, techno-flavored grotesk for the utility text.',
  },
  'tidewell-sessions': {
    faces: [
      {
        family: 'Poppins',
        role: 'display',
        use: 'headliner ~224px 800 at -5.6px, venue line',
      },
      {
        family: 'Tomorrow',
        role: 'body',
        use: 'body 16px at 1.6',
      },
      {
        family: 'Share Tech Mono',
        role: 'mono',
        use: 'short uppercase tagline with wide tracking',
      },
    ],
    replaces: {
      Outfit: 'Poppins',
      'Space Grotesk': 'Tomorrow',
      'Space Mono': 'Share Tech Mono',
    },
    why: 'Poppins at 800 gives the rounded geometric headliner, Tomorrow is a techy grotesk for the body, and Share Tech Mono gives the radio-log tagline.',
  },
  'marlow-kane': {
    faces: [
      {
        family: 'Inter Tight',
        role: 'display',
        use: 'split centered headline, regular weight, white',
      },
      {
        family: 'Inter Tight',
        role: 'body',
        use: 'body 16px at 1.6',
      },
      {
        family: 'DM Mono',
        role: 'mono',
        use: '12px uppercase nav with very wide tracking',
      },
    ],
    replaces: {
      Inter: 'Inter Tight',
      'IBM Plex Mono': 'DM Mono',
    },
    why: 'Inter Tight at regular weight is a restrained, fashion-editorial sans, and DM Mono supplies the archival monospace nav the design describes.',
  },
  'dust-bowl-radio': {
    faces: [
      {
        family: 'Heebo',
        role: 'display',
        use: 'hero title 128px at 300, -3.2px',
      },
      {
        family: 'Heebo',
        role: 'body',
        use: 'body 16px at 1.6, 12px uppercase labels',
      },
    ],
    replaces: {
      'Inter Tight': 'Heebo',
    },
    why: 'Heebo is a Helvetica-like sans with a clean light weight, which gives the thin, cinematic headline over the sunset photography.',
  },
  'hollis-fern': {
    faces: [
      {
        family: 'Lora',
        role: 'display',
        use: 'hero name 96px bold at -2.4px, italic tagline',
      },
      {
        family: 'Alegreya Sans',
        role: 'body',
        use: 'body 16px at 1.6, slight positive tracking',
      },
      {
        family: 'Caveat',
        role: 'script',
        use: 'handwritten liner-note accents',
      },
    ],
    replaces: {
      'Source Sans 3': 'Alegreya Sans',
    },
    why: 'Lora and Caveat keep the porch-at-dusk liner notes, and Alegreya Sans is a warmer, more handmade humanist body than Source Sans 3.',
  },
  'grain-theory': {
    faces: [
      {
        family: 'Courier Prime',
        role: 'display',
        use: 'titles and metadata, uppercase',
      },
      {
        family: 'Courier Prime',
        role: 'body',
        use: 'body 16px throughout',
      },
    ],
    replaces: {
      'IBM Plex Mono': 'Courier Prime',
    },
    why: 'Courier Prime is a typewriter mono, so the page reads like a typed archive index next to the black-and-white contact sheets.',
  },
  'ottilie-barr': {
    faces: [
      {
        family: 'Spline Sans',
        role: 'display',
        use: 'release titles and wordmark 12-14px, 600-700 uppercase, 0.2em',
      },
      {
        family: 'Spline Sans',
        role: 'body',
        use: 'body 16px',
      },
    ],
    replaces: {
      Inter: 'Spline Sans',
    },
    why: 'Spline Sans is a crisp, slightly geometric grotesk that looks precise in tiny tracked caps, like a gallery label on a record sleeve.',
  },
  'isolde-marsh': {
    faces: [
      {
        family: 'Lexend Exa',
        role: 'display',
        use: 'title 128px bold uppercase with wide 10px tracking',
      },
      {
        family: 'Karla',
        role: 'body',
        use: 'body 16px at 1.6, 12px uppercase side labels',
      },
    ],
    replaces: {
      'Space Grotesk': 'Lexend Exa',
      Inter: 'Karla',
    },
    why: 'Lexend Exa is a wide geometric sans built for spaced caps, which gives the film-title card, and Karla keeps the credits warm and quiet.',
  },
  'static-chapel': {
    faces: [
      {
        family: 'Bebas Neue',
        role: 'display',
        use: 'section heads 72px condensed uppercase',
      },
      {
        family: 'Caveat Brush',
        role: 'script',
        use: 'band name 160px, script only at 24px+',
      },
      {
        family: 'Chivo',
        role: 'body',
        use: 'body 16px, 12px uppercase nav',
      },
    ],
    replaces: {
      Caveat: 'Caveat Brush',
      'Space Grotesk': 'Chivo',
    },
    why: 'Caveat Brush is the heavier brush cut of the same hand, better for a photocopied gig poster; Bebas stays for the rigid caps, and Chivo is a gritty grotesk body.',
  },
  'oriel-sands': {
    faces: [
      {
        family: 'Montserrat',
        role: 'display',
        use: 'headline 96px 900 uppercase at -4.8px',
      },
      {
        family: 'Bai Jamjuree',
        role: 'body',
        use: 'body 16px at 1.6, 12px uppercase nav 600',
      },
    ],
    replaces: {
      Outfit: 'Montserrat',
      'Space Grotesk': 'Bai Jamjuree',
    },
    why: "Montserrat's black weight gives the tight, heavy geometric club-flyer display, against the techy grotesk Bai Jamjuree.",
  },
  'ines-calloway': {
    faces: [
      {
        family: 'Hubot Sans',
        role: 'display',
        use: 'hero ~192px 900 uppercase, -9.6px, three stacked lines',
      },
      {
        family: 'Heebo',
        role: 'body',
        use: 'body 16px at 1.6, 12px bold tracked buttons',
      },
    ],
    replaces: {
      Inter: 'Heebo',
    },
    why: 'Hubot Sans has a heavy black weight for the magazine-cover headline, and Heebo is a neutral, system-like body.',
  },
  'common-groove': {
    faces: [
      {
        family: 'Arimo',
        role: 'display',
        use: 'headings 42px medium, slight negative tracking',
      },
      {
        family: 'Anek Latin',
        role: 'body',
        use: 'body 16px (14px meta), 12px tracked uppercase labels',
      },
    ],
    replaces: {
      Inter: 'Anek Latin',
      'Inter Tight': 'Anek Latin',
    },
    why: "Arimo has Helvetica Neue's proportions for the Swiss headings, and Anek Latin is a clean catalog-card body.",
  },
  'ashen-veil': {
    faces: [
      {
        family: 'Archivo Black',
        role: 'display',
        use: 'headline 128px at -6.4px, second line reduced opacity',
      },
      {
        family: 'PT Sans',
        role: 'body',
        use: 'body 16px at 1.6, 12px uppercase nav and eyebrows',
      },
    ],
    replaces: {
      Inter: 'PT Sans',
    },
    why: 'Archivo Black gives the heavy, tight, loud headline over smoky photography, and PT Sans is a plain humanist body.',
  },
  'lintel-works': {
    faces: [
      {
        family: 'Zen Kaku Gothic New',
        role: 'display',
        use: 'hero 128px at 300 uppercase; regular 64px sections',
      },
      {
        family: 'Zen Kaku Gothic New',
        role: 'body',
        use: 'body 16-18px, 12px uppercase eyebrows',
      },
    ],
    replaces: {
      Inter: 'Zen Kaku Gothic New',
    },
    why: 'Zen Kaku Gothic New has a light, restrained Japanese-modernist grotesk Latin that mirrors minimal architecture.',
  },
  'cantilever-house': {
    faces: [
      {
        family: 'Noto Sans Display',
        role: 'display',
        use: 'hero ~96px bold, card titles ~56px, tight leading',
      },
      {
        family: 'Noto Sans Display',
        role: 'body',
        use: 'body 16px',
      },
    ],
    replaces: {
      Inter: 'Noto Sans Display',
    },
    why: 'Noto Sans Display has a heavy, tightly fitting bold that works when imagery sits inside the letterforms, and it stays neutral in text.',
  },
  'noor-halvorsen': {
    faces: [
      {
        family: 'Sofia Sans Extra Condensed',
        role: 'display',
        use: 'poster index ~60-128px uppercase, italic on hover',
      },
      {
        family: 'Figtree',
        role: 'body',
        use: 'body 16px, nav 15px medium',
      },
    ],
    replaces: {
      'Bebas Neue': 'Sofia Sans Extra Condensed',
      Inter: 'Figtree',
    },
    why: 'Sofia Sans Extra Condensed has true italics, which the hover state needs and Bebas Neue lacks, and Figtree is a friendly reading face.',
  },
  'ilse-marrow': {
    faces: [
      {
        family: 'Gloock',
        role: 'display',
        use: 'lowercase section words 120px in red, 40px serif narrative',
      },
      {
        family: 'Albert Sans',
        role: 'body',
        use: 'body 16px at 1.6, lowercase nav',
      },
    ],
    replaces: {
      'Playfair Display': 'Gloock',
      'Instrument Sans': 'Albert Sans',
    },
    why: 'Gloock is a high-contrast serif with a bold, literary personality for the red lowercase words, and Albert Sans is a neutral grotesk for utility.',
  },
  'corin-ashdown': {
    faces: [
      {
        family: 'Sora',
        role: 'display',
        use: 'hero 72px bold, H2 48px, negative tracking',
      },
      {
        family: 'Poppins',
        role: 'body',
        use: 'body 16-20px, buttons 14-18px medium',
      },
    ],
    replaces: {
      Outfit: 'Poppins',
    },
    why: 'Sora keeps the geometric display, and Poppins is a friendly round body that suits a personal site styled like a SaaS landing page.',
  },
  'saga-lindqvist': {
    faces: [
      {
        family: 'Bricolage Grotesque',
        role: 'display',
        use: 'name ~123px regular, link list 48px',
      },
      {
        family: 'Kumbh Sans',
        role: 'body',
        use: 'body 16-20px',
      },
    ],
    replaces: {
      'Hanken Grotesk': 'Kumbh Sans',
      Inter: 'Kumbh Sans',
    },
    why: 'Bricolage Grotesque at regular weight has the contemporary character of Cabinet Grotesk, and Kumbh Sans stands in for Satoshi, quiet and Nordic.',
  },
  'celeste-varga': {
    faces: [
      {
        family: 'Familjen Grotesk',
        role: 'display',
        use: 'name and section heads 30px orange, italic "Select clients"',
      },
      {
        family: 'Gantari',
        role: 'body',
        use: 'body 16px, 14px uppercase client roles',
      },
    ],
    replaces: {
      'Hanken Grotesk': 'Gantari',
      Inter: 'Gantari',
    },
    why: 'Familjen Grotesk is a refined grotesk with a real italic for the section label, and Gantari is a soft geometric body close to Satoshi.',
  },
  'dani-okafor': {
    faces: [
      {
        family: 'Poppins',
        role: 'display',
        use: 'name ~38px bold at -0.96px',
      },
      {
        family: 'Poppins',
        role: 'body',
        use: 'nav and contact 16-18px',
      },
    ],
    replaces: {},
    why: 'The warm, friendly single geometric family is the design, and Poppins stays in only a few templates.',
  },
  'tessa-quill': {
    faces: [
      {
        family: 'Rubik',
        role: 'display',
        use: 'name and role 128px bold uppercase at -6.4px',
      },
      {
        family: 'Rubik',
        role: 'body',
        use: 'body 17px, italic uppercase role titles',
      },
    ],
    replaces: {},
    why: "Rubik's rounded grotesk at poster scale is the whole idea of this CV, and few templates use it.",
  },
  'kasimir-lund': {
    faces: [
      {
        family: 'Hind',
        role: 'display',
        use: 'studio name 18-20px medium',
      },
      {
        family: 'Hind',
        role: 'body',
        use: 'body 16px, tags 14px',
      },
      {
        family: 'Crimson Pro',
        role: 'accent',
        use: 'editorial headings on about and project pages',
      },
    ],
    replaces: {
      Inter: 'Hind',
      'Cormorant Garamond': 'Crimson Pro',
    },
    why: 'Hind is a plain, quiet sans that keeps the UI small and neutral so the artwork dominates, and Crimson Pro is a sturdy book serif for the storytelling pages.',
  },
  'odette-crane': {
    faces: [
      {
        family: 'Libre Caslon Condensed',
        role: 'display',
        use: 'hero 96px at -2.4px with italic accent word, section heads 48px',
      },
      {
        family: 'Ysabeau Office',
        role: 'body',
        use: 'body 16-20px, 13px uppercase eyebrows 500',
      },
    ],
    replaces: {
      'Instrument Serif': 'Libre Caslon Condensed',
      Inter: 'Ysabeau Office',
    },
    why: 'Libre Caslon Condensed is a condensed editorial serif with italics, like a design journal, and Ysabeau Office is a graceful humanist body.',
  },
  'nadia-kolbe': {
    faces: [
      {
        family: 'Instrument Serif',
        role: 'display',
        use: 'headline 96px at -2.4px, italic for emphasis',
      },
      {
        family: 'Instrument Sans',
        role: 'body',
        use: 'body 16-20px, 16px semibold uppercase section labels',
      },
    ],
    replaces: {},
    why: 'The Instrument serif and sans are designed as siblings, which is the point of the design, and the pairing appears nowhere else.',
  },
  'harbor-and-pine': {
    faces: [
      {
        family: 'Cutive Mono',
        role: 'display',
        use: 'intro 20-24px regular',
      },
      {
        family: 'Cutive Mono',
        role: 'body',
        use: 'body 16px, nav and meta 13px',
      },
    ],
    replaces: {
      'IBM Plex Mono': 'Cutive Mono',
    },
    why: 'Cutive Mono is a single-weight typewriter face, which suits a regular-weight-only, typewritten designer notebook.',
  },
  'hollis-ward': {
    faces: [
      {
        family: 'Source Serif 4',
        role: 'display',
        use: 'hero ~48px regular, short uppercase contact line',
      },
      {
        family: 'Source Serif 4',
        role: 'body',
        use: 'body 16px, italic for small cues',
      },
    ],
    replaces: {},
    why: 'A single literary text serif carries this monograph-like page, and Source Serif 4 appears in only a couple of templates.',
  },
  'krv-works': {
    faces: [
      {
        family: 'Space Mono',
        role: 'display',
        use: 'display up to 160px 700 uppercase, labels and buttons 14px bold',
      },
      {
        family: 'Work Sans',
        role: 'body',
        use: 'paragraphs 16px at 1.6',
      },
    ],
    replaces: {
      'JetBrains Mono': 'Space Mono',
      Inter: 'Work Sans',
    },
    why: "Space Mono's quirky bold is rawer than a code mono, right for the Swiss-meets-zine typewriter poster, and Work Sans keeps paragraphs readable.",
  },
  'mara-ellis': {
    faces: [
      {
        family: 'Syne',
        role: 'display',
        use: 'display 72-96px 500 at -1.8px',
      },
      {
        family: 'Unbounded',
        role: 'display',
        use: 'the named alternative wide display',
      },
      {
        family: 'Lexend Deca',
        role: 'body',
        use: 'body 16-18px at 1.6, 14px labels',
      },
    ],
    replaces: {
      Inter: 'Lexend Deca',
    },
    why: 'Syne and Unbounded stay as the named wide display fallbacks, and Lexend Deca is a calm geometric body close to Satoshi for the boutique agency.',
  },
  'solenne-marsh': {
    faces: [
      {
        family: 'Lexend Exa',
        role: 'display',
        use: 'display 128px at 200 uppercase, 0.1em; headings 36px 300',
      },
      {
        family: 'Lexend Exa',
        role: 'body',
        use: 'UI and body 16px, 400/500',
      },
    ],
    replaces: {
      Inter: 'Lexend Exa',
    },
    why: "Lexend Exa is drawn wide and has ultralight weights, so the widely spaced photographer's-signature caps come naturally.",
  },
  'tidewell-photo': {
    faces: [
      {
        family: 'Readex Pro',
        role: 'display',
        use: 'series names 48-56px, 500 inactive / 600 active, -0.03em',
      },
      {
        family: 'Readex Pro',
        role: 'body',
        use: 'nav 18-20px, captions 16px',
      },
    ],
    replaces: {
      'Plus Jakarta Sans': 'Readex Pro',
    },
    why: 'Readex Pro is an even, geometric-humanist sans whose 500-to-600 step is clearly visible, so the weight shift still marks the active series in the quiet slideshow.',
  },
  'ardent-words': {
    faces: [
      {
        family: 'Archivo Black',
        role: 'display',
        use: 'display up to ~102px at -0.05em, sentence case',
      },
      {
        family: 'Encode Sans',
        role: 'body',
        use: 'body 16-20px, 12px uppercase labels',
      },
    ],
    replaces: {
      Inter: 'Encode Sans',
    },
    why: 'Archivo Black keeps the manifesto weight, and Encode Sans is a firm, slightly squarish body that stays direct and no-nonsense.',
  },
  'elio-park': {
    faces: [
      {
        family: 'Proza Libre',
        role: 'display',
        use: 'viewport-scaled uppercase project names, bold, 0.05em',
      },
      {
        family: 'Proza Libre',
        role: 'body',
        use: 'body 16-20px, inline bold keywords, italic asides',
      },
    ],
    replaces: {
      Inter: 'Proza Libre',
    },
    why: 'Proza Libre is a plain but witty humanist sans with a real italic for asides, and its bold caps hold up when pushed to gallery-wall scale.',
  },
  'linden-ash': {
    faces: [
      {
        family: 'Playfair Display',
        role: 'display',
        use: 'headings 64/32/24px 400, italic for emphasis',
      },
      {
        family: 'Pathway Extreme',
        role: 'body',
        use: 'body 16px at +0.01em, 12px uppercase tracked labels',
      },
    ],
    replaces: {
      Inter: 'Pathway Extreme',
      Playfair: 'Playfair Display',
    },
    why: 'Playfair Display stays for this art-book catalog, one of the few templates keeping it, and Pathway Extreme is a quiet regular-weight grotesk with optical sizes for small labels.',
  },
  'paloma-arce': {
    faces: [
      {
        family: 'Roboto',
        role: 'display',
        use: 'brand name 24px regular in nav',
      },
      {
        family: 'Roboto',
        role: 'body',
        use: 'body 16-18px, captions 14px',
      },
      {
        family: 'Castoro',
        role: 'accent',
        use: 'italic publication titles in the lightbox, 20px+',
      },
    ],
    replaces: {
      Inter: 'Roboto',
      'Cormorant Garamond': 'Castoro',
      Cormorant: 'Castoro',
    },
    why: "A neutral system-like sans keeps the gallery quiet so the images lead, and Castoro's soft Dutch italic gives the publication titles a serene, bookish touch.",
  },
  'kestrel-bureau': {
    faces: [
      {
        family: 'Encode Sans',
        role: 'display',
        use: 'titles 40-64px at 300/400, ending in an underscore',
      },
      {
        family: 'Encode Sans',
        role: 'body',
        use: 'body 16px, 12px 500 uppercase labels at 0.14em',
      },
    ],
    replaces: {
      'Inter Tight': 'Encode Sans',
      Manrope: 'Encode Sans',
    },
    why: 'Encode Sans is a tight-fitting grotesk with good light weights, a Google Fonts stand-in for PP Neue Montreal that keeps the cinematic white frame.',
  },
  'idris-vale': {
    faces: [
      {
        family: 'Gothic A1',
        role: 'display',
        use: 'name ~100px 500 at -4px, bold top name 22px',
      },
      {
        family: 'Gothic A1',
        role: 'body',
        use: 'address and statement ~20px regular, captions 14px',
      },
    ],
    replaces: {
      Inter: 'Gothic A1',
    },
    why: "Gothic A1's Latin is a clean, Helvetica-like grotesk, so the contact-sheet page keeps its classic Swiss single-family look.",
  },
  'aster-quinn': {
    faces: [
      {
        family: 'Libre Bodoni',
        role: 'display',
        use: 'name 128px 500 uppercase at 0.05em, list titles 24-28px',
      },
      {
        family: 'Rosario',
        role: 'body',
        use: 'prose 16-18px at 1.6',
      },
      {
        family: 'DM Mono',
        role: 'mono',
        use: 'labels, dates and metadata, 12px minimum',
      },
    ],
    replaces: {
      'Playfair Display': 'Libre Bodoni',
      Inter: 'Rosario',
      Playfair: 'Libre Bodoni',
    },
    why: 'Libre Bodoni is a cooler, more archival high-contrast serif for the misty name, Rosario is a soft humanist prose face, and DM Mono stays for the data.',
  },
  transom: {
    faces: [
      {
        family: 'PT Mono',
        role: 'display',
        use: 'statement 16-18px regular, uppercase short labels',
      },
      {
        family: 'PT Mono',
        role: 'body',
        use: 'paragraphs 16px/1.5, 12px marquee',
      },
      {
        family: 'Courier Prime',
        role: 'accent',
        use: 'the named typewriter alternative',
      },
    ],
    replaces: {
      'IBM Plex Mono': 'PT Mono',
    },
    why: "PT Mono is a crisp single-weight mono, which matches the design's 400-only rule, and Courier Prime stays as the named typewriter alternative for the index-card feel.",
  },
  'orin-blackwood': {
    faces: [
      {
        family: 'Chakra Petch',
        role: 'display',
        use: 'hero 128px 600 at -3.2px, gray on black',
      },
      {
        family: 'Chakra Petch',
        role: 'body',
        use: 'body 16px gray',
      },
      {
        family: 'Azeret Mono',
        role: 'mono',
        use: 'bracketed labels like [ About Me ]',
      },
    ],
    replaces: {
      Inter: 'Chakra Petch',
      'IBM Plex Mono': 'Azeret Mono',
    },
    why: 'Chakra Petch has a technical, chamfered rhythm like a render studio blueprint, and Azeret Mono keeps the bracket labels precise.',
  },
  'cass-moreno': {
    faces: [
      {
        family: 'League Gothic',
        role: 'display',
        use: 'name and short headings 128-192px uppercase at 0.05em',
      },
      {
        family: 'IBM Plex Sans',
        role: 'body',
        use: 'body 16px at 1.6, 12px tracked uppercase labels',
      },
    ],
    replaces: {
      'Bebas Neue': 'League Gothic',
      Inter: 'IBM Plex Sans',
    },
    why: 'League Gothic is a tall, classic condensed poster face like a documentary title card, and IBM Plex Sans is a neutral, slightly engineered body.',
  },
  'seren-maddox': {
    faces: [
      {
        family: 'Livvic',
        role: 'display',
        use: 'two-line title 72px 500 uppercase at 0.05em',
      },
      {
        family: 'Livvic',
        role: 'body',
        use: 'body 18px at 1.6, 12px tracked labels',
      },
    ],
    replaces: {
      'Host Grotesk': 'Livvic',
    },
    why: 'Livvic is a friendly, slightly playful sans that stays calm in text, so the floating artworks keep the energy.',
  },
  'bram-oduya': {
    faces: [
      {
        family: 'Bricolage Grotesque',
        role: 'display',
        use: 'hero 60px+ at 500, fluid footer wordmark',
      },
      {
        family: 'Lexend Deca',
        role: 'body',
        use: 'body 16px at 1.6, tags 12-14px',
      },
    ],
    replaces: {
      'Space Grotesk': 'Bricolage Grotesque',
      Inter: 'Lexend Deca',
    },
    why: 'Bricolage Grotesque is a characterful grotesk like Clash Grotesk, and Lexend Deca is a clean geometric body close to General Sans.',
  },
  'odile-varenne': {
    faces: [
      {
        family: 'Afacad',
        role: 'display',
        use: 'name 60px 500 at -1.5px',
      },
      {
        family: 'Kumbh Sans',
        role: 'body',
        use: 'body 16px, 500 for pills and buttons',
      },
    ],
    replaces: {
      'Space Grotesk': 'Afacad',
      'DM Sans': 'Kumbh Sans',
    },
    why: 'Afacad is a soft, refined modern sans with a gentle calligraphic touch, and Kumbh Sans stands in for Satoshi, keeping the linen-walled salon quiet.',
  },
  'theo-lindqvist': {
    faces: [
      {
        family: 'Prompt',
        role: 'display',
        use: 'hero 144px 400 at -4.32px, section H2 700 60px',
      },
      {
        family: 'Prompt',
        role: 'body',
        use: 'body 16px, 12px uppercase tags',
      },
    ],
    replaces: {
      Manrope: 'Prompt',
    },
    why: 'Prompt is a clean, loopless geometric sans that looks elegant at 400 on a huge scale and firm at 700, close to Satoshi.',
  },
  'nadia-holt': {
    faces: [
      {
        family: 'Hubot Sans',
        role: 'display',
        use: 'headline 72px 500 at -1.8px',
      },
      {
        family: 'Atkinson Hyperlegible Next',
        role: 'body',
        use: 'body 16-18px at 1.6',
      },
      {
        family: 'Geist Mono',
        role: 'mono',
        use: 'index numerals',
      },
    ],
    replaces: {
      'Space Grotesk': 'Hubot Sans',
      Inter: 'Atkinson Hyperlegible Next',
      'JetBrains Mono': 'Geist Mono',
    },
    why: 'Hubot Sans gives a distinctive grotesk headline, Atkinson Hyperlegible Next is a very readable body, and Geist Mono keeps the indices tidy.',
  },
  'linnea-farrow': {
    faces: [
      {
        family: 'Sen',
        role: 'display',
        use: 'nav and name 18px 700',
      },
      {
        family: 'Sen',
        role: 'body',
        use: 'body ~19.5px regular',
      },
    ],
    replaces: {},
    why: 'Sen is a small, clean geometric sans close to Satoshi that stays tiny and bold in the nav, leaving the white wall to the photographs.',
  },
  'neon-harbor': {
    faces: [
      {
        family: 'Syne',
        role: 'display',
        use: 'headings up to 128px 700 at -3.2px',
      },
      {
        family: 'Spline Sans',
        role: 'body',
        use: 'body 16px, 12-13px uppercase one-word nav',
      },
    ],
    replaces: {
      Inter: 'Spline Sans',
    },
    why: 'Syne keeps the quirky wide display, and Spline Sans is a crisp, slightly geometric body that stays clean on the neon-lit dark gallery.',
  },
  'marisol-duarte': {
    faces: [
      {
        family: 'Bodoni Moda',
        role: 'display',
        use: 'hero 72px 400, section heads 48px 500 at -1.2px',
      },
      {
        family: 'DM Sans',
        role: 'body',
        use: 'body 16px, 14px ingredient captions',
      },
      {
        family: 'Cormorant',
        role: 'accent',
        use: 'italic serif lighting notes at 16px',
      },
    ],
    replaces: {
      Fraunces: 'Bodoni Moda',
    },
    why: "Bodoni Moda is the high-contrast display serif the design wants in place of Boska, Cormorant's italic suits the recipe-card notes, and DM Sans stays as the friendly body.",
  },
  'jonah-reyes': {
    faces: [
      {
        family: 'Libre Caslon Display',
        role: 'display',
        use: "'Get in touch' ~60px, company names ~32px",
      },
      {
        family: 'Newsreader',
        role: 'body',
        use: 'body 16-20px, italics',
      },
    ],
    replaces: {
      'Playfair Display': 'Libre Caslon Display',
      'Source Serif 4': 'Newsreader',
      Playfair: 'Libre Caslon Display',
    },
    why: 'Libre Caslon Display is a high-contrast display serif and Newsreader a text serif built for news, which keeps the broadsheet arts-section feel on black.',
  },
  'wren-adeyemi': {
    faces: [
      {
        family: 'Instrument Serif',
        role: 'display',
        use: 'uppercase name 48-160px at 0.05em',
      },
      {
        family: 'Source Serif 4',
        role: 'body',
        use: 'paragraphs 17-18px at 1.6',
      },
      {
        family: 'Space Mono',
        role: 'mono',
        use: '12px uppercase metadata',
      },
    ],
    replaces: {},
    why: 'Condensed display serif, sturdy text serif and typewriter mono are the magazine contents-page idea, and this trio is unique in the catalog.',
  },
  'adaeze-bello': {
    faces: [
      {
        family: 'Inconsolata',
        role: 'display',
        use: 'one-word wordmark 16px uppercase at 0.08em',
      },
      {
        family: 'Inconsolata',
        role: 'body',
        use: 'paragraphs 16px at 1.6',
      },
    ],
    replaces: {
      'JetBrains Mono': 'Inconsolata',
      'IBM Plex Mono': 'Inconsolata',
    },
    why: 'Inconsolata is a narrow, elegant mono that stays a whisper in black and white, so the facades read like contact prints.',
  },
  'juno-ferreira': {
    faces: [
      {
        family: 'Space Grotesk',
        role: 'display',
        use: 'hero 96px 700, section titles 60px at -1.5px',
      },
      {
        family: 'Livvic',
        role: 'body',
        use: 'descriptions 16-20px in deep brown',
      },
    ],
    replaces: {
      Inter: 'Livvic',
    },
    why: 'The punchy techno-grotesk stays for the sunny zine, and Livvic is a friendlier, rounder body than Inter to match the stickers.',
  },
  'kai-okafor': {
    faces: [
      {
        family: 'Fira Sans',
        role: 'display',
        use: 'headline 60px 700 at -1.5px',
      },
      {
        family: 'Fira Sans',
        role: 'body',
        use: 'body 16-18px',
      },
      {
        family: 'JetBrains Mono',
        role: 'mono',
        use: 'nav, card titles, chips, comments and metrics',
      },
    ],
    replaces: {
      Inter: 'Fira Sans',
    },
    why: 'Fira Sans comes from the code-editor world as a readable UI sans, and JetBrains Mono stays for the editor-themed details it was made for.',
  },
  'iris-hale': {
    faces: [
      {
        family: 'Playfair',
        role: 'display',
        use: 'intro 96px, section heads 60px, italic for emphasis',
      },
      {
        family: 'Rubik',
        role: 'body',
        use: 'body 17px, 12px uppercase labels',
      },
    ],
    replaces: {
      'Playfair Display': 'Playfair',
    },
    why: "Playfair's variable optical sizes give an expressive, warmer literary serif than Playfair Display, and Rubik stays as the friendly rounded body.",
  },
  fernwood: {
    faces: [
      {
        family: 'Castoro',
        role: 'display',
        use: 'headings 96px 400 at -2.4px, italic',
      },
      {
        family: 'Proza Libre',
        role: 'body',
        use: 'body 16px at 1.6, underlined links',
      },
    ],
    replaces: {
      'Instrument Serif': 'Castoro',
      Inter: 'Proza Libre',
    },
    why: 'Castoro is a soft, calm editorial serif for the case-book headlines, and Proza Libre is a warm humanist body with understated confidence.',
  },
  'hollowlight-stories': {
    faces: [
      {
        family: 'Crimson Pro',
        role: 'display',
        use: 'hero 72px 500 at +0.01em, second line italic',
      },
      {
        family: 'Crimson Pro',
        role: 'body',
        use: 'body 16px at 1.7, 12px uppercase nav at 0.2em',
      },
    ],
    replaces: {
      Newsreader: 'Crimson Pro',
      Lora: 'Crimson Pro',
    },
    why: 'Crimson Pro is a classic book serif with a full weight range and italics, so a single literary face can carry the whole wedding album.',
  },
  'brightcut-motion': {
    faces: [
      {
        family: 'Kanit',
        role: 'display',
        use: 'headlines 60-72px 900 uppercase, tight leading',
      },
      {
        family: 'Bagel Fat One',
        role: 'display',
        use: 'logo only',
      },
      {
        family: 'Heebo',
        role: 'body',
        use: 'descriptions 16-18px gray',
      },
    ],
    replaces: {
      'Rubik Mono One': 'Bagel Fat One',
      Inter: 'Heebo',
    },
    why: "Kanit's black weight gives the blunt heavy headlines, Bagel Fat One stays for the cartoonish logo, and Heebo is a neutral, system-like body.",
  },
  tabline: {
    faces: [
      {
        family: 'Radio Canada Big',
        role: 'display',
        use: 'row titles ~24px regular',
      },
      {
        family: 'Radio Canada Big',
        role: 'body',
        use: 'body 16px 400 at 1.65, 70ch',
      },
    ],
    replaces: {
      'Space Grotesk': 'Radio Canada Big',
    },
    why: 'Radio Canada Big is a grotesk with a few quirky details like Space Grotesk, but calmer, which suits the quiet table-of-contents CV.',
  },
  'marlowe-page': {
    faces: [
      {
        family: 'Cormorant Garamond',
        role: 'display',
        use: 'name 96px at 300, section titles ~64px, vermilion',
      },
      {
        family: 'Ysabeau Office',
        role: 'body',
        use: 'body 22px, labels and long descriptions',
      },
    ],
    replaces: {
      Inter: 'Ysabeau Office',
    },
    why: 'The light Garamond named in the notes stays for the vermilion display, and Ysabeau Office is a graceful humanist sans that suits the boutique profile.',
  },
  'tidepool-cv': {
    faces: [
      {
        family: 'Epilogue',
        role: 'display',
        use: 'name 120px 600 at -0.02em, section titles 32px',
      },
      {
        family: 'Alegreya Sans',
        role: 'body',
        use: 'body 16px at 1.7',
      },
    ],
    replaces: {
      Archivo: 'Epilogue',
      Figtree: 'Alegreya Sans',
      Inter: 'Alegreya Sans',
    },
    why: 'Epilogue is a grotesk with a playful, slightly wide display cut, and Alegreya Sans is a soft humanist body, keeping the CV fresh but professional.',
  },
  'second-leash': {
    faces: [
      {
        family: 'Frank Ruhl Libre',
        role: 'display',
        use: 'hero 56px 700, H2 40px',
      },
      {
        family: 'Lexend',
        role: 'body',
        use: 'body 16px on light and dark sections',
      },
    ],
    replaces: {
      'Playfair Display': 'Frank Ruhl Libre',
      'DM Sans': 'Lexend',
    },
    why: 'Frank Ruhl Libre is a classic, warm high-contrast serif with a solid bold for heartfelt headlines, and Lexend is a very readable friendly geometric body.',
  },
  'harborline-law': {
    faces: [
      {
        family: 'EB Garamond',
        role: 'display',
        use: 'hero 60px 700, italic first line, tight leading',
      },
      {
        family: 'Roboto Flex',
        role: 'body',
        use: 'body 16px, forms and nav',
      },
    ],
    replaces: {
      'Playfair Display': 'EB Garamond',
      Inter: 'Roboto Flex',
    },
    why: 'EB Garamond signals legal tradition with a gentler, more approachable voice than a didone, and Roboto Flex keeps forms and nav crisp.',
  },
  'wrenchwell-plumbing': {
    faces: [
      {
        family: 'Encode Sans Expanded',
        role: 'display',
        use: 'headings 72px 700 at -1.8px, title case',
      },
      {
        family: 'Encode Sans',
        role: 'body',
        use: 'body 16-18px, slate secondary',
      },
    ],
    replaces: {
      Inter: 'Encode Sans',
      'Space Grotesk': 'Encode Sans',
    },
    why: 'The expanded bold of the Encode family gives a punchy trade-grotesk headline, and its normal width keeps the body clean: one family, as the design wants.',
  },
  'casa-lumen': {
    faces: [
      {
        family: 'Gilda Display',
        role: 'display',
        use: 'stacked headline 96px 400 at -2.4px',
      },
      {
        family: 'Spline Sans',
        role: 'body',
        use: 'addresses, menus, forms 16-18px, 12px eyebrows at 0.2em',
      },
    ],
    replaces: {
      'Playfair Display': 'Gilda Display',
      Inter: 'Spline Sans',
    },
    why: 'Gilda Display is a refined high-contrast display serif for drama over photography, and Spline Sans is a neutral, precise utility sans.',
  },
  'snooze-sniff': {
    faces: [
      {
        family: 'Gelasio',
        role: 'display',
        use: 'headline 72px 700, two-tone',
      },
      {
        family: 'Quicksand',
        role: 'body',
        use: 'body 16-18px at 500, gray-blue secondary',
      },
    ],
    replaces: {
      'Playfair Display': 'Gelasio',
      'DM Sans': 'Quicksand',
    },
    why: 'Gelasio is a warm, classic serif with a hotel-like bold, and the rounded geometric Quicksand keeps the pet hotel cheerful.',
  },
  'fernbrook-lodge': {
    faces: [
      {
        family: 'Spectral',
        role: 'display',
        use: 'headline 72px 700 with italic green emphasis line',
      },
      {
        family: 'M PLUS Rounded 1c',
        role: 'body',
        use: 'UI and long descriptions 16px',
      },
    ],
    replaces: {
      'Playfair Display': 'Spectral',
      'DM Sans': 'M PLUS Rounded 1c',
    },
    why: "Spectral's bold and italic give a caring, boutique serif voice, and M PLUS Rounded 1c is the soft rounded sans the notes ask for.",
  },
  'kindling-trust': {
    faces: [
      {
        family: 'DM Serif Display',
        role: 'display',
        use: 'hero words 144px at -3.6px, section statements 72px',
      },
      {
        family: 'Gothic A1',
        role: 'body',
        use: 'body 16px at 1.65, 14px uppercase buttons',
      },
    ],
    replaces: {
      Inter: 'Gothic A1',
    },
    why: 'DM Serif Display keeps the magazine-cover gravitas, and Gothic A1 is a quiet grotesk that stays out of its way.',
  },
  sudsbury: {
    faces: [
      {
        family: 'Prompt',
        role: 'display',
        use: 'hero 60px 800, section titles 36px bold',
      },
      {
        family: 'Atkinson Hyperlegible Next',
        role: 'body',
        use: 'body 16px, pricing tables',
      },
    ],
    replaces: {
      Poppins: 'Prompt',
      Inter: 'Atkinson Hyperlegible Next',
    },
    why: 'Prompt is a rounded-feeling geometric with a strong ExtraBold for friendly punch, and Atkinson Hyperlegible Next keeps prices and tables very clear.',
  },
  turnwell: {
    faces: [
      {
        family: 'Fraunces',
        role: 'display',
        use: 'headline 92px 400 at -0.027em, section statements 64px',
      },
      {
        family: 'PT Sans',
        role: 'body',
        use: 'body 16-18px, 12px uppercase eyebrows, buttons',
      },
    ],
    replaces: {
      Inter: 'PT Sans',
    },
    why: 'Fraunces is the soft-contrast wonky serif the design names, and PT Sans is a plain, utilitarian body for the square-cornered UI.',
  },
  'polyglot-commons': {
    faces: [
      {
        family: 'Noto Sans Display',
        role: 'display',
        use: 'hero 60px 800, section titles 36px bold',
      },
      {
        family: 'Noto Sans',
        role: 'body',
        use: 'descriptions 16px, slate',
      },
    ],
    replaces: {
      Inter: 'Noto Sans Display',
      Roboto: 'Noto Sans',
    },
    why: 'Two neutral sibling sans families with coverage for almost every script, apt for a language-learning brand that must show many languages.',
  },
  'nocturne-works': {
    faces: [
      {
        family: 'Lexend Deca',
        role: 'display',
        use: 'hero 60px at 300 at -1.5px, section titles 36px regular',
      },
      {
        family: 'Lexend Deca',
        role: 'body',
        use: 'body 16px, 12px 500 uppercase eyebrows at 0.2em',
      },
    ],
    replaces: {
      Inter: 'Lexend Deca',
    },
    why: 'Lexend Deca is an even, open geometric sans with a clean light weight, which gives the premium monochrome gallery its calm, cinematic headlines.',
  },
  'barkley-grand': {
    faces: [
      {
        family: 'Fredoka',
        role: 'display',
        use: 'hero 72px 700, section titles 48px, gold two-tone',
      },
      {
        family: 'Mukta',
        role: 'body',
        use: 'body 16-18px, warm gray',
      },
    ],
    replaces: {
      Inter: 'Mukta',
    },
    why: 'Fredoka keeps the playful, rounded luxury, and Mukta is a calm, legible humanist body.',
  },
  'romp-club': {
    faces: [
      {
        family: 'Kanit',
        role: 'display',
        use: 'hero 60px 700, section titles 48px, orange keywords',
      },
      {
        family: 'Kanit',
        role: 'body',
        use: 'body 16px regular',
      },
    ],
    replaces: {
      Poppins: 'Kanit',
    },
    why: 'Kanit is a lively geometric family with many weights and a little extra character, so a single family still carries the whole page.',
  },
  'hearthside-pet-care': {
    faces: [
      {
        family: 'Caveat',
        role: 'script',
        use: 'short hero headline 96px only',
      },
      {
        family: 'Libre Baskerville',
        role: 'display',
        use: 'section titles 36px bold',
      },
      {
        family: 'DM Sans',
        role: 'body',
        use: 'body 16px, tracked uppercase eyebrows',
      },
    ],
    replaces: {
      'Playfair Display': 'Libre Baskerville',
    },
    why: 'Caveat stays for the personal hero, Libre Baskerville is a warmer, homier serif for sections than Playfair Display, and DM Sans stays friendly for everything else.',
  },
  'aperture-hall': {
    faces: [
      {
        family: 'M PLUS 2',
        role: 'display',
        use: 'hero ~128px 800, section titles 48px bold',
      },
      {
        family: 'M PLUS 2',
        role: 'body',
        use: 'body 16px gray on black, tracked uppercase nav and eyebrows',
      },
    ],
    replaces: {
      Inter: 'M PLUS 2',
    },
    why: 'M PLUS 2 is a clean geometric grotesk with a very heavy weight, giving the dramatic size contrast on the gallery-dark stage.',
  },
  'sunnyside-kennels': {
    faces: [
      {
        family: 'Maven Pro',
        role: 'display',
        use: 'hero 72px 800, section titles 36px bold',
      },
      {
        family: 'Maven Pro',
        role: 'body',
        use: 'body 16-18px, blue links, orange booking actions',
      },
    ],
    replaces: {
      'Plus Jakarta Sans': 'Maven Pro',
    },
    why: 'Maven Pro is a friendly, slightly rounded geometric sans with a solid ExtraBold, keeping the kennel bright, honest and upbeat.',
  },
  'pawpoint-network': {
    faces: [
      {
        family: 'Brygada 1918',
        role: 'display',
        use: 'hero 80px 400 with italic first line, section titles 36px, card titles semibold',
      },
      {
        family: 'Hind',
        role: 'body',
        use: 'body 16px, navigation, search and forms',
      },
    ],
    replaces: {
      'Playfair Display': 'Brygada 1918',
      Playfair: 'Brygada 1918',
      Inter: 'Hind',
    },
    why: 'Brygada 1918 is a classic book serif with real italics and a semibold for card titles, signaling premium care, and Hind keeps nav and forms neutral.',
  },
  'groundwork-collective': {
    faces: [
      {
        family: 'Catamaran',
        role: 'display',
        use: 'headline 160px 900 uppercase at -0.05em',
      },
      {
        family: 'Catamaran',
        role: 'body',
        use: 'body 16-18px, 14px uppercase nav',
      },
      {
        family: 'Philosopher',
        role: 'accent',
        use: 'italic section titles at display sizes',
      },
    ],
    replaces: {
      Inter: 'Catamaran',
    },
    why: 'Catamaran runs from a brutal black to an easy text weight, and Philosopher stays for the soft calligraphic italic that balances it.',
  },
  'blade-fade-co': {
    faces: [
      {
        family: 'Bebas Neue',
        role: 'display',
        use: 'headings 192px uppercase, 72px section titles',
      },
      {
        family: 'Oswald',
        role: 'display',
        use: 'the named fallback condensed display',
      },
      {
        family: 'Barlow',
        role: 'body',
        use: 'body 16px, 14px 600 uppercase buttons',
      },
    ],
    replaces: {
      Inter: 'Barlow',
    },
    why: 'Bebas Neue and Oswald keep the classic barbershop poster caps, and Barlow is a sturdy, slightly industrial body that suits the crafted service details.',
  },
  glowbench: {
    faces: [
      {
        family: 'Ubuntu Sans',
        role: 'display',
        use: 'section titles 36px 600, brand 24px',
      },
      {
        family: 'Ubuntu Sans',
        role: 'body',
        use: 'body 16px, 14px meta',
      },
    ],
    replaces: {
      Inter: 'Ubuntu Sans',
    },
    why: 'Ubuntu Sans is a clean, modern humanist UI face with an app-like clarity that keeps focus on the photos and prices.',
  },
  rosewell: {
    faces: [
      {
        family: 'DM Serif Display',
        role: 'display',
        use: 'hero 60px, section headings 48px, italic captions',
      },
      {
        family: 'Josefin Sans',
        role: 'body',
        use: 'body 16px at 1.7, uppercase nav, eyebrows, buttons',
      },
    ],
    replaces: {
      Inter: 'Josefin Sans',
    },
    why: "DM Serif Display keeps the soft editorial voice, and Josefin Sans's elegant geometric caps give the nav and eyebrows a feminine wellness-magazine polish.",
  },
  'quiet-pines-retreats': {
    faces: [
      {
        family: 'Mukta',
        role: 'display',
        use: 'hero 60px at 300, -1.5px; section titles 32px light',
      },
      {
        family: 'Mukta',
        role: 'body',
        use: 'body 16px, 12px uppercase nav and eyebrows',
      },
    ],
    replaces: {
      'DM Sans': 'Mukta',
    },
    why: 'Mukta is an airy, open humanist sans with a clean light weight, which gives the serene phone-off retreat its quiet headlines.',
  },
};
