/**
 * Each layer's prompt, read at build time from the file the site also serves
 * (`public/layers/<slug>/prompt.md`), so the page and the download cannot
 * differ. Server-only: no page ships the prompts in its bundle.
 */
const PROMPTS = import.meta.glob<string>('../public/layers/*/prompt.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export function layerPrompt(slug: string): string {
  const prompt = PROMPTS[`../public/layers/${slug}/prompt.md`];
  if (prompt === undefined) throw new Error(`No prompt for layer ${slug}`);
  return prompt;
}
