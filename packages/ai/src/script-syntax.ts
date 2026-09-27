import { parse } from '@babel/parser';

/**
 * Where a script's comments, strings, template literals and regular
 * expressions are, read by a parser rather than guessed from the text.
 *
 * Telling a `/` that opens a regular expression from one that divides, a
 * `}` that closes a block from one that closes an object, or a line end
 * that ends a statement from one that does not, takes the grammar. Reading
 * the text for it took a rule per case and still missed the next one, so
 * the design checks ask `@babel/parser` instead and keep their own text
 * scanner only for script it cannot parse.
 */

/** Which grammar a script is read with. */
export type ScriptDialect = 'ts' | 'tsx' | 'js';

export interface ScriptSyntax {
  comments: { start: number; end: number; block: boolean }[];
  /** `close` is the index of the `/` that ends the pattern, before flags. */
  regexes: { start: number; end: number; close: number }[];
  strings: { start: number; end: number }[];
  /**
   * Every template literal. `tag` is the name a tagged one is tagged with
   * (`html`, and `div` for `styled.div`), `null` for a tag with no plain
   * name (`styled(Button)`), and absent when it is not tagged.
   */
  templates: {
    start: number;
    end: number;
    tag?: string | null;
    /** The literal text between its interpolations. */
    quasis: { start: number; end: number }[];
  }[];
}

/** The dialect a file's own name implies, or none for a file not script. */
export function dialectOf(path: string): ScriptDialect | undefined {
  if (/\.(ts|mts|cts)$/i.test(path)) return 'ts';
  if (/\.tsx$/i.test(path)) return 'tsx';
  if (/\.(js|jsx|mjs|cjs)$/i.test(path)) return 'js';
  return undefined;
}

// Decorators in their legacy form, which is what TypeScript and the
// frameworks generated here write (`constructor(@Inject(TOKEN) html)`).
const PLUGINS = {
  ts: ['typescript', 'decorators-legacy'],
  tsx: ['typescript', 'jsx', 'decorators-legacy'],
  js: ['jsx', 'decorators-legacy'],
} as const;

interface Node {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    typeof (value as { start?: unknown }).start === 'number'
  );
}

/** A tag's plain name: `html`, or the last name of `styled.div`. */
function tagName(tag: unknown): string | null {
  if (!isNode(tag)) return null;
  if (tag.type === 'Identifier') return tag.name as string;
  if (
    tag.type === 'MemberExpression' &&
    !tag.computed &&
    isNode(tag.property) &&
    tag.property.type === 'Identifier'
  ) {
    return tag.property.name as string;
  }
  return null;
}

/**
 * The syntax of `code`, or `undefined` when it does not parse: generated
 * code can be broken, and a check reading it then falls back on its text.
 */
export function scriptSyntax(
  code: string,
  dialect: ScriptDialect,
): ScriptSyntax | undefined {
  let file: { program: unknown; comments?: unknown[] };
  try {
    file = parse(code, {
      sourceType: 'unambiguous',
      errorRecovery: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowImportExportEverywhere: true,
      allowUndeclaredExports: true,
      plugins: [...PLUGINS[dialect]],
    }) as unknown as typeof file;
  } catch {
    return undefined;
  }
  const syntax: ScriptSyntax = {
    comments: [],
    regexes: [],
    strings: [],
    templates: [],
  };
  for (const comment of file.comments ?? []) {
    if (!isNode(comment)) continue;
    syntax.comments.push({
      start: comment.start,
      end: comment.end,
      block: comment.type === 'CommentBlock',
    });
  }
  const tags = new Map<unknown, string | null>();
  const stack: unknown[] = [file.program];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (!isNode(node)) continue;
    switch (node.type) {
      case 'StringLiteral':
      case 'DirectiveLiteral':
        syntax.strings.push({ start: node.start, end: node.end });
        break;
      case 'RegExpLiteral':
        syntax.regexes.push({
          start: node.start,
          end: node.end,
          close: node.end - String(node.flags ?? '').length - 1,
        });
        break;
      case 'TaggedTemplateExpression':
        tags.set(node.quasi, tagName(node.tag));
        break;
      case 'TemplateLiteral': {
        const quasis = (node.quasis as unknown[]).filter(isNode);
        syntax.templates.push({
          start: node.start,
          end: node.end,
          ...(tags.has(node) ? { tag: tags.get(node)! } : {}),
          quasis: quasis.map((quasi) => ({
            start: quasi.start,
            end: quasi.end,
          })),
        });
        break;
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (
        key === 'loc' ||
        key === 'extra' ||
        key === 'leadingComments' ||
        key === 'trailingComments' ||
        key === 'innerComments'
      ) {
        continue;
      }
      if (typeof value === 'object' && value !== null) stack.push(value);
    }
  }
  const byStart = (a: { start: number }, b: { start: number }) =>
    a.start - b.start;
  syntax.comments.sort(byStart);
  syntax.regexes.sort(byStart);
  syntax.strings.sort(byStart);
  syntax.templates.sort(byStart);
  return syntax;
}

