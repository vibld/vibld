import { SITE } from './site.ts';

/**
 * Where the home page's "Build it" sends what was typed (D208): the builder,
 * with the text in the address's fragment, which never reaches a server.
 * The builder keeps it through sign-in and opens with it in the composer,
 * ready to send, as it does a template's brief
 * (apps/web/src/templates/template-brief.ts reads both).
 */
export function builderUrlFor(prompt: string): string {
  return `${SITE.appUrl}/#${new URLSearchParams({ prompt: prompt.trim() }).toString()}`;
}
