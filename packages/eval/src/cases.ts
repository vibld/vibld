import type { GenerationPlan, ProjectFile } from '@vibld/core';

/**
 * The versioned prompt set.
 *
 * Versioned because a score is meaningless without knowing what was asked.
 * Changing a prompt, adding one, or changing what counts as success changes
 * the number, so `PROMPT_SET_VERSION` moves with it and every report carries
 * it. Comparing runs across versions is comparing different exams.
 */
export const PROMPT_SET_VERSION = '1.1.0';

export interface EvalCase {
  id: string;
  prompt: string;
  /** What a correct result must contain, beyond building at all. */
  expects: {
    /** Paths the accepted project must include. */
    files: string[];
    /** Text that must appear somewhere in the project's content. */
    content: string[];
  };
}

export const CASES: EvalCase[] = [
  {
    id: 'coffee-roaster',
    prompt:
      'A marketing site for an indie coffee roaster with features and testimonials',
    expects: {
      files: ['package.json', 'README.md', 'index.html'],
      content: ['coffee'],
    },
  },
  {
    id: 'security-saas',
    prompt:
      'A landing page for a cybersecurity SaaS with pricing, FAQ and a contact form',
    expects: {
      files: ['package.json', 'README.md', 'index.html'],
      content: ['pricing'],
    },
  },
  {
    id: 'dental-practice',
    prompt:
      'A site for a dental practice with opening hours, services and directions',
    expects: {
      files: ['package.json', 'README.md', 'index.html'],
      content: ['dental'],
    },
  },
  {
    id: 'freelance-portfolio',
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
      // "portable" is the claim the whole page exists to make. A generated
      // page that sells an AI builder without it has missed the brief, not
      // the styling.
      content: ['Vibld', 'waitlist', 'portable'],
    },
  },
  {
    id: 'conference',
    prompt:
      'A one-page site for a two-day developer conference with a schedule and speakers',
    expects: {
      files: ['package.json', 'README.md', 'index.html'],
      content: ['schedule'],
    },
  },
];

/**
 * A deterministic stand-in for a model, used so CI can exercise the harness
 * without credentials or spend.
 *
 * It is not a model and the harness says so in its report: a score measured
 * against this measures the machinery, not generation quality. The real
 * baseline needs a provider and an approved spend cap (#9, #18).
 *
 * It emits the same file set `PLAN_SYSTEM_PROMPT` requires of a real model,
 * rather than the minimum the older cases happened to assert. A stub that
 * produces less than the contract demands is not a stand-in: it passes cases
 * a real run would fail, and fails cases that ask for a file the contract
 * already requires.
 */
export function stubPlan(testCase: EvalCase): GenerationPlan {
  const subject = testCase.prompt.toLowerCase();
  const files: ProjectFile[] = [
    {
      path: 'package.json',
      content: JSON.stringify(
        {
          name: testCase.id,
          private: true,
          type: 'module',
          scripts: { dev: 'vite', build: 'vite build' },
          dependencies: { react: '19.2.0', 'react-dom': '19.2.0' },
        },
        null,
        2,
      ),
    },
    {
      path: 'README.md',
      content: `# ${testCase.id}\n\n${testCase.prompt}\n\n## Run it\n\n\`npm install\`, then \`npm run dev\`. \`npm run build\` produces the bundle.\n`,
    },
    {
      path: 'DESIGN.md',
      content: `---\nrounded: 4px\n---\n\n# Design\n\nPlaceholder tokens for: ${testCase.prompt}\n`,
    },
    {
      path: 'src/styles.css',
      content: ':root {\n  --background: #ffffff;\n  --primary: #1a1a1a;\n}\n',
    },
    {
      path: 'src/main.tsx',
      content:
        "import { createRoot } from 'react-dom/client';\nimport App from './App.tsx';\n\ncreateRoot(document.getElementById('root')!).render(<App />);\n",
    },
    {
      path: 'src/App.tsx',
      content: `export default function App() {\n  return <main>${testCase.id}</main>;\n}\n`,
    },
    {
      path: 'index.html',
      content: `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <title>${testCase.id}</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <!-- ${subject} -->\n  </body>\n</html>\n`,
    },
  ];
  return { summary: `Static site for: ${testCase.prompt}`, files };
}
