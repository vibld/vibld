import type { DesignSpec } from '../../src/design-spec.ts';

/** A spec in the shape of a measured brief: values, copy verbatim, per-width changes. */
export const SPEC: DesignSpec = {
  intent:
    'A one-page newsletter signup for Asme, for readers who want one considered email a week.',
  tokens: {
    colors: [
      { name: 'navy', value: '#071722', use: 'manifesto background' },
      {
        name: 'scrim-top',
        value: 'rgba(2,10,18,.57)',
        use: 'hero overlay, top stop',
      },
      { name: 'ink-soft', value: '#c8d4db', use: 'secondary text' },
    ],
    fonts: [
      {
        role: 'display',
        family: 'Playfair Display',
        fallback: 'Georgia, serif',
        weights: [400],
      },
      {
        role: 'body',
        family: 'DM Sans',
        fallback: 'system-ui, sans-serif',
        weights: [400, 500, 600],
      },
    ],
    type: [
      {
        name: 'hero',
        size: 'clamp(4.3rem, 8.8vw, 8.3rem)',
        lineHeight: '0.99',
        letterSpacing: '-0.065em',
      },
    ],
    space: [{ name: 'gutter', value: '24px' }],
    radii: [{ name: 'pill', value: '999px' }],
    effects: [{ name: 'glass', value: 'backdrop-filter: blur(18px)' }],
  },
  sections: [
    {
      id: 'hero',
      purpose: 'Collect an email address',
      layout: 'centred column, max width 700px, 5.5vh below the nav',
      copy: [
        { role: 'heading', text: 'Know it all.' },
        { role: 'placeholder', text: 'Enter your email' },
      ],
    },
  ],
  breakpoints: [
    { maxWidth: 650, changes: ['hide Sign Up', 'content at 12vh'] },
  ],
  // Still, so the projects other tests build are not also held to motion;
  // design-checks.test.ts gives the motion rows their own spec.
  motion: [],
  do: ['Keep the hero scrim at rgba(2,10,18,.57) at the top'],
  avoid: ['A floating arrow button: it competes with the one form'],
  checks: ['The headline stays on one line at 1440px'],
};