/**
 * A type-only node with no value of its own. The TypeScript forms that do
 * hold one (`x as T`, `x satisfies T`, `x!`, `<T>x`, `f<T>`) are read.
 */
const VALUE_TS = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'TSInstantiationExpression',
]);

function isExpression(type: string): boolean {
  if (type.startsWith('TS')) return VALUE_TS.has(type);
  return (
    type.endsWith('Expression') ||
    type.endsWith('Literal') ||
    type === 'Identifier' ||
    type === 'PrivateName' ||
    type === 'Super' ||
    type === 'Import' ||
    type === 'JSXElement' ||
    type === 'JSXFragment'
  );
}

const endsOf: { code: string; ends: Map<number, number> | undefined }[] = [];

/**
 * Where the expression that begins at each index of `code` ends: the
 * outermost one starting there, a comma sequence excepted, since what the
 * design checks ask for is one value. `undefined` when `code` does not
 * parse cleanly as TSX, TypeScript or JavaScript, and the caller reads
 * the text instead.
 */
export function expressionEnds(code: string): Map<number, number> | undefined {
  const cached = endsOf.find((entry) => entry.code === code);
  if (cached) return cached.ends;
  let program: unknown;
  for (const plugins of [PLUGINS.tsx, PLUGINS.ts, PLUGINS.js]) {
    try {
      const file = parse(code, {
        sourceType: 'unambiguous',
        errorRecovery: true,
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        allowImportExportEverywhere: true,
        allowUndeclaredExports: true,
        createParenthesizedExpressions: true,
        plugins: [...plugins],
      }) as unknown as { program: unknown; errors?: unknown[] };
      if ((file.errors ?? []).length > 0) continue;
      program = file.program;
      break;
    } catch {
      continue;
    }
  }
  let ends: Map<number, number> | undefined;
  if (program !== undefined) {
    ends = new Map();
    const stack: unknown[] = [program];
    while (stack.length > 0) {
      const node = stack.pop();
      if (Array.isArray(node)) {
        stack.push(...node);
        continue;
      }
      if (!isNode(node)) continue;
      if (node.type !== 'SequenceExpression' && isExpression(node.type)) {
        ends.set(node.start, Math.max(ends.get(node.start) ?? 0, node.end));
      }
      for (const [key, value] of Object.entries(node)) {
        if (
          key === 'loc' ||
          key === 'extra' ||
          key === 'leadingComments' ||
          key === 'trailingComments' ||
          key === 'innerComments' ||
          // A property's name (`{ animation: ... }`) is not a value, and
          // what starts there is the property's value.
          (key === 'key' && node.computed !== true)
        ) {
          continue;
        }
        if (typeof value === 'object' && value !== null) stack.push(value);
      }
    }
  }
  endsOf.push({ code, ends });
  if (endsOf.length > 8) endsOf.shift();
  return ends;
}
