/**
 * Where in the template gallery a path is (D161): a category and, inside
 * it, a subcategory, each a prerendered page of its own.
 */
import {
  TEMPLATE_GROUPS,
  findSubcategory,
  type TemplateGroup,
} from '@vibld/ai/design-categories';

/** Where in the catalog a path is: `/templates/websites/ecommerce`. */
export interface Place {
  group: TemplateGroup | '';
  sub: string;
}

/**
 * The category and subcategory a gallery path names (D161). Each is its own
 * prerendered page, declared once per path in routes.ts; `/templates` is
 * every design.
 */
export function placeOf(pathname: string): Place {
  const [, group = '', sub = ''] =
    /^\/templates\/([^/]+)(?:\/([^/]+))?\/?$/.exec(pathname) ?? [];
  if (!TEMPLATE_GROUPS.some((g) => g.slug === group))
    return { group: '', sub: '' };
  if (sub && !findSubcategory(group, sub)) return { group: '', sub: '' };
  return { group: group as TemplateGroup, sub };
}

/** The path of a place, for a link and for metaFor. */
export function placePath(place: Place): string {
  return ['/templates', place.group, place.sub].filter(Boolean).join('/');
}

/**
 * A place's link, with the filters in `search` carried over, except a screen
 * type where no screens are listed (D161).
 */
export function placeHref(place: Place, search: string): string {
  const query = new URLSearchParams(search);
  if (place.group && place.group !== 'screens') query.delete('screen');
  const rest = query.toString();
  return `${placePath(place)}${rest ? `?${rest}` : ''}`;
}
