/**
 * The template gallery's typefaces with what each licence file says,
 * read at build time from the files the site serves (D104), so the
 * licences page cannot differ from them. Server-only.
 */
import { licenceFacts } from './font-licence';
import { TEMPLATE_FONTS } from './template-fonts.gen';

const FILES = import.meta.glob<string>(
  '../public/fonts/templates/*/LICENSE.txt',
  { query: '?raw', import: 'default', eager: true },
);

export function templateFontLicences() {
  return Object.entries(TEMPLATE_FONTS)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, font]) => {
      const text = FILES[`../public${font.licence}`];
      if (text === undefined) throw new Error(`No licence file for ${family}`);
      return {
        family,
        package: font.source,
        licence: font.licence,
        ...licenceFacts(text),
      };
    });
}
