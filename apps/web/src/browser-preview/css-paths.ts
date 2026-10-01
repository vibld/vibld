import { normalizePath } from './bundle.ts';

/** A reference to a file next to the stylesheet, not a URL or a root path. */
export const RELATIVE = /^(?![a-z][a-z0-9+.-]*:|\/|#)./i;

/**
 * A stylesheet's references to project files named from the root, so it
 * can be compiled alongside others and served from anywhere: in
 * src/styles.css, `@import "./theme.css"` (or `url("./theme.css")`) is
 * `@import "/src/theme.css"`, and `url(./hero.png)` is `url(/src/hero.png)`.
 * Each project file a `url()` names is added to `assets`, for the page to
 * be handed.
 */
export function rootedImports(
  css: string,
  path: string,
  files?: ReadonlyMap<string, unknown>,
  assets?: Set<string>,
): string {
  const at = normalizePath(path);
  const slash = at.lastIndexOf('/');
  const dir = slash === -1 ? '' : at.slice(0, slash);
  const rooted = (id: string) => normalizePath(`${dir}/${id}`);
  return css
    .replace(
      /(@import\s+)(?:(['"])([^'"]*)\2|url\(\s*(['"]?)([^'")]*)\4\s*\))/g,
      (
        statement: string,
        lead: string,
        _quote: string | undefined,
        quoted: string | undefined,
        _urlQuote: string | undefined,
        bare: string | undefined,
      ) => {
        const id = quoted ?? bare ?? '';
        // A query (`./theme.css?v=2`) is dropped: the import is read
        // from the project file. A plain name (`theme.css`) is a file
        // beside this one when there is one, as Vite has it, and a
        // package otherwise.
        const target = rooted(/^[^?#]*/.exec(id)![0]);
        return RELATIVE.test(id) &&
          (id.startsWith('.') || bare !== undefined || files?.has(target))
          ? `${lead}"/${target}"`
          : statement;
      },
    )
    .replace(
      /(^|[^\w-])url\(\s*(['"]?)([^'")]*)\2\s*\)/g,
      (reference, before: string, quote: string, id: string) => {
        if (/^\/(?!\/)/.test(id.trim())) {
          // Already from the root (`/src/assets/hero.png`): a project file
          // there is handed to the page too.
          const target = normalizePath(/^[^?#]*/.exec(id.trim())![0]);
          if (files?.has(target)) assets?.add(target);
          return reference;
        }
        if (!RELATIVE.test(id.trim())) return reference;
        const [, path = '', suffix = ''] = /^([^?#]*)(.*)$/.exec(id.trim())!;
        const target = rooted(path);
        if (!files || files.has(target)) assets?.add(target);
        return `${before}url(${quote}/${target}${suffix}${quote})`;
      },
    );
}
