/**
 * The SaaS screen patterns' own typefaces (docs/decisions.md, D108): a set
 * for each of the 88 marketing sites and starters, read by
 * `bin/import-design-catalog.ts` with `TYPE_SETS`, under the same rules
 * (`design-template-type.ts`): every family on Google Fonts, a replacement of
 * the same construction as what it replaces, no two designs sharing a set
 * across both batches, and no family in more than four. The 149 screen
 * patterns keep the catalog's own faces.
 */
import type { TypeSet } from './design-template-type.ts';

export const SAAS_TYPE_SETS: Readonly<Record<string, TypeSet>> = {
  emberlens: {
    faces: [
      {
        family: 'League Spartan',
        role: 'display',
        use: 'H1 72px / 44px mobile 700, -0.01em; H2 48px 700; pricing figures 44px 700',
      },
      {
        family: 'League Spartan',
        role: 'body',
        use: 'body 16px/1.5, lede 20px 400/500, card titles 20px 600',
      },
    ],
    replaces: {
      Manrope: 'League Spartan',
    },
    why: 'League Spartan is a sturdy geometric grotesk whose 700 keeps its shape at 72px on the near-black canvas and stays plain at 16px, so the generated images keep all the colour.',
  },
  everquill: {
    faces: [
      {
        family: 'Imbue',
        role: 'display',
        use: 'H1 44px / 34px mobile, H2 36px, card titles 22px, weight 400',
      },
      {
        family: 'Commissioner',
        role: 'body',
        use: 'body 16px/1.6, chips 14px, eyebrows 13px uppercase +0.06em, diagram labels 12px',
      },
    ],
    replaces: {
      'Instrument Serif': 'Imbue',
      Inter: 'Commissioner',
    },
    why: "Imbue is a condensed, high-contrast display serif with an optical-size axis, so the cream headlines stay crafted at 44px, and Commissioner's warm, lightly flared grotesk suits the chat and task mocks better than a neutral UI face.",
  },
  hazelpoint: {
    faces: [
      {
        family: 'Wix Madefor Display',
        role: 'display',
        use: 'hero 60px 500, H2 48px 400, -0.055em tracking',
      },
      {
        family: 'Wix Madefor Text',
        role: 'body',
        use: 'body 16px/1.5 500, statement paragraph 30px 400, labels 14px',
      },
    ],
    replaces: {
      Geist: 'Wix Madefor Display',
      Inter: 'Wix Madefor Text',
    },
    why: 'Wix Madefor Display and Text are a matched pair drawn for headlines and small copy respectively, so the tight 60px heading and the 16px body share one warm, founder-friendly voice.',
  },
  heronfield: {
    faces: [
      {
        family: 'Petrona',
        role: 'display',
        use: 'hero 62px 300, H2 52px, figures 64px, -0.05em',
      },
      {
        family: 'Hanken Grotesk',
        role: 'body',
        use: 'body 16px/1.5 400, buttons 14px 500',
      },
      {
        family: 'Geist Mono',
        role: 'mono',
        use: 'eyebrows, stat labels and roles 12px uppercase +0.1em',
      },
    ],
    replaces: {
      Newsreader: 'Petrona',
    },
    why: 'Petrona has a genuinely graceful light weight for the private-bank headlines and figures, while the Hanken Grotesk body and Geist Mono labels are kept as the design names them.',
  },
  isambry: {
    faces: [
      {
        family: 'DM Sans',
        role: 'display',
        use: 'hero 68px 600 with italic 300 words, H2 52px 500, feature numbers 36px light',
      },
      {
        family: 'Radio Canada',
        role: 'body',
        use: 'body 16px/1.5 400-500, eyebrows 13px semibold, captions 14px',
      },
    ],
    replaces: {
      Geist: 'Radio Canada',
    },
    why: 'DM Sans keeps its soft italic for the magazine-style hero, and Radio Canada is a warm humanist grotesk that makes the body read like a thoughtful feature rather than a spec sheet.',
  },
  larkdesk: {
    faces: [
      {
        family: 'Faustina',
        role: 'display',
        use: 'H1 56px, H2 48px, weight 300, -0.05em, line-height 1.05',
      },
      {
        family: 'Onest',
        role: 'body',
        use: 'leads 18-20px, body 16px/1.6 500, text and figures in the UI mocks',
      },
    ],
    replaces: {
      Newsreader: 'Faustina',
      Inter: 'Onest',
    },
    why: "Faustina's light weight gives the calm, well-mannered serif headlines, and Onest now does both the body and the mock UI, so the support screens feel of a piece with the page.",
  },
  leafprompt: {
    faces: [
      {
        family: 'Teachers',
        role: 'display',
        use: 'hero 64px 700, -0.015em; H2 48px 700; card titles 32px 700',
      },
      {
        family: 'Teachers',
        role: 'body',
        use: "body 16px/1.6 400, eyebrow pills 14px 600, 600 'Prompt:' labels",
      },
    ],
    replaces: {
      Inter: 'Teachers',
    },
    why: 'Teachers is a friendly, open sans made for learning materials, and its bold has the cheerful workshop feel the cartoon mascots need without turning childish.',
  },
  liltwave: {
    faces: [
      {
        family: 'Special Gothic',
        role: 'display',
        use: 'hero 64px 700, -0.023em; H2 48px 700; card titles 22px 700',
      },
      {
        family: 'Special Gothic',
        role: 'body',
        use: 'body 16px/1.6 500, stats 22px 600, status label 18px 600 uppercase +0.05em',
      },
    ],
    replaces: {
      'Instrument Sans': 'Special Gothic',
    },
    why: 'Special Gothic is a punchy modern grotesque with a studio-console edge, bold enough for creator-friendly headlines and steady in the uppercase status labels.',
  },
  loomgraph: {
    faces: [
      {
        family: 'Mozilla Headline',
        role: 'display',
        use: 'H1 72px 700, -0.03em, line-height 1.0',
      },
      {
        family: 'Mozilla Text',
        role: 'body',
        use: 'H2 32px 600, body 16px/1.6 400-500',
      },
      {
        family: 'Reddit Mono',
        role: 'mono',
        use: 'entity counts, step numbers and axis ticks 13px',
      },
    ],
    replaces: {
      Manrope: 'Mozilla Headline',
      Geist: 'Mozilla Text',
      'Geist Mono': 'Reddit Mono',
    },
    why: 'Mozilla Headline and Mozilla Text are a paired grotesk for display and reading sizes, precise and quiet on black, and Reddit Mono gives the counts and ticks an engineered, lab-like voice.',
  },
  lyrafilm: {
    faces: [
      {
        family: 'Assistant',
        role: 'display',
        use: 'hero 96px / 48px mobile 800, H2 52px 700, gradient eyebrows 20px 600',
      },
      {
        family: 'Assistant',
        role: 'body',
        use: 'lead 20px 600, body 16px/1.6',
      },
    ],
    replaces: {},
    why: 'Assistant is the named face and no other template uses it on its own; its heavy weights have the bright, sci-fi poster energy the night-sky studio needs.',
  },
  farrowline: {
    faces: [
      {
        family: 'SUSE',
        role: 'display',
        use: 'H1 44px / 32px mobile 700, -0.02em; H2 40px 700; metric figures 56px 700 tabular',
      },
      {
        family: 'SUSE',
        role: 'body',
        use: 'body 16px/1.5 500, dense tables 15px, trust label 16px uppercase +0.05em',
      },
    ],
    replaces: {
      'Plus Jakarta Sans': 'SUSE',
    },
    why: 'SUSE is a crisp geometric grotesk with a sharp, slightly theatrical bold, which suits the tunnel-grid hero and keeps the dense order tables clean.',
  },
  hopfield: {
    faces: [
      {
        family: 'Bebas Neue',
        role: 'display',
        use: 'hero 88px uppercase, H2 64px, stat figures 96px, -0.02em',
      },
      {
        family: 'Urbanist',
        role: 'body',
        use: 'body 16px/1.6 500, lead 22px, accordion titles 20px 600 uppercase, stat figures 300 at 96px',
      },
    ],
    replaces: {},
    why: "The design's own pairing is kept: tall condensed Bebas Neue for scoreboard punch and soft geometric Urbanist for friendly body copy, a combination no other template uses.",
  },
  ivorlin: {
    faces: [
      {
        family: 'Manrope',
        role: 'display',
        use: 'H1 48px 600, H2 32px 500, card titles 24px, stats 48px 400',
      },
      {
        family: 'Figtree',
        role: 'body',
        use: 'body 16px/1.6 400-500, dashboard labels 12px',
      },
    ],
    replaces: {},
    why: 'Manrope and Figtree are kept as named: two soft geometric sans that make a finance-grade dashboard feel approachable in pastels, in a pairing not used elsewhere.',
  },
  lorimark: {
    faces: [
      {
        family: 'Gantari',
        role: 'display',
        use: 'hero 72px / 40px 500, -0.04em; section headings 48px; card titles 24px',
      },
      {
        family: 'Gantari',
        role: 'body',
        use: 'body 16px/1.6 500, pill badges 14px, tabular metrics',
      },
      {
        family: 'Playfair',
        role: 'accent',
        use: 'one italic 400 phrase per heading, at heading size',
      },
    ],
    replaces: {
      Manrope: 'Gantari',
      'Instrument Serif': 'Playfair',
    },
    why: "Gantari is a calm geometric grotesk that stays precise at 72px in the dark control room, and Playfair's optical-size italic gives the single accent phrase a glossy, premium curve.",
  },
  ferrola: {
    faces: [
      {
        family: 'Reddit Sans',
        role: 'display',
        use: 'display 70px / 40px 500, H2 44px 500, -0.03em; stat numbers 32px tabular',
      },
      {
        family: 'Reddit Sans',
        role: 'body',
        use: 'body 16px/1.6 500, UI labels 14px, chart axes 12px',
      },
    ],
    replaces: {
      Geist: 'Reddit Sans',
      Inter: 'Reddit Sans',
    },
    why: 'Reddit Sans is a clear, even grotesk with a full weight range, so one family carries both the tightly tracked headings and the operational UI text of a well-kept control room.',
  },
  foldwire: {
    faces: [
      {
        family: 'Space Grotesk',
        role: 'display',
        use: 'display 48px / 34px 500, H2 36px, -0.05em; pricing figure 40px',
      },
      {
        family: 'IBM Plex Sans',
        role: 'body',
        use: 'body 16px/1.6 400, tab titles 17px 500, uppercase tags 12px +0.06em',
      },
    ],
    replaces: {
      Inter: 'IBM Plex Sans',
    },
    why: 'Space Grotesk keeps the technical, drawing-office headings, and IBM Plex Sans has the engineered, slightly mechanical detailing that fits a monochrome machine for busywork.',
  },
  gravelight: {
    faces: [
      {
        family: 'Pixelify Sans',
        role: 'display',
        use: 'hero 41px, H2 40px, weight 400',
      },
      {
        family: 'Geist Mono',
        role: 'body',
        use: 'body 16px/1.6, labels 12px uppercase +0.06em, figures 28px',
      },
    ],
    replaces: {},
    why: 'The named pixel display face and Geist Mono are kept: together they give the retro mission-control console its dot-matrix headings and all-monospace text.',
  },
  kelvora: {
    faces: [
      {
        family: 'Sora',
        role: 'display',
        use: 'H1 54px 500, H2 46px 400, -0.05em, line-height 1.1',
      },
      {
        family: 'Ubuntu Sans',
        role: 'body',
        use: 'body 16px/1.55, card copy 15px, pills 13px',
      },
      {
        family: 'Kalam',
        role: 'script',
        use: 'optional handwritten note on one diagram',
      },
    ],
    replaces: {
      Geist: 'Sora',
      Inter: 'Ubuntu Sans',
    },
    why: "Sora's wide, slightly futuristic geometry suits the midnight-blue glow, Ubuntu Sans keeps the body friendly and legible, and Kalam stays as the one handwritten diagram note the design allows.",
  },
  laborly: {
    faces: [
      {
        family: 'Alan Sans',
        role: 'display',
        use: 'hero 60px 400, H2 48px 400, -0.04em',
      },
      {
        family: 'Alan Sans',
        role: 'body',
        use: 'lead 18-20px, body 16px/1.6 500, eyebrows 13px 500 uppercase +0.08em',
      },
    ],
    replaces: {
      Onest: 'Alan Sans',
    },
    why: 'Alan Sans is a sleek, contemporary grotesk that looks controlled at regular weight and large sizes, which suits the cinematic dark control room and its cyan light.',
  },
  elmgather: {
    faces: [
      {
        family: 'Quicksand',
        role: 'display',
        use: 'H1 78px / 44px 500, -0.02em; H2 42px / 30px 500; statement 22px 500',
      },
      {
        family: 'Quicksand',
        role: 'body',
        use: 'body 16px/1.5 400-500, card captions 14px',
      },
    ],
    replaces: {
      'Nunito Sans': 'Quicksand',
    },
    why: "Quicksand's rounded geometric forms echo the friendly pill shapes and give the community app a warm, sociable voice at both 78px and 16px.",
  },
  hovendale: {
    faces: [
      {
        family: 'Albert Sans',
        role: 'display',
        use: 'hero 56px 400, H2 40px, -0.05em',
      },
      {
        family: 'Golos Text',
        role: 'body',
        use: 'body 16px/1.55 500 at -0.03em, UI labels 14px, eyebrow chips 12px uppercase',
      },
    ],
    replaces: {
      Geist: 'Golos Text',
    },
    why: 'Albert Sans keeps the refined, regular-weight editorial headings, and Golos Text is a sturdy, even text grotesk that stays crisp in the tilted UI cards.',
  },
  loftboard: {
    faces: [
      {
        family: 'Zalando Sans',
        role: 'display',
        use: 'hero 72px 400, -0.04em; H2 44px 400',
      },
      {
        family: 'Zalando Sans',
        role: 'body',
        use: 'body 16px/1.6 500, card titles 22px 500, eyebrows 14px 500 uppercase +0.08em',
      },
    ],
    replaces: {
      Manrope: 'Zalando Sans',
    },
    why: 'Zalando Sans is a clean, premium grotesk that looks composed at regular weight and 72px, so the late-night studio stays calm and lets the ember glow lead.',
  },
  eldervane: {
    faces: [
      {
        family: 'Parkinsans',
        role: 'display',
        use: 'H1 58px / 36px 700, H2 52px / 32px 700, stat numbers 48px 700',
      },
      {
        family: 'Instrument Sans',
        role: 'body',
        use: 'body 16px/1.5 500, bento titles 20px 600 +0.02em',
      },
    ],
    replaces: {
      'Bricolage Grotesque': 'Parkinsans',
    },
    phrases: {
      'H2 52/32px Bricolage 700': 'H2 52/32px Parkinsans 700',
    },
    why: 'Parkinsans has a characterful, slightly quirky bold that gives the cosmic headings personality, while the named Instrument Sans body stays crisp against midnight indigo.',
  },
  evergrove: {
    faces: [
      {
        family: 'Plus Jakarta Sans',
        role: 'display',
        use: 'display 48px / 34px 700, H2 42px / 30px, -0.02em',
      },
      {
        family: 'Merriweather Sans',
        role: 'body',
        use: 'body 16px/1.5 400, card titles 18px 500, KPI numbers 22px 600 tabular, chips 15px',
      },
    ],
    replaces: {
      Manrope: 'Plus Jakarta Sans',
      Inter: 'Merriweather Sans',
    },
    why: 'Plus Jakarta Sans gives steady geometric headings, and Merriweather Sans is a humanist sans with an organic, grounded feel that suits the sage and botanical palette.',
  },
  hedgewise: {
    faces: [
      {
        family: 'M PLUS Rounded 1c',
        role: 'display',
        use: 'hero 68px 700, H2 40px 600, -1px tracking; buttons 16px 700',
      },
      {
        family: 'M PLUS Rounded 1c',
        role: 'body',
        use: 'lead 18px/1.6 500, body 16px/1.6',
      },
    ],
    replaces: {
      Manrope: 'M PLUS Rounded 1c',
    },
    why: 'M PLUS Rounded 1c is a rounded geometric sans with a strong 700, which keeps the tight, confident trading-floor headlines friendly against black and lime.',
  },
  idrelle: {
    faces: [
      {
        family: 'Glory',
        role: 'display',
        use: 'H1 80px 500, -0.02em; H2 56px; big numbers 72px 400',
      },
      {
        family: 'Glory',
        role: 'body',
        use: 'body 16px/1.5 400, chips 14px, widget labels 12px, tabular figures',
      },
    ],
    replaces: {
      'Plus Jakarta Sans': 'Glory',
    },
    why: 'Glory is a sleek geometric sans with a light-to-bold range that looks premium at 80px and neat at 12px, suiting night-mode analytics with one electric accent.',
  },
  imbrosa: {
    faces: [
      {
        family: 'Be Vietnam Pro',
        role: 'display',
        use: 'H1 67px 500, H2 50px, -0.04em; big metrics 64px 600',
      },
      {
        family: 'Be Vietnam Pro',
        role: 'body',
        use: 'body 16px/1.5 400-500, subline 18px',
      },
      {
        family: 'Martian Mono',
        role: 'mono',
        use: 'eyebrow chips and beta badge 12px uppercase +0.08em',
      },
    ],
    replaces: {
      'JetBrains Mono': 'Martian Mono',
    },
    why: "Be Vietnam Pro keeps the confident launch-ready type as named, and Martian Mono's wide, engineered letters make the eyebrow chips and beta badge look deliberate.",
  },
  jorvale: {
    faces: [
      {
        family: 'Libre Franklin',
        role: 'display',
        use: 'H1 56px 500 at -2px, H2 36px at -1.5px',
      },
      {
        family: 'Open Sans',
        role: 'body',
        use: 'body 16px/1.8 400-500, captions 14px, widget labels 12px, widget numbers 400 at 32px+',
      },
    ],
    replaces: {
      Geist: 'Libre Franklin',
      Inter: 'Open Sans',
    },
    why: 'Libre Franklin gives friendly, trustworthy headlines with real grotesk character, and Open Sans is an open, highly legible body for a human CRM full of real photography.',
  },
  juvelle: {
    faces: [
      {
        family: 'Inclusive Sans',
        role: 'display',
        use: 'H1 80px 700 at -1.5px, H2 56px at -0.5px',
      },
      {
        family: 'Inclusive Sans',
        role: 'body',
        use: 'lead 18px/1.8, body 16px/1.6 400, buttons 18px 500',
      },
    ],
    replaces: {
      Figtree: 'Inclusive Sans',
    },
    why: 'Inclusive Sans is a friendly, highly legible sans with a sturdy bold, so heavy headlines on saturated colour blocks stay clear and playful.',
  },
  kavindo: {
    faces: [
      {
        family: 'Schibsted Grotesk',
        role: 'display',
        use: 'H1 64px 500 at -0.055em, H2 44px, tool titles 22px',
      },
      {
        family: 'Public Sans',
        role: 'body',
        use: 'body 16px/1.6 400-500, captions 14px, widget labels 12px with tabular numerals',
      },
    ],
    replaces: {
      Geist: 'Schibsted Grotesk',
      Inter: 'Public Sans',
    },
    why: 'Schibsted Grotesk holds very tight display tracking without clogging, and Public Sans is a plain, system-like neutral that lets the blueprint widgets speak.',
  },
  etchlight: {
    faces: [
      {
        family: 'Archivo',
        role: 'display',
        use: 'H1 64px / 36px 500, H2 48px / 30px',
      },
      {
        family: 'Roboto',
        role: 'body',
        use: 'body 16px/1.6 400',
      },
      {
        family: 'Roboto Mono',
        role: 'mono',
        use: 'buttons 14px uppercase +0.06em, feature titles 15px 600, labels and code 13-14px',
      },
    ],
    replaces: {},
    why: "All three named faces are kept: Archivo's grotesk headings, Roboto's neutral body and Roboto Mono's terminal labels already form a set no other template uses.",
  },
  kalvero: {
    faces: [
      {
        family: 'TikTok Sans',
        role: 'display',
        use: 'hero 100px 500 at -0.05em, titles 96px, statements 35px, tile titles 28px, display optical size',
      },
      {
        family: 'TikTok Sans',
        role: 'body',
        use: 'body 16px/1.5 400, index labels and notes 14px',
      },
    ],
    replaces: {
      Inter: 'TikTok Sans',
    },
    why: 'TikTok Sans has the optical-size axis the design relies on, so the extreme 100px headlines tighten properly while the 16px body stays open in the engineering-lab bento.',
  },
  lookwell: {
    faces: [
      {
        family: 'Hedvig Letters Serif',
        role: 'display',
        use: 'H1/H2 48-56px 400, -0.02em; stats 56px',
      },
      {
        family: 'Red Hat Text',
        role: 'body',
        use: 'body and UI 16px/1.55, dense four-up rows 15px',
      },
      {
        family: 'Roboto Mono',
        role: 'mono',
        use: 'eyebrows 12px uppercase +0.08em, timeline times with tabular numerals',
      },
    ],
    replaces: {
      Inter: 'Red Hat Text',
    },
    why: 'Hedvig Letters Serif and Roboto Mono keep the newspaper headline and timestamp voices, and Red Hat Text is a sober small-size text face that suits a quiet monitoring tool.',
  },
  eyeshelf: {
    faces: [
      {
        family: 'Zalando Sans Expanded',
        role: 'display',
        use: 'section headings 28px, spotlight title 48px / 32px, 700 uppercase +0.05em',
      },
      {
        family: 'Zalando Sans',
        role: 'body',
        use: 'body 16px/1.5 400/500, card titles 15px 500 uppercase, badges and buttons 12-13px uppercase',
      },
    ],
    replaces: {
      Syne: 'Zalando Sans Expanded',
      Unbounded: 'Zalando Sans Expanded',
      Inter: 'Zalando Sans',
    },
    phrases: {
      'Syne 700 in uppercase or Unbounded 600':
        'Zalando Sans Expanded 700 in uppercase',
      'Syne 700 uppercase (or Unbounded 600)':
        'Zalando Sans Expanded 700 uppercase',
    },
    why: 'Zalando Sans Expanded supplies the wide, extended uppercase grotesk the directory headings describe, and its normal-width sibling keeps the body a matched neo-grotesk.',
  },
  fairholt: {
    faces: [
      {
        family: 'Funnel Sans',
        role: 'display',
        use: 'H1 100px / 56px 600, -0.015em; H2 48px / 32px 600',
      },
      {
        family: 'Georama',
        role: 'body',
        use: 'body 16px/1.5 500, card titles 20px 600, stat values 24px 600 tabular, trust badges 15px',
      },
    ],
    replaces: {
      'Bricolage Grotesque': 'Funnel Sans',
      Inter: 'Georama',
    },
    phrases: {
      'H2 48/32px Bricolage 600': 'H2 48/32px Funnel Sans 600',
    },
    why: 'Funnel Sans has a bright, characterful 600 that reads as optimistic at 100px over the sky, and Georama is a clear grotesk with tabular figures for the money data.',
  },
  gildway: {
    faces: [
      {
        family: 'Space Grotesk',
        role: 'display',
        use: 'headings 60px / 58px 500, stats 40px',
      },
      {
        family: 'Outfit',
        role: 'body',
        use: 'body 16px/1.6 400 +0.02em, subheads 20px 500, buttons 15px 500, tabular card numbers',
      },
    ],
    replaces: {},
    why: "Both named faces are kept: Space Grotesk's quirky grotesk headings and Outfit's open geometric body make everyday money feel bright and friendly, in a pairing not used elsewhere.",
  },
  hexledger: {
    faces: [
      {
        family: 'Comme',
        role: 'display',
        use: 'hero 96px 700 at -0.01em, H2 72px 700, H3 40px 700',
      },
      {
        family: 'Comme',
        role: 'body',
        use: 'body 16px/1.6 500, labels 14px, eyebrow pills 13px uppercase +0.06em',
      },
    ],
    replaces: {
      Inter: 'Comme',
    },
    why: 'Comme is a geometric sans with genuinely heavy weights, so the 96px gradient headline has nightclub presence while the body stays simple on black.',
  },
  kopara: {
    faces: [
      {
        family: 'Lexend',
        role: 'display',
        use: 'H1 51px 600 at -0.02em, H2 46px at -0.04em, pull-quote 28px 600',
      },
      {
        family: 'Hanken Grotesk',
        role: 'body',
        use: 'body 16px/1.5 400, captions 14px, nav 15px, tabular stat figures',
      },
    ],
    replaces: {
      Outfit: 'Lexend',
      Inter: 'Hanken Grotesk',
    },
    why: "Lexend's open geometric shapes keep the warm, premium headings friendly, and Hanken Grotesk is a close neo-grotesk stand-in that stays neutral in the finance dashboard.",
  },
  levelbook: {
    faces: [
      {
        family: 'Geist',
        role: 'display',
        use: 'hero 64px 300, H2 46px 400, -0.05em; big stats 56px 300',
      },
      {
        family: 'Geist',
        role: 'body',
        use: 'body 17px/1.6 400',
      },
      {
        family: 'Chivo Mono',
        role: 'mono',
        use: 'eyebrows and quote attributions 12px uppercase +0.08em',
      },
    ],
    replaces: {},
    why: 'Geist and Chivo Mono are kept as named; a light Geist display with a small mono label is exactly the grown-up, understated finance voice described, in a pairing no other template uses.',
  },
  limepurse: {
    faces: [
      {
        family: 'Baloo Da 2',
        role: 'display',
        use: 'H1 48px, H2 36px, 700, line-height 1.1',
      },
      {
        family: 'Mulish',
        role: 'body',
        use: 'body 16px/1.6 400-500, leads 18px, UI mocks and amounts with tabular numerals, tag pills 14px 500',
      },
    ],
    replaces: {
      Inter: 'Mulish',
    },
    why: 'Baloo Da 2 keeps the warm, rounded headings as named, and Mulish is a clean, minimal sans that stays light and tidy in the card and transaction mocks.',
  },
  evenheart: {
    faces: [
      {
        family: 'Inter Tight',
        role: 'display',
        use: 'display 52px / 36px 300, statement text 40px / 28px 300',
      },
      {
        family: 'Wix Madefor Text',
        role: 'body',
        use: 'body 16px/1.5 400, numbered list 16px, buttons 15px 500',
      },
    ],
    replaces: {
      Inter: 'Wix Madefor Text',
    },
    why: 'Inter Tight keeps the thin, confident golden-hour headlines as named, and Wix Madefor Text is a warm, readable text grotesk that stays hushed beneath them.',
  },
  gadabout: {
    faces: [
      {
        family: 'Ysabeau Office',
        role: 'display',
        use: 'hero 82px 400 at -0.04em, H2 54px, H3 26px',
      },
      {
        family: 'Ysabeau Office',
        role: 'body',
        use: 'body 18px/1.55, hero subcopy 25px 500, eyebrows 12px uppercase +0.08em',
      },
    ],
    replaces: {
      Onest: 'Ysabeau Office',
    },
    why: 'Ysabeau Office is a lively humanist sans that can carry the whole page at regular weight, giving the evenings-out posters a social warmth while hierarchy comes from size.',
  },
  hivelight: {
    faces: [
      {
        family: 'Plus Jakarta Sans',
        role: 'display',
        use: 'hero 64px 500, H2 48px, -0.05em',
      },
      {
        family: 'Rubik',
        role: 'body',
        use: 'body 16px/1.6 500, component labels 14px, eyebrow tags 13px uppercase +0.1em',
      },
    ],
    replaces: {
      Inter: 'Rubik',
    },
    why: "Plus Jakarta Sans keeps the sleek medium-weight display as named, and Rubik's slightly rounded corners add candy-bright playfulness to the developer-grade UI.",
  },
  jaxtrel: {
    faces: [
      {
        family: 'Montserrat Alternates',
        role: 'display',
        use: 'H1 56px 600, H2 40px, big stats 40px 600',
      },
      {
        family: 'Montserrat Alternates',
        role: 'body',
        use: "body 16px/1.5 400-500, chips 16px 600 with a '#' prefix, captions 14px",
      },
    ],
    replaces: {
      Outfit: 'Montserrat Alternates',
    },
    why: 'Montserrat Alternates is one geometric family with playful alternate letterforms, so the whole startup page stays bold and cheeky in a single voice.',
  },
  lilaboard: {
    faces: [
      {
        family: 'Wix Madefor Display',
        role: 'display',
        use: 'display 62px 800 at -0.04em, H2 48px 800, stats 56px 800',
      },
      {
        family: 'Wix Madefor Display',
        role: 'body',
        use: 'body 16-18px/1.6 500, labels 13px 700 uppercase +0.06em',
      },
    ],
    replaces: {
      Manrope: 'Wix Madefor Display',
    },
    why: 'Wix Madefor Display has a round, confident 800 that makes the candy-coloured numbers feel approachable, and its 500 is comfortable for body copy.',
  },
  loopreel: {
    faces: [
      {
        family: 'Commissioner',
        role: 'display',
        use: 'hero 80px 600 at -0.06em, H2 56px at -0.04em, step titles 22px 600',
      },
      {
        family: 'Commissioner',
        role: 'body',
        use: 'body 17px/1.55 500 at -0.01em, buttons 16px 500',
      },
    ],
    replaces: {
      Inter: 'Commissioner',
    },
    why: 'Commissioner is a clean, low-contrast grotesk that tightens gracefully at 80px, keeping the white gallery glossy and minimal around the colourful posters.',
  },
  lostlane: {
    faces: [
      {
        family: 'AR One Sans',
        role: 'display',
        use: 'heading 40px 600 at -0.02em, status eyebrow 14px 600 uppercase +0.08em',
      },
      {
        family: 'AR One Sans',
        role: 'body',
        use: 'body 16px/1.6 400',
      },
    ],
    replaces: {
      Inter: 'AR One Sans',
    },
    why: 'AR One Sans is a calm, polished sans with a soft personality, which keeps a short apology forgiving over the busy gallery mosaic.',
  },
  folkwise: {
    faces: [
      {
        family: 'TASA Orbiter',
        role: 'display',
        use: 'H1 60px / 36px 500, H2 40px / 28px 700, card titles 20px 700',
      },
      {
        family: 'TASA Orbiter',
        role: 'body',
        use: 'body 16px/1.5 400, nav links 14px 500, tables 15px, chips 13px',
      },
    ],
    replaces: {
      'Plus Jakarta Sans': 'TASA Orbiter',
    },
    why: 'TASA Orbiter is an airy geometric grotesk that keeps HR data organised and bright rather than corporate, clean at both 60px and dense table sizes.',
  },
  hireloom: {
    faces: [
      {
        family: 'Mona Sans',
        role: 'display',
        use: 'hero 60px 600, H2 48px, card titles 28px',
      },
      {
        family: 'Familjen Grotesk',
        role: 'body',
        use: 'lead 18px/1.6, body 16px/1.6 400, eyebrow 12px uppercase +0.08em',
      },
    ],
    replaces: {},
    why: 'Both named faces are kept: Mona Sans gives the wide-ish, humane headings and Familjen Grotesk a friendly body, a pairing no other template uses.',
  },
  gumleaf: {
    faces: [
      {
        family: 'Belanosima',
        role: 'display',
        use: 'hero 42px 600, H2 32-42px, card titles 20px',
      },
      {
        family: 'Cabin',
        role: 'body',
        use: 'body 16px/1.6 400, buttons 14px 600, eyebrows 12px uppercase 600 +0.06em',
      },
    ],
    replaces: {
      'Bricolage Grotesque': 'Belanosima',
      Inter: 'Cabin',
    },
    why: 'Belanosima is a chunky, slightly quirky grotesk that brings neighbourhood-cafe cheer to the dark-green headings, and Cabin is a down-to-earth humanist body.',
  },
  heathmere: {
    faces: [
      {
        family: 'National Park',
        role: 'display',
        use: 'hero 68px 500 at -0.045em, H2 44px at -0.04em, metrics 40px 500',
      },
      {
        family: 'National Park',
        role: 'body',
        use: 'body 16px/1.6 400, eyebrows 12px uppercase 600 +0.08em, metric labels 12px uppercase',
      },
    ],
    replaces: {
      Inter: 'National Park',
    },
    why: 'National Park grew out of park signage, so its clear, outdoorsy letterforms suit the sky-and-meadow pages while staying calm and intelligent for marketing data.',
  },
  ilmora: {
    faces: [
      {
        family: 'Mona Sans',
        role: 'display',
        use: 'hero 42px, section H2 52px, weight 400, -0.01em',
      },
      {
        family: 'Mona Sans',
        role: 'body',
        use: 'body 16px/1.6 400, captions 14px, chips 12px medium, tabular metric figures',
      },
    ],
    replaces: {
      'Inter Tight': 'Mona Sans',
    },
    why: 'Mona Sans at regular weight has the clinical precision of a lab report, with tabular figures for the metric cards and a calm, premium texture.',
  },
  kinnaro: {
    faces: [
      {
        family: 'Afacad Flux',
        role: 'display',
        use: 'H1 80px 500 at -0.05em, H2 56px at -0.04em, stat numbers 40px 500',
      },
      {
        family: 'Afacad Flux',
        role: 'body',
        use: 'body 16px/1.5 400, eyebrows 13px uppercase +0.3em',
      },
    ],
    replaces: {
      Manrope: 'Afacad Flux',
    },
    why: 'Afacad Flux is a soft, open sans with a wide weight range, which keeps the pastel, floating-shape pages friendly and futuristic without looking cold.',
  },
  loudbeam: {
    faces: [
      {
        family: 'Wix Madefor Text',
        role: 'display',
        use: 'hero 56px 600, H2 36px 500, big stats 72px 500',
      },
      {
        family: 'Wix Madefor Text',
        role: 'body',
        use: 'lead 18px, body 16px/1.6 400, tag pills 14px 500',
      },
    ],
    replaces: {
      Inter: 'Wix Madefor Text',
    },
    why: 'Wix Madefor Text is a bright, legible grotesk with open counters, which keeps the sunny marketing cockpit clean and results-driven in a single family.',
  },
  edgemere: {
    faces: [
      {
        family: 'Red Hat Text',
        role: 'display',
        use: 'H1 44px / 34px 600, H2 40px / 28px, -0.02em; stats 56px 600',
      },
      {
        family: 'Red Hat Text',
        role: 'body',
        use: 'lede 17px, body 16px/1.5 500, form inputs 16px',
      },
    ],
    replaces: {
      Inter: 'Red Hat Text',
    },
    why: 'Red Hat Text has a businesslike clarity that suits a content platform with a lead form, and it stays firm at 600 for the headings.',
  },
  fennmint: {
    faces: [
      {
        family: 'Fira Sans',
        role: 'display',
        use: 'display 56px / 36px 500 at -0.05em, H2 40px at -0.04em, bento titles 24px',
      },
      {
        family: 'Fira Sans',
        role: 'body',
        use: 'body 16px/1.5 400/500, mock UI text 12px minimum',
      },
    ],
    replaces: {
      Inter: 'Fira Sans',
    },
    why: 'Fira Sans is a focused, highly legible sans with plenty of weights, so the near-black work surfaces and small mock UI text both stay crisp beside the mint signal.',
  },
  gainline: {
    faces: [
      {
        family: 'Inter Tight',
        role: 'display',
        use: 'hero 48px 700, H2 32px',
      },
      {
        family: 'Host Grotesk',
        role: 'body',
        use: 'body 16px/1.6 400 +0.01em, eyebrows 14px 500, widget labels 12px',
      },
    ],
    replaces: {},
    why: 'The named pairing is kept: compact bold Inter Tight headlines over the friendly Host Grotesk body give the bright, no-nonsense desk feel, and no other template uses it.',
  },
  halyard: {
    faces: [
      {
        family: 'PT Sans',
        role: 'display',
        use: 'hero 42px 700, H2 36px 700, card titles 16px 700',
      },
      {
        family: 'PT Sans',
        role: 'body',
        use: 'body 16px/1.6 400, micro labels 12px uppercase +0.06em',
      },
    ],
    replaces: {
      Roboto: 'PT Sans',
    },
    why: 'PT Sans is a dependable, neutral workhorse with a quiet humanist touch, so attention stays on the glowing UI panels in the studio-lit dark room.',
  },
  jantree: {
    faces: [
      {
        family: 'Plus Jakarta Sans',
        role: 'display',
        use: 'H1 72px 600, H2 48px, card titles 18px',
      },
      {
        family: 'Golos Text',
        role: 'body',
        use: 'subline 18px/1.55, card copy 16px/1.5 400-500, mock table text 14px',
      },
    ],
    replaces: {
      'DM Sans': 'Plus Jakarta Sans',
      'Albert Sans': 'Golos Text',
    },
    why: 'Plus Jakarta Sans gives bold, tight headlines with a modern geometric edge, and Golos Text is a sturdy UI grotesk that keeps the dashboard mock and muted body clear.',
  },
  kovalen: {
    faces: [
      {
        family: 'Radio Canada',
        role: 'display',
        use: 'H1 72px 400 at -0.03em, H2 48px 400',
      },
      {
        family: 'Radio Canada',
        role: 'body',
        use: 'body 16px/1.55 400-500, captions 14px, chip labels 13px',
      },
    ],
    replaces: {
      Inter: 'Radio Canada',
    },
    phrases: {
      'Inter with the display optical size (opsz 32), 400 weight':
        'Radio Canada 400',
      'Inter (Google Fonts, opsz axis) at 400 for display':
        'Radio Canada (Google Fonts) at 400 for display',
    },
    why: 'Radio Canada has open, humane shapes that stay composed at regular weight, which gives the deep-teal pages their calm, editorial headlines.',
  },
  cedarglow: {
    faces: [
      {
        family: 'Mozilla Text',
        role: 'display',
        use: 'headline 80px / 44px 500 at -0.02em, prices 56px 500 tabular',
      },
      {
        family: 'Mozilla Text',
        role: 'body',
        use: 'body 16px/1.5 400/500, per-unit labels 12px',
      },
    ],
    replaces: {
      Inter: 'Mozilla Text',
    },
    phrases: {
      'the observed face is Inter so no mapping is needed':
        'Mozilla Text stands in for the observed face',
    },
    why: 'Mozilla Text is a clean, calm grotesk with a firm 500, so the lit featured plan and its large tabular prices look premium on the near-black teal.',
  },
  dimeplan: {
    faces: [
      {
        family: 'Barlow',
        role: 'display',
        use: 'heading 60px / 36px 800, prices 48px 800 tabular, plan names 24px 600',
      },
      {
        family: 'Barlow',
        role: 'body',
        use: 'body 16px/1.5 400, subtitle 24px, caption 12px uppercase +0.3em',
      },
    ],
    replaces: {
      Inter: 'Barlow',
    },
    phrases: {
      'Inter is the nearest Google Font': 'Barlow stands in for it',
    },
    why: "Barlow's slightly rounded, low-contrast grotesk has a stark 800 that looks developer-plain on pure black.",
  },
  doorfee: {
    faces: [
      {
        family: 'Reddit Sans',
        role: 'display',
        use: 'card titles 24px 600, banner headline 64px 800 uppercase +0.02em',
      },
      {
        family: 'Reddit Sans',
        role: 'body',
        use: 'body 16px/1.5 400',
      },
      {
        family: 'Reddit Mono',
        role: 'mono',
        use: 'hint chip 14px with the file path in 700',
      },
    ],
    replaces: {
      Inter: 'Reddit Sans',
      'JetBrains Mono': 'Reddit Mono',
    },
    why: 'Reddit Sans and Reddit Mono are a matched pair, friendly and legible for a light developer starter, with a heavy weight for the uppercase banner.',
  },
  duesworth: {
    faces: [
      {
        family: 'Ubuntu Sans',
        role: 'display',
        use: 'panel titles 24px 600 at -0.02em, prices 20px 600',
      },
      {
        family: 'Ubuntu Sans',
        role: 'body',
        use: 'body 16px/1.5 400, smallest label 12px',
      },
      {
        family: 'Ubuntu Sans Mono',
        role: 'mono',
        use: 'ids and dates in tables 14px',
      },
    ],
    replaces: {
      Geist: 'Ubuntu Sans',
      'Geist Mono': 'Ubuntu Sans Mono',
    },
    why: 'Ubuntu Sans and its mono are a matched, utilitarian pair with a faint warmth that suits the quiet brown-vignetted settings screens.',
  },
  bramblecast: {
    faces: [
      {
        family: 'Open Sans',
        role: 'display',
        use: 'hero 60px 800 at -0.025em, feature titles 18px 700',
      },
      {
        family: 'Open Sans',
        role: 'body',
        use: 'intro 20px/1.5 400, descriptions 16px/1.5',
      },
    ],
    replaces: {
      Inter: 'Open Sans',
    },
    phrases: {
      'Inter is the closest Google Font': 'Open Sans stands in for it',
      'Inter (closest Google Font to the observed system stack)':
        'Open Sans (standing in for the observed system stack)',
    },
    why: 'Open Sans has the plain, system-font feel of an engineering checklist and a true 800 for the hero, so the page reads as organised rather than salesy.',
  },
  copperkey: {
    faces: [
      {
        family: 'Kumbh Sans',
        role: 'display',
        use: 'headline 56px / 40px 700 at -0.02em, feature titles 18px 600',
      },
      {
        family: 'Kumbh Sans',
        role: 'body',
        use: 'body 16px/1.6 400/500',
      },
      {
        family: 'Fira Code',
        role: 'mono',
        use: 'terminal commands 14px',
      },
    ],
    replaces: {
      Manrope: 'Kumbh Sans',
      'JetBrains Mono': 'Fira Code',
    },
    why: 'Kumbh Sans is a tidy, friendly geometric grotesk for the warm-orange starter, and Fira Code gives the typed terminal its familiar developer look.',
  },
  dashkite: {
    faces: [
      {
        family: 'Hubot Sans',
        role: 'display',
        use: 'headline 48px / 36px 800 at -0.01em, card titles 20px 700',
      },
      {
        family: 'Hubot Sans',
        role: 'body',
        use: 'body 16px/1.6 400/500, small labels 14px',
      },
      {
        family: 'Source Code Pro',
        role: 'mono',
        use: 'install chip 15px',
      },
    ],
    replaces: {
      Inter: 'Hubot Sans',
      'JetBrains Mono': 'Source Code Pro',
    },
    phrases: {
      '(observed a system sans; Inter is the closest Google Font)':
        '(observed a system sans; Hubot Sans stands in for it)',
    },
    why: 'Hubot Sans has a heavy, energetic black weight that suits an open-source boilerplate on a dark page, and Source Code Pro keeps the install chip crisp and familiar.',
  },
  bellfound: {
    faces: [
      {
        family: 'Georama',
        role: 'display',
        use: 'title 80px 200',
      },
      {
        family: 'Georama',
        role: 'body',
        use: 'todo labels and input 20px 400 (italic placeholder), footer 16px 400, tabular counts',
      },
    ],
    replaces: {
      'Work Sans': 'Georama',
    },
    why: 'Georama has a clean neo-grotesk 200 that looks refined at 80px and a steady regular for the list, so the textbook todo app stays calm and utilitarian.',
  },
  brookmail: {
    faces: [
      {
        family: 'Geist',
        role: 'display',
        use: 'title 60px 500 at -0.025em, panel titles 16px 500',
      },
      {
        family: 'Geist',
        role: 'body',
        use: 'body 15-16px/1.6 400, snippets 14px, uppercase labels 12px +0.15em',
      },
      {
        family: 'Intel One Mono',
        role: 'mono',
        use: 'addresses, tool names and privacy note 13px',
      },
    ],
    replaces: {
      'Geist Mono': 'Intel One Mono',
    },
    why: 'Geist is kept for the notebook-like text, and Intel One Mono, drawn for clarity at small sizes, makes the 13px addresses and tool calls easy to scan.',
  },
  chorusdesk: {
    faces: [
      {
        family: 'Ancizar Sans',
        role: 'display',
        use: 'hero headline 48px 800, section headings 24px 700, card titles 16px 600',
      },
      {
        family: 'Ancizar Sans',
        role: 'body',
        use: 'body 16px/1.5 400, lead 20px, cursor name flags 12px 500',
      },
    ],
    replaces: {
      Inter: 'Ancizar Sans',
    },
    why: 'Ancizar Sans is a plain, neutral sans with a wide weight range, so the almost monochrome editor lets the coloured cursors and avatars carry the liveness.',
  },
  bluequill: {
    faces: [
      {
        family: 'Gabarito',
        role: 'display',
        use: 'page title 24px 600, KPI numbers 20px 600 tabular, card titles 16px 500',
      },
      {
        family: 'Gabarito',
        role: 'body',
        use: 'body 14-16px 400, captions and axis labels 12px',
      },
    ],
    replaces: {},
    why: 'Gabarito is kept as named: a rounded geometric sans with tabular numerals that makes saturated blue charts feel bright and orderly, and no other template uses it.',
  },
  courierform: {
    faces: [
      {
        family: 'Libre Franklin',
        role: 'display',
        use: 'page titles 20px 600, stat numbers 24px 600 tabular',
      },
      {
        family: 'Libre Franklin',
        role: 'body',
        use: 'body 16px/1.5 400, tables 15px, labels 12px uppercase +0.05em',
      },
      {
        family: 'Cousine',
        role: 'mono',
        use: 'endpoint ids and JSON 14px',
      },
    ],
    replaces: {
      Inter: 'Libre Franklin',
      'JetBrains Mono': 'Cousine',
    },
    why: 'Libre Franklin is a workmanlike grotesk that stays clear in tables and labels, and Cousine is a plain, neutral monospace for endpoint ids and JSON.',
  },
  alderpin: {
    faces: [
      {
        family: 'Hind',
        role: 'display',
        use: 'section titles 18px 600, preview name 22px 600',
      },
      {
        family: 'Hind',
        role: 'body',
        use: 'inputs and helper text 16px/1.5 400, field labels 14px 500',
      },
    ],
    replaces: {
      'Nunito Sans': 'Hind',
    },
    why: 'Hind is a plain, open sans that stays clear at 14-18px, so the form-first builder feels like a tidy settings page while the preview does the showing off.',
  },
  bookwren: {
    faces: [
      {
        family: 'Readex Pro',
        role: 'display',
        use: 'title 30px 700, H1 24px, H2 20px, H3 18px',
      },
      {
        family: 'Readex Pro',
        role: 'body',
        use: 'prose 16px/1.75 400, menu titles 14px 500, descriptions 12-13px',
      },
      {
        family: 'Google Sans Code',
        role: 'mono',
        use: 'code 14px',
      },
    ],
    replaces: {
      Inter: 'Readex Pro',
      Manrope: 'Readex Pro',
      'JetBrains Mono': 'Google Sans Code',
    },
    phrases: {
      'Inter 700 (a geometric display face similar to the observed one also works, e.g. Manrope)':
        'Readex Pro 700',
    },
    why: 'Readex Pro is a geometric sans with generous proportions that reads well at 16px/1.75 for long writing, and Google Sans Code keeps code blocks clean beside it.',
  },
  coquill: {
    faces: [
      {
        family: 'Sen',
        role: 'display',
        use: 'page titles 24px 600, document H1 32px',
      },
      {
        family: 'Merriweather Sans',
        role: 'body',
        use: 'body 16px/1.6 400, list row names 14px 500, emails 14px',
      },
      {
        family: 'Ubuntu Mono',
        role: 'mono',
        use: 'code 14px',
      },
    ],
    replaces: {
      Urbanist: 'Sen',
      Inter: 'Merriweather Sans',
      'JetBrains Mono': 'Ubuntu Mono',
    },
    phrases: {
      '(observed a system sans; Inter is the closest Google Font)':
        '(observed a system sans; Merriweather Sans stands in for it)',
    },
    why: 'Sen is a friendly geometric sans for titles, Merriweather Sans gives the documents a papery, humane body, and Ubuntu Mono keeps code quiet.',
  },
  arcwell: {
    faces: [
      {
        family: 'Asap',
        role: 'display',
        use: 'hero 48px 500, H2 36px, -0.025em, Title Case; prices 32px 700 tabular',
      },
      {
        family: 'Asap',
        role: 'body',
        use: 'body 16px/1.5 400, subheads 18px, eyebrows 14px 700 uppercase +0.08em',
      },
    ],
    replaces: {
      Inter: 'Asap',
    },
    phrases: {
      'Inter 500 (observed Inter variable)':
        'Asap 500 (standing in for the observed variable sans)',
    },
    why: 'Asap is a crisp, dependable sans with a slightly rounded finish, so medium-weight headlines look calm and a little corporate against lots of white.',
  },
  aspenfold: {
    faces: [
      {
        family: 'Baskervville',
        role: 'display',
        use: 'headings 44px / 32px / 22px 700, -0.01em',
      },
      {
        family: 'Lato',
        role: 'body',
        use: 'body 16px/1.6 400, captions 14px',
      },
      {
        family: 'Atkinson Hyperlegible',
        role: 'accent',
        use: 'all-sans theme preset',
      },
      {
        family: 'Anonymous Pro',
        role: 'mono',
        use: 'mono-accent theme preset',
      },
    ],
    replaces: {
      Lora: 'Baskervville',
      Inter: 'Atkinson Hyperlegible',
      'JetBrains Mono': 'Anonymous Pro',
    },
    why: 'Baskervville is a bookish transitional serif that gives the boutique-agency headings their editorial calm, the named Lato body is kept, and the two theme presets get their own sans and mono.',
  },
  axlewood: {
    faces: [
      {
        family: 'Mozilla Headline',
        role: 'display',
        use: 'hero 72px 400 at -0.05em, section heads 48px, proof headline 30px 700',
      },
      {
        family: 'Mozilla Headline',
        role: 'body',
        use: 'body 16px/1.5 400, subline 20px, card titles 18px 700',
      },
    ],
    replaces: {
      'Inter Tight': 'Mozilla Headline',
    },
    why: 'Mozilla Headline is a sleek grotesk drawn for large sizes, so the regular-weight 72px headings with tight tracking look quiet and premium on the dark launch page.',
  },
  birchline: {
    faces: [
      {
        family: 'Winky Sans',
        role: 'display',
        use: 'hero 72px 700 at -0.05em, H2 48px at -0.025em, feature titles 18px 700',
      },
      {
        family: 'Winky Sans',
        role: 'body',
        use: 'body 16-18px/1.6 400',
      },
      {
        family: 'Reddit Sans',
        role: 'body',
        use: 'the quieter body alternative, 16-18px 400',
      },
    ],
    replaces: {
      'Bricolage Grotesque': 'Winky Sans',
      Inter: 'Reddit Sans',
    },
    why: 'Winky Sans is an expressive, cheeky grotesk that can carry the whole brand at 72px beside the cartoon, with Reddit Sans as the quieter body the design allows.',
  },
  brightmoor: {
    faces: [
      {
        family: 'Manrope',
        role: 'display',
        use: 'headings 60px / 48px / 20px 700, line-height 1.25',
      },
      {
        family: 'Source Sans 3',
        role: 'body',
        use: 'body 18px/1.55 400, bullets 16px, prices 44px 700 tabular, labels 14px 700 uppercase',
      },
    ],
    replaces: {},
    why: "The observed pairing is kept: Manrope's rounded-geometric headings over the friendly humanist Source Sans 3 feel optimistic and safe for money, and no other template pairs them.",
  },
  cosmoport: {
    faces: [
      {
        family: 'Exo 2',
        role: 'display',
        use: 'hero 96px / 40px 600 at -0.025em, section headings 36px 500, step numerals 128px 700',
      },
      {
        family: 'Exo 2',
        role: 'body',
        use: 'body 16px/1.5 400, subheads 20px, card titles 18px 600',
      },
    ],
    replaces: {
      Inter: 'Exo 2',
    },
    why: 'Exo 2 has a subtly technical, space-age geometry that makes the huge launch headlines feel cinematic while staying readable in the bento cards.',
  },
  baywick: {
    faces: [
      {
        family: 'Pontano Sans',
        role: 'display',
        use: 'domain title 30px 700 at -0.02em, tenant heading 36px 700',
      },
      {
        family: 'Pontano Sans',
        role: 'body',
        use: 'body 16px/1.5 400, labels 14px 500, helper text 14px',
      },
    ],
    replaces: {
      Inter: 'Pontano Sans',
    },
    why: 'Pontano Sans is a quiet, neutral sans with a component-library plainness, so the tenant emoji stays the only colour.',
  },
  dockhold: {
    faces: [
      {
        family: 'Overpass',
        role: 'display',
        use: 'titles 24px 600 at -0.025em, settings section titles 18px 600',
      },
      {
        family: 'Overpass',
        role: 'body',
        use: 'body 16px/1.5 400, pitch copy 18px 500, table 15px, labels 14px 500',
      },
    ],
    replaces: {
      Inter: 'Overpass',
    },
    why: 'Overpass descends from highway signage, so its clarity reads as serious and trustworthy in a monochrome identity product with no accent colour.',
  },
  amberkey: {
    faces: [
      {
        family: 'Alan Sans',
        role: 'display',
        use: 'headline 72px 700 at -0.025em, section headings 30px, stats 40px 700 tabular',
      },
      {
        family: 'Alan Sans',
        role: 'body',
        use: 'body 16px/1.5 400',
      },
      {
        family: 'Red Hat Mono',
        role: 'mono',
        use: 'secrets, IDs and links 14-16px',
      },
    ],
    replaces: {
      Inter: 'Alan Sans',
      'JetBrains Mono': 'Red Hat Mono',
    },
    why: 'Alan Sans gives terse, strong headings for the dark developer tool, and Red Hat Mono is a calm, readable mono for secrets that must be copied exactly.',
  },
  ashlight: {
    faces: [
      {
        family: 'Mozilla Text',
        role: 'display',
        use: 'hero headline 40px 700 at -0.02em, card titles 16px 700',
      },
      {
        family: 'Mozilla Text',
        role: 'body',
        use: 'synopsis 16px/1.5 400, chips and meta 12-14px 500, highlighted matches 600',
      },
      {
        family: 'DM Mono',
        role: 'mono',
        use: 'record-count caption digits',
      },
    ],
    replaces: {
      Inter: 'Mozilla Text',
      'JetBrains Mono': 'DM Mono',
    },
    why: 'Mozilla Text keeps the poster grid text clean and compact on dark navy, and DM Mono gives the optional record-count digits a soft, cinematic mono.',
  },
  cipherleaf: {
    faces: [
      {
        family: 'SUSE',
        role: 'display',
        use: 'headline 48px 600 at -0.04em, card titles 16px 500',
      },
      {
        family: 'SUSE',
        role: 'body',
        use: 'body 16px/1.6 400, card descriptions 14px',
      },
      {
        family: 'Fragment Mono',
        role: 'mono',
        use: 'ciphertext and code 14px',
      },
    ],
    replaces: {
      Inter: 'SUSE',
      'JetBrains Mono': 'Fragment Mono',
    },
    why: "SUSE is a clean geometric sans that keeps a security topic friendly, and Fragment Mono's grotesk-flavoured mono makes the ciphertext chips look tidy rather than intimidating.",
  },
  cuetide: {
    faces: [
      {
        family: 'Saira',
        role: 'display',
        use: 'headline 40px 600 at -0.02em, countdown numbers 28px 600 tabular',
      },
      {
        family: 'Saira',
        role: 'body',
        use: 'body 16px/1.5 400, unit labels 12px uppercase +0.08em, pill 12px uppercase +0.06em',
      },
    ],
    replaces: {
      Inter: 'Saira',
    },
    why: "Saira's squared, slightly technical forms suit a countdown, giving the digits energy while its regular weight keeps the waitlist copy restrained.",
  },
  dawnlist: {
    faces: [
      {
        family: 'Afacad',
        role: 'display',
        use: 'headline 48px / 36px 500 at -0.05em, section heading 28px 400',
      },
      {
        family: 'Afacad',
        role: 'body',
        use: 'body 16px/1.5 400, button 14px 500, pill 14px',
      },
    ],
    replaces: {
      Figtree: 'Afacad',
    },
    why: 'Afacad is a soft, minimal sans that looks hopeful and quiet at 500 with tight tracking, suiting the starry near-black page and its cream accent.',
  },
};
