import type { GenerationPlan, ProjectFile } from '@vibld/core';

/**
 * The versioned prompt set.
 *
 * Versioned because a score is meaningless without knowing what was asked.
 * Changing a prompt, adding one, or changing what counts as success changes
 * the number, so `PROMPT_SET_VERSION` moves with it and every report carries
 * it. Comparing runs across versions is comparing different exams.
 */
export const PROMPT_SET_VERSION = '1.0.0';

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
      content: `# ${testCase.id}\n\n${testCase.prompt}\n`,
    },
    {
      path: 'index.html',
      content: `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <title>${testCase.id}</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <!-- ${subject} -->\n  </body>\n</html>\n`,
    },
  ];
  return { summary: `Static site for: ${testCase.prompt}`, files };
}
