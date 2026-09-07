import type { ProjectSnapshot } from '@vibld/core';
import type { ProjectBrief } from './brief.ts';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ESCAPES[character] ?? character,
  );
}

/**
 * Strip anything that could execute or load from a stylesheet before it is
 * inlined into the preview document.
 */
function sanitizeStyles(css: string): string {
  return css
    .replace(/<\/?\s*(style|script)/gi, '')
    .replace(/@import[^;]*;/gi, '')
    .replace(/expression\s*\(/gi, '')
    .replace(/url\s*\(/gi, 'none(');
}

/**
 * Build the local mock preview document.
 *
 * This is NOT sandbox execution: nothing installs dependencies and no
 * generated code runs. The document is static HTML assembled from the plan's
 * structure and the generated stylesheet, rendered in a fully restricted
 * iframe (`sandbox=""`, so no scripts and no same-origin access).
 */
export function buildPreviewDocument(
  brief: ProjectBrief,
  snapshot: ProjectSnapshot,
): string {
  const styles = snapshot.files.find((file) => file.path === 'src/styles.css');
  const body = brief.sections
    .map((section, index) => {
      const id = `${section.kind}-${index}`;
      const items =
        section.items.length > 0
          ? `<ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
          : '';
      if (section.kind === 'hero') {
        return `<section class="section section--hero" aria-labelledby="${escapeHtml(id)}"><h1 id="${escapeHtml(id)}">${escapeHtml(section.heading)}</h1><p>${escapeHtml(section.body)}</p>${items}</section>`;
      }
      return `<section class="section section--${escapeHtml(section.kind)}" aria-labelledby="${escapeHtml(id)}"><h2 id="${escapeHtml(id)}">${escapeHtml(section.heading)}</h2><p>${escapeHtml(section.body)}</p>${items}</section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(brief.title)}</title>
<style>${sanitizeStyles(styles?.content ?? '')}</style>
</head>
<body>
<div class="page">
<header class="page__header"><p class="page__brand">${escapeHtml(brief.title)}</p></header>
<main>${body}</main>
<footer class="page__footer"><p>Generated with Vibld. This project is yours to edit and deploy.</p></footer>
</div>
</body>
</html>`;
}
