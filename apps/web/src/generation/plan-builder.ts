import type { GenerationPlan, ProjectFile } from '@vibld/core';
import type { ProjectBrief, SectionSpec } from './brief.ts';
import { deriveBrief } from './brief.ts';

/**
 * How a run should behave. `fail-validation` stages a file outside the
 * project root so the real validator rejects the checkpoint; it exists so the
 * failure path is reachable deterministically from the UI and from tests.
 */
export type PlanMode = 'succeed' | 'fail-validation';

function componentName(section: SectionSpec, index: number): string {
  const kind = section.kind;
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)}${index}`;
}

function sectionComponent(section: SectionSpec, index: number): ProjectFile {
  const name = componentName(section, index);
  const items =
    section.items.length > 0
      ? `      <ul>\n${section.items
          .map((item) => `        <li>${item}</li>`)
          .join('\n')}\n      </ul>\n`
      : '';

  return {
    path: `src/sections/${name}.tsx`,
    content: `export function ${name}() {
  return (
    <section className="section section--${section.kind}" aria-labelledby="${section.kind}-${index}">
      <h2 id="${section.kind}-${index}">${section.heading}</h2>
      <p>${section.body}</p>
${items}    </section>
  );
}
`,
  };
}

function appComponent(brief: ProjectBrief): ProjectFile {
  const sections = brief.sections.map((section, index) =>
    componentName(section, index),
  );
  const imports = sections
    .map((name) => `import { ${name} } from './sections/${name}.tsx';`)
    .join('\n');
  const rendered = sections.map((name) => `        <${name} />`).join('\n');

  return {
    path: 'src/App.tsx',
    content: `${imports}

export function App() {
  return (
    <div className="page">
      <header className="page__header">
        <p className="page__brand">${brief.title}</p>
      </header>
      <main>
${rendered}
      </main>
      <footer className="page__footer">
        <p>Generated with Vibld. This project is yours to edit and deploy.</p>
      </footer>
    </div>
  );
}
`,
  };
}

const STYLES = `:root {
  color-scheme: light dark;
  --page-fg: #16181d;
  --page-bg: #ffffff;
  --page-muted: #5b6070;
  --page-line: #e3e6ee;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root {
    --page-fg: #eef1f7;
    --page-bg: #14161b;
    --page-muted: #a5abbb;
    --page-line: #2a2e38;
  }
}

body {
  margin: 0;
  color: var(--page-fg);
  background: var(--page-bg);
}

.page {
  margin: 0 auto;
  max-width: 56rem;
  padding: 2rem 1.25rem 4rem;
}

.page__brand {
  font-weight: 650;
  letter-spacing: -0.01em;
}

.section {
  border-top: 1px solid var(--page-line);
  padding: 2rem 0;
}

.section h2 {
  margin: 0 0 0.5rem;
  font-size: 1.5rem;
}

.section p {
  margin: 0 0 1rem;
  color: var(--page-muted);
}

.section ul {
  margin: 0;
  padding-left: 1.1rem;
  line-height: 1.7;
}

.page__footer {
  border-top: 1px solid var(--page-line);
  padding-top: 1.5rem;
  color: var(--page-muted);
  font-size: 0.875rem;
}
`;

/**
 * Build the conventional, portable project the run stages.
 *
 * ADR-0002: the output is an ordinary npm project. It installs, runs, builds
 * and lints with familiar commands and contains no Vibld runtime dependency.
 */
export function buildProjectFiles(
  brief: ProjectBrief,
  mode: PlanMode = 'succeed',
): ProjectFile[] {
  const files: ProjectFile[] = [
    {
      path: 'package.json',
      content: `${JSON.stringify(
        {
          name: brief.slug,
          private: true,
          version: '0.0.0',
          type: 'module',
          scripts: {
            build: 'tsc --noEmit && vite build',
            dev: 'vite',
            lint: 'tsc --noEmit',
            preview: 'vite preview',
            typecheck: 'tsc --noEmit',
          },
          dependencies: {
            react: '^19.2.0',
            'react-dom': '^19.2.0',
          },
          devDependencies: {
            '@vitejs/plugin-react': '^5.1.0',
            typescript: '^5.9.0',
            vite: '^7.2.0',
          },
        },
        null,
        2,
      )}\n`,
    },
    {
      path: 'index.html',
      content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${brief.title}</title>
    <meta name="description" content="${brief.tagline}" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    },
    {
      path: 'src/main.tsx',
      content: `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
    },
    appComponent(brief),
    ...brief.sections.map(sectionComponent),
    { path: 'src/styles.css', content: STYLES },
    {
      path: 'README.md',
      content: `# ${brief.title}

${brief.tagline}

This project was generated by Vibld and belongs to you. It is a conventional
React + TypeScript + Vite application with no Vibld runtime dependency.

\`\`\`bash
npm install
npm run dev
npm run build
npm run lint
\`\`\`
`,
    },
  ];

  if (mode === 'fail-validation') {
    // Deliberately outside the project root: the validator must reject it and
    // the previously accepted checkpoint must survive.
    files.push({
      path: '../escaped-file.txt',
      content:
        'This path escapes the project root and must never be accepted.\n',
    });
  }

  return files;
}

export function buildPlan(
  prompt: string,
  mode: PlanMode = 'succeed',
): GenerationPlan {
  const brief = deriveBrief(prompt);
  const sectionNames = brief.sections.map((section) => section.kind).join(', ');

  return {
    summary:
      mode === 'fail-validation'
        ? `Stage "${brief.title}" with an out-of-root file so validation fails.`
        : `Generate "${brief.title}" as a React + TypeScript + Vite project with these sections: ${sectionNames}.`,
    files: buildProjectFiles(brief, mode),
  };
}
