import { parse } from '@babel/parser';
import type { ScriptDialect } from './script-syntax.ts';

/**
 * Which of a file's Motion animations the reduced-motion preference
 * reaches, read from the syntax tree rather than the text.
 *
 * Whether a read of `useReducedMotion()` stops an animation depends on
 * where the animation sits relative to it: under the branch the read
 * rules out, after a return it takes, inside a `<MotionConfig>` that
 * follows it. The text alone kept answering that one pattern at a time
 * (#239 review); the tree answers it for each animation, by walking the
 * animation's ancestors.
 */

/** The names a file gives Motion's exports, as its imports bind them. */
export interface MotionBindings {
  /** `motion`, `m`, their aliases, and `NS.motion` for a namespace. */
  factories: Set<string>;
  /** Components bound from the factory: `const MotionCard = motion.create(Card)`. */
  created: Set<string>;
  /** `useReducedMotion` as imported from Motion. */
  preference: Set<string>;
  /** `animate`, as imported from Motion. */
  animate: Set<string>;
  /** `useAnimate`, as imported from Motion. */
  useAnimate: Set<string>;
  /** The hooks whose values follow scroll, the pointer or time. */
  linked: Set<string>;
  /** `MotionConfig`, as imported from Motion. */
  config: Set<string>;
  /** `useAnimationFrame`, as imported from Motion. */
  frame: Set<string>;
}

/** How many of each kind of animation nothing stops for a visitor who asked. */
export interface MotionCoverage {
  /** Motion elements that animate in props. */
  declarative: { total: number; uncovered: number };
  /** Values linked to scroll or time that reach a style, and `animate()` calls. */
  scripted: { total: number; uncovered: number };
  /** Where each configured `<MotionConfig>` element starts and ends. */
  providers: Array<[number, number]>;
  /**
   * For each component declared at the top of the file, the element at the
   * root of each JSX it returns: `Layout` for `return <Layout>...</Layout>`,
   * and '' for a fragment or anything else. A provider that wraps what a
   * wrapper returns wraps what is passed through it (#239 review).
   */
  returnRoots: Record<string, string[]>;
}

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

const PLUGINS = {
  ts: ['typescript', 'decorators-legacy'],
  tsx: ['typescript', 'jsx', 'decorators-legacy'],
  js: ['jsx', 'decorators-legacy'],
} as const;

/** Props that set what a Motion element animates. */
const MOTION_PROPS = new Set([
  'initial',
  'animate',
  'exit',
  'whileInView',
  'whileHover',
  'whileTap',
  'whileFocus',
  'whileDrag',
  'layout',
  'layoutId',
  'drag',
]);

/** Keys that move an element, as opposed to fading or colouring it. */
/**
 * The movement MotionConfig's reduced-motion setting turns off: transforms
 * and layout. Width, position and path drawing keep animating under it
 * (#239 review).
 */
const TRANSFORM =
  /^(?:x|y|z|scale[XYZ]?|rotate[XYZ]?|skew[XY]?|translate[XYZ]?|transform|perspective)$/;

const MOVEMENT =
  /^(?:x|y|z|scale[XYZ]?|rotate[XYZ]?|skew[XY]?|translate[XYZ]?|transform|offsetDistance|offsetPath|offsetRotate|perspective|pathLength|pathOffset|top|left|right|bottom|inset\w*|width|height|(?:min|max)(?:Width|Height)|margin\w*|padding\w*|backgroundPosition[XY]?|strokeDashoffset|clipPath|d|points|c[xy]|r[xy]?|[xy][12]|viewBox|attr[XY]|attrScale)$/;

/** Options that time an animation, and never move anything themselves. */
const TIMING =
  /^(?:duration|delay|ease|times|repeat|repeatType|repeatDelay|type|stiffness|damping|mass|bounce|visualDuration|velocity|restDelta|restSpeed|at|defaultTransition|onComplete|onUpdate|onPlay|onRepeat|onStop|autoplay)$/;

/**
 * The element at the root of each JSX a top-level component returns, by
 * component: its own returns, not those of callbacks inside it.
 */
function motionForwarders(program: Node, factories: Set<string>): Set<string> {
  const found = new Set<string>();
  const forwards = (node: Node): boolean => {
    if (node.type === 'JSXOpeningElement') {
      const name = dotted(node.name);
      const dot = name?.lastIndexOf('.') ?? -1;
      if (
        name !== undefined &&
        dot !== -1 &&
        factories.has(name.slice(0, dot)) &&
        (node.attributes as unknown[]).some(
          (attribute) =>
            isNode(attribute) && attribute.type === 'JSXSpreadAttribute',
        )
      ) {
        return true;
      }
    }
    return children(node).some(forwards);
  };
  for (const top of program.body as unknown[]) {
    if (!isNode(top)) continue;
    const statement =
      (top.type === 'ExportNamedDeclaration' ||
        top.type === 'ExportDefaultDeclaration') &&
      isNode(top.declaration)
        ? top.declaration
        : top;
    const candidates: Array<[unknown, unknown]> =
      statement.type === 'FunctionDeclaration' && isNode(statement.id)
        ? [[statement.id.name, statement.body]]
        : statement.type === 'VariableDeclaration'
          ? (statement.declarations as unknown[]).flatMap((declarator) =>
              isNode(declarator) &&
              isNode(declarator.id) &&
              isNode(declarator.init) &&
              (declarator.init.type === 'ArrowFunctionExpression' ||
                declarator.init.type === 'FunctionExpression')
                ? [[declarator.id.name, declarator.init.body]]
                : [],
            )
          : [];
    for (const [name, body] of candidates) {
      if (
        typeof name === 'string' &&
        /^[A-Z]/.test(name) &&
        isNode(body) &&
        forwards(body)
      ) {
        found.add(name);
      }
    }
  }
  return found;
}

function returnRoots(program: Node): Record<string, string[]> {
  const roots: Record<string, string[]> = {};
  const rootOf = (expression: Node): string =>
    expression.type === 'JSXElement' && isNode(expression.openingElement)
      ? (dotted(expression.openingElement.name) ?? '')
      : '';
  const returned = (node: Node, into: string[]) => {
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression' ||
      node.type === 'ClassDeclaration' ||
      node.type === 'ClassExpression'
    ) {
      return;
    }
    if (node.type === 'ReturnStatement') {
      const argument = node.argument;
      if (
        isNode(argument) &&
        !(argument.type === 'NullLiteral') &&
        !(argument.type === 'Identifier' && argument.name === 'undefined')
      ) {
        into.push(rootOf(argument));
      }
      return;
    }
    for (const child of children(node)) returned(child, into);
  };
  const component = (name: unknown, fn: unknown) => {
    if (typeof name !== 'string' || !/^[A-Z]/.test(name) || !isNode(fn)) {
      return;
    }
    if (
      fn.type !== 'FunctionDeclaration' &&
      fn.type !== 'FunctionExpression' &&
      fn.type !== 'ArrowFunctionExpression'
    ) {
      return;
    }
    const into: string[] = [];
    if (isNode(fn.body) && fn.body.type === 'BlockStatement') {
      for (const statement of fn.body.body as unknown[]) {
        if (isNode(statement)) returned(statement, into);
      }
    } else if (isNode(fn.body)) {
      into.push(rootOf(fn.body));
    }
    roots[name] = into;
  };
  for (const top of program.body as unknown[]) {
    if (!isNode(top)) continue;
    const statement =
      (top.type === 'ExportNamedDeclaration' ||
        top.type === 'ExportDefaultDeclaration') &&
      isNode(top.declaration)
        ? top.declaration
        : top;
    if (statement.type === 'FunctionDeclaration' && isNode(statement.id)) {
      component(statement.id.name, statement);
    } else if (statement.type === 'VariableDeclaration') {
      for (const declarator of statement.declarations as unknown[]) {
        if (isNode(declarator) && isNode(declarator.id)) {
          component(declarator.id.name, declarator.init);
        }
      }
    }
  }
  return roots;
}

/** A dotted name: `motion.div`, `Motion.MotionConfig`, `animate`. */
function dotted(node: unknown): string | undefined {
  if (!isNode(node)) return undefined;
  if (node.type === 'Identifier' || node.type === 'JSXIdentifier') {
    return node.name as string;
  }
  if (node.type === 'MemberExpression' || node.type === 'JSXMemberExpression') {
    if (node.computed) return undefined;
    const object = dotted(node.object);
    const property = dotted(node.property);
    return object && property ? `${object}.${property}` : undefined;
  }
  return undefined;
}

/** Every child node of `node`, in source order. */
function children(node: Node): Node[] {
  const found: Node[] = [];
  for (const key of Object.keys(node)) {
    if (
      key === 'loc' ||
      key === 'extra' ||
      key === 'leadingComments' ||
      key === 'trailingComments' ||
      key === 'innerComments'
    ) {
      continue;
    }
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) found.push(item);
    } else if (isNode(value)) {
      found.push(value);
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

function within(inner: Node, outer: unknown): boolean {
  return isNode(outer) && inner.start >= outer.start && inner.end <= outer.end;
}

/**
 * How much of a file's Motion the preference reaches, or `undefined` when
 * the file does not parse and the caller falls back on reading its text.
 */
export function motionCoverage(
  code: string,
  dialect: ScriptDialect,
  bindings: MotionBindings,
  {
    providerEverywhere = false,
  }: {
    /** A configured MotionConfig wraps every root of the app. */
    providerEverywhere?: boolean;
  } = {},
): MotionCoverage | undefined {
  let file: { program: unknown };
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
  if (!isNode(file.program)) return undefined;
  const program = file.program;
  // Components of this file that hand their props to a Motion element,
  // `<motion.div {...props} />`: what a use passes them animates
  // (#239 review).
  const forwarders = motionForwarders(program, bindings.factories);

  // Each use of a name, tied to the declaration in scope where it is used
  // (#239 review): the preference (`const reduce = useReducedMotion()`),
  // a linked value with the hook that makes it, or a function that starts
  // motion (`animate` as imported, or as `useAnimate()` hands it back). A
  // parameter or local of the same name elsewhere is not them.
  const preferenceUses = new Set<Node>();
  const linkedUses = new Map<Node, Node>();
  const starterUses = new Set<Node>();
  const objectUses = new Map<Node, Node>();
  const arrayUses = new Map<Node, Node>();
  // Calls to the preference hook as imported, resolved in scope: a
  // parameter or local function of that name is not it (#239 review).
  const preferenceCalls = new Set<Node>();
  // Elements and calls whose names resolve, in scope, to Motion: an element
  // made by the imported factory or a component made with it, a configured
  // MotionConfig, and `NS.animate` through the namespace import. A prop or
  // local of the same name is not them (#239 review).
  const motionOpenings = new Set<Node>();
  const configOpenings = new Set<Node>();
  const starterCalls = new Set<Node>();
  const frameCalls = new Set<Node>();
  const isPreferenceRead = (node: Node): boolean => {
    if (node.type === 'CallExpression') return preferenceCalls.has(node);
    // window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (
      node.type === 'MemberExpression' &&
      dotted(node.property) === 'matches' &&
      isNode(node.object) &&
      node.object.type === 'CallExpression' &&
      /(?:^|\.)matchMedia$/.test(dotted(node.object.callee) ?? '') &&
      (node.object.arguments as unknown[]).some(
        (argument) =>
          isNode(argument) &&
          argument.type === 'StringLiteral' &&
          /prefers-reduced-motion\s*:\s*reduce/.test(argument.value as string),
      )
    ) {
      return true;
    }
    return false;
  };
  interface Binding {
    preference?: true;
    linked?: Node;
    starter?: true;
    /** Bound by an import, not declared here. */
    imported?: true;
    /** A component made with the factory: `const Card = motion.div`. */
    created?: true;
    /** An object written out where it is declared: `const fade = { … }`. */
    object?: Node;
    /** An array written out where it is declared: a sequence, perhaps. */
    array?: Node;
  }
  const scopes: Map<string, Binding>[] = [];
  const lookup = (name: string): Binding | undefined => {
    for (let i = scopes.length - 1; i >= 0; i -= 1) {
      const binding = scopes[i]!.get(name);
      if (binding) return binding;
    }
    return undefined;
  };
  /** Whether `prefix` (`motion`, `Motion.motion`) is the imported factory. */
  const factoryInScope = (prefix: string): boolean =>
    bindings.factories.has(prefix) &&
    lookup(prefix.split('.')[0]!)?.imported === true;
  /** Whether an expression makes a component with the factory. */
  const makesComponent = (init: Node): boolean => {
    const made =
      init.type === 'CallExpression' ? dotted(init.callee) : dotted(init);
    if (made === undefined) return false;
    if (init.type === 'CallExpression' && factoryInScope(made)) return true;
    const dot = made.lastIndexOf('.');
    return dot !== -1 && factoryInScope(made.slice(0, dot));
  };
  /** Whether a callee is one of `names` as this file imports it, in scope. */
  const importedCallee = (callee: unknown, names: Set<string>): boolean => {
    const name = dotted(callee);
    if (name === undefined || !names.has(name)) return false;
    return lookup(name.split('.')[0]!)?.imported === true;
  };
  const patternNames = (pattern: unknown, into: string[]) => {
    if (!isNode(pattern)) return;
    if (pattern.type === 'Identifier') into.push(pattern.name as string);
    else if (pattern.type === 'ObjectPattern') {
      for (const property of pattern.properties as unknown[]) {
        if (!isNode(property)) continue;
        patternNames(
          property.type === 'RestElement' ? property.argument : property.value,
          into,
        );
      }
    } else if (pattern.type === 'ArrayPattern') {
      for (const element of pattern.elements as unknown[]) {
        patternNames(element, into);
      }
    } else if (pattern.type === 'AssignmentPattern') {
      patternNames(pattern.left, into);
    } else if (pattern.type === 'RestElement') {
      patternNames(pattern.argument, into);
    } else if (pattern.type === 'TSParameterProperty') {
      patternNames(pattern.parameter, into);
    }
  };
  /**
   * A declarator's names, and, once every name the block declares is in
   * scope (`evaluate`), what each is bound to: a function declared later
   * in the block still shadows an import.
   */
  const declare = (
    scope: Map<string, Binding>,
    declarator: Node,
    evaluate: boolean,
    kind = 'const',
  ) => {
    const id = declarator.id;
    const init = isNode(declarator.init) ? declarator.init : undefined;
    const names: string[] = [];
    patternNames(id, names);
    if (!evaluate) {
      for (const name of names) scope.set(name, {});
      return;
    }
    if (!isNode(id) || !init) return;
    const call = init.type === 'CallExpression' ? init.callee : undefined;
    const preference =
      (call !== undefined && importedCallee(call, bindings.preference)) ||
      (init.type === 'MemberExpression' && isPreferenceRead(init));
    const linked = call !== undefined && importedCallee(call, bindings.linked);
    if (
      id.type === 'Identifier' &&
      (makesComponent(init) || forwarders.has(id.name as string))
    ) {
      scope.set(id.name as string, { created: true });
      return;
    }
    // An object or list read where it is written only when nothing can
    // reassign it: `let target = {...}; target = {...}` (#239 review).
    const fixed = kind === 'const';
    if (fixed && id.type === 'Identifier' && init.type === 'ObjectExpression') {
      scope.set(id.name as string, { object: init });
      return;
    }
    if (fixed && id.type === 'Identifier' && init.type === 'ArrayExpression') {
      scope.set(id.name as string, { array: init });
      return;
    }
    if (id.type === 'Identifier') {
      // A local alias of a linked value is the value: `const progress =
      // scrollYProgress` (#239 review).
      // So is an alias of an object or array declared first, `const style =
      // base` (#239 review).
      const source =
        init.type === 'Identifier' ? lookup(init.name as string) : undefined;
      // So is an alias of the preference, `const calm = reduce` (#239 review).
      if (preference || source?.preference) {
        scope.set(id.name as string, { preference: true });
      } else if (linked) {
        scope.set(id.name as string, { linked: init });
      } else if (source?.linked) {
        scope.set(id.name as string, { linked: source.linked });
      } else if (
        source?.starter ||
        (init.type === 'MemberExpression' &&
          importedCallee(init, bindings.animate))
      ) {
        // `const run = animate` starts motion as animate does, and so does
        // `const run = Motion.animate` through the namespace (#239 review).
        scope.set(id.name as string, { starter: true });
      } else if (fixed && source?.object) {
        scope.set(id.name as string, { object: source.object });
      } else if (fixed && source?.array) {
        scope.set(id.name as string, { array: source.array });
      }
    } else if (id.type === 'ObjectPattern' && linked) {
      for (const name of names) scope.set(name, { linked: init });
    } else if (
      id.type === 'ArrayPattern' &&
      call !== undefined &&
      importedCallee(call, bindings.useAnimate)
    ) {
      const second = (id.elements as unknown[])[1];
      if (isNode(second) && second.type === 'Identifier') {
        scope.set(second.name as string, { starter: true });
      }
    }
  };
  const declareStatement = (
    scope: Map<string, Binding>,
    statement: unknown,
    evaluate = false,
  ) => {
    if (!isNode(statement)) return;
    if (
      statement.type === 'FunctionDeclaration' &&
      isNode(statement.id) &&
      forwarders.has(statement.id.name as string)
    ) {
      scope.set(statement.id.name as string, { created: true });
      return;
    }
    if (
      !evaluate &&
      (statement.type === 'ExportNamedDeclaration' ||
        statement.type === 'ExportDefaultDeclaration') &&
      isNode(statement.declaration) &&
      statement.declaration.type === 'FunctionDeclaration'
    ) {
      declareStatement(scope, statement.declaration);
      return;
    }
    if (statement.type === 'VariableDeclaration') {
      for (const declarator of statement.declarations as unknown[]) {
        if (isNode(declarator)) {
          declare(scope, declarator, evaluate, statement.kind as string);
        }
      }
    } else if (evaluate) {
      if (
        (statement.type === 'ExportNamedDeclaration' ||
          statement.type === 'ExportDefaultDeclaration') &&
        isNode(statement.declaration)
      ) {
        declareStatement(scope, statement.declaration, true);
      }
    } else if (
      (statement.type === 'FunctionDeclaration' ||
        statement.type === 'ClassDeclaration') &&
      isNode(statement.id)
    ) {
      scope.set(statement.id.name as string, {});
    } else if (statement.type === 'ImportDeclaration') {
      for (const specifier of statement.specifiers as unknown[]) {
        if (!isNode(specifier) || !isNode(specifier.local)) continue;
        const local = specifier.local.name as string;
        scope.set(
          local,
          specifier.type === 'ImportSpecifier' && bindings.animate.has(local)
            ? { starter: true, imported: true }
            : { imported: true },
        );
      }
    } else if (
      (statement.type === 'ExportNamedDeclaration' ||
        statement.type === 'ExportDefaultDeclaration') &&
      isNode(statement.declaration)
    ) {
      declareStatement(scope, statement.declaration);
    }
  };
  const FUNCTIONS = new Set([
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression',
    'ObjectMethod',
    'ClassMethod',
    'ClassPrivateMethod',
  ]);
  const resolve = (node: Node, parent?: Node) => {
    if (
      node.type === 'Program' ||
      node.type === 'BlockStatement' ||
      node.type === 'StaticBlock'
    ) {
      const scope = new Map<string, Binding>();
      scopes.push(scope);
      for (const statement of node.body as unknown[]) {
        declareStatement(scope, statement);
      }
      for (const statement of node.body as unknown[]) {
        declareStatement(scope, statement, true);
      }
      for (const child of children(node)) resolve(child, node);
      scopes.pop();
      return;
    }
    if (FUNCTIONS.has(node.type)) {
      const scope = new Map<string, Binding>();
      const names: string[] = [];
      for (const param of node.params as unknown[]) patternNames(param, names);
      if (node.type === 'FunctionExpression' && isNode(node.id)) {
        names.push(node.id.name as string);
      }
      for (const name of names) scope.set(name, {});
      scopes.push(scope);
      if (isNode(node.body)) resolve(node.body, node);
      scopes.pop();
      return;
    }
    if (node.type === 'CatchClause') {
      const scope = new Map<string, Binding>();
      const names: string[] = [];
      patternNames(node.param, names);
      for (const name of names) scope.set(name, {});
      scopes.push(scope);
      if (isNode(node.body)) resolve(node.body, node);
      scopes.pop();
      return;
    }
    if (
      node.type === 'ForStatement' ||
      node.type === 'ForInStatement' ||
      node.type === 'ForOfStatement'
    ) {
      const scope = new Map<string, Binding>();
      const head = node.type === 'ForStatement' ? node.init : node.left;
      scopes.push(scope);
      declareStatement(scope, head);
      declareStatement(scope, head, true);
      for (const child of children(node)) resolve(child, node);
      scopes.pop();
      return;
    }
    if (node.type === 'VariableDeclarator') {
      if (isNode(node.init)) resolve(node.init, node);
      return;
    }
    if (node.type === 'ImportDeclaration') return;
    if (
      node.type === 'CallExpression' &&
      importedCallee(node.callee, bindings.preference)
    ) {
      preferenceCalls.add(node);
    }
    if (
      node.type === 'CallExpression' &&
      isNode(node.callee) &&
      node.callee.type === 'MemberExpression' &&
      importedCallee(node.callee, bindings.animate)
    ) {
      starterCalls.add(node);
    }
    if (
      node.type === 'CallExpression' &&
      importedCallee(node.callee, bindings.frame)
    ) {
      frameCalls.add(node);
    }
    if (node.type === 'JSXOpeningElement') {
      const name = dotted(node.name);
      if (name !== undefined) {
        const binding = lookup(name.split('.')[0]!);
        const dot = name.lastIndexOf('.');
        if (
          (dot !== -1 && factoryInScope(name.slice(0, dot))) ||
          (binding?.created === true && !name.includes('.')) ||
          (bindings.created.has(name) && binding?.imported === true)
        ) {
          motionOpenings.add(node);
        }
        if (bindings.config.has(name) && binding?.imported === true) {
          configOpenings.add(node);
        }
      }
    }
    if (node.type === 'Identifier') {
      const named =
        parent &&
        ((parent.type === 'MemberExpression' &&
          parent.property === node &&
          !parent.computed) ||
          ((parent.type === 'ObjectProperty' ||
            parent.type === 'ClassProperty') &&
            parent.key === node &&
            !parent.computed &&
            !parent.shorthand));
      if (named) return;
      const binding = lookup(node.name as string);
      if (binding?.preference) preferenceUses.add(node);
      if (binding?.linked) linkedUses.set(node, binding.linked);
      if (binding?.starter) starterUses.add(node);
      if (binding?.object) objectUses.set(node, binding.object);
      if (binding?.array) arrayUses.set(node, binding.array);
      return;
    }
    for (const child of children(node)) resolve(child, node);
  };
  resolve(program);

  // An object declared first, then written to: `const style = {};
  // style.y = scrollY`. `const` keeps the name, not the object, so it is
  // not read as written, and what is written to it is part of it
  // (#239 review).
  const mutated = new Set<Node>();
  const writes = new Map<Node, Node[]>();
  // Lists too: `sequence.push([el, { x: 100 }])` (#239 review).
  const mutatedArrays = new Set<Node>();
  const baseOf = (target: unknown): Node | undefined => {
    let current = target;
    while (isNode(current) && current.type === 'MemberExpression') {
      current = current.object;
    }
    return isNode(current) && current.type === 'Identifier'
      ? current
      : undefined;
  };
  const written = (target: unknown, value?: unknown) => {
    const base = baseOf(target);
    const list = base ? arrayUses.get(base) : undefined;
    if (list) mutatedArrays.add(list);
    const object = base ? objectUses.get(base) : undefined;
    if (!object) return;
    mutated.add(object);
    if (isNode(value))
      writes.set(object, [...(writes.get(object) ?? []), value]);
  };
  const findWrites = (node: Node) => {
    if (
      node.type === 'AssignmentExpression' &&
      isNode(node.left) &&
      node.left.type === 'MemberExpression'
    ) {
      written(node.left, node.right);
    } else if (
      (node.type === 'UpdateExpression' ||
        (node.type === 'UnaryExpression' && node.operator === 'delete')) &&
      isNode(node.argument) &&
      node.argument.type === 'MemberExpression'
    ) {
      written(node.argument);
    } else if (
      node.type === 'CallExpression' &&
      isNode(node.callee) &&
      node.callee.type === 'MemberExpression' &&
      /^(?:push|unshift|splice|fill|copyWithin|sort|reverse)$/.test(
        dotted(node.callee.property) ?? '',
      )
    ) {
      written(node.callee.object);
    } else if (
      node.type === 'CallExpression' &&
      // And through Reflect: `Reflect.set(target, 'x', 100)` (#239 review).
      /^(?:Object\.(?:assign|defineProperty|defineProperties|setPrototypeOf)|Reflect\.(?:set|defineProperty|deleteProperty|setPrototypeOf))$/.test(
        dotted(node.callee) ?? '',
      )
    ) {
      const [target, ...sources] = (node.arguments as unknown[]).filter(isNode);
      for (const source of sources) written(target, source);
      if (target && sources.length === 0) written(target);
    }
    for (const child of children(node)) findWrites(child);
  };
  findWrites(program);

  /** Whether the subtree reads the preference anywhere. */
  const readsPreference = (node: Node): boolean => {
    if (isPreferenceRead(node)) return true;
    if (node.type === 'Identifier' && preferenceUses.has(node)) return true;
    return children(node).some(
      (child) =>
        // `obj.reduce` names a property, not the binding.
        !(
          node.type === 'MemberExpression' &&
          child === node.property &&
          !node.computed
        ) && readsPreference(child),
    );
  };
  const isPreference = (node: Node): boolean =>
    isPreferenceRead(node) ||
    (node.type === 'Identifier' && preferenceUses.has(node));
  /** A test that is true only for a visitor who did not ask. */
  const trueOnlyWithout = (test: unknown): boolean => {
    if (!isNode(test)) return false;
    if (
      test.type === 'UnaryExpression' &&
      test.operator === '!' &&
      isNode(test.argument)
    ) {
      return reducedMakesTrue(test.argument);
    }
    if (test.type === 'LogicalExpression' && test.operator === '&&') {
      return trueOnlyWithout(test.left) || trueOnlyWithout(test.right);
    }
    return false;
  };
  /** A test that is always true for a visitor who asked. */
  const reducedMakesTrue = (test: unknown): boolean => {
    if (!isNode(test)) return false;
    if (isPreference(test)) return true;
    if (
      test.type === 'UnaryExpression' &&
      test.operator === '!' &&
      isNode(test.argument)
    ) {
      return trueOnlyWithout(test.argument);
    }
    if (test.type === 'LogicalExpression') {
      return test.operator === '||'
        ? reducedMakesTrue(test.left) || reducedMakesTrue(test.right)
        : test.operator === '&&'
          ? reducedMakesTrue(test.left) && reducedMakesTrue(test.right)
          : false;
    }
    return false;
  };
  /**
   * Whether evaluating a node may change something: an assignment, an
   * update, a delete, or a call other than a read (`Math.*`, or a method
   * named `get...`). `const next = (el.style.transform = t)` moves the
   * element as it declares (#239 review).
   */
  const effects = (node: Node): boolean => {
    if (
      node.type === 'AssignmentExpression' ||
      node.type === 'UpdateExpression' ||
      (node.type === 'UnaryExpression' && node.operator === 'delete') ||
      node.type === 'AwaitExpression' ||
      node.type === 'YieldExpression' ||
      node.type === 'TaggedTemplateExpression'
    ) {
      return true;
    }
    if (
      node.type === 'ArrowFunctionExpression' ||
      node.type === 'FunctionExpression'
    ) {
      return false;
    }
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const callee = node.callee;
      const reads =
        isNode(callee) &&
        callee.type === 'MemberExpression' &&
        !callee.computed &&
        isNode(callee.property) &&
        callee.property.type === 'Identifier' &&
        ((isNode(callee.object) &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'Math') ||
          /^get[A-Z]?/.test(callee.property.name as string));
      if (!reads) return true;
    }
    return children(node).some(effects);
  };
  /** A statement that leaves its block: `return`, `throw`, or a block ending in one. */
  const exits = (statement: unknown): boolean => {
    if (!isNode(statement)) return false;
    if (
      statement.type === 'ReturnStatement' ||
      statement.type === 'ThrowStatement'
    ) {
      return true;
    }
    if (statement.type === 'BlockStatement') {
      const body = statement.body as unknown[];
      return exits(body[body.length - 1]);
    }
    return false;
  };
  /**
   * What a MotionConfig says about reduced motion: `stops` for
   * `reducedMotion="user"` or `"always"`, `overrides` for any other value
   * it sets (`"never"`, or one only known at run time), and undefined when
   * it sets none and so inherits the provider above it.
   */
  const configSetting = (element: Node): 'stops' | 'overrides' | undefined => {
    const opening = element.openingElement;
    if (!isNode(opening)) return undefined;
    if (!configOpenings.has(opening)) return undefined;
    let setting: 'stops' | 'overrides' | undefined;
    for (const attribute of opening.attributes as unknown[]) {
      if (!isNode(attribute)) continue;
      if (attribute.type === 'JSXSpreadAttribute') {
        setting = 'overrides';
        continue;
      }
      if (attribute.type !== 'JSXAttribute') continue;
      if (dotted(attribute.name) !== 'reducedMotion') continue;
      let value = attribute.value;
      if (isNode(value) && value.type === 'JSXExpressionContainer') {
        value = value.expression;
      }
      setting =
        isNode(value) &&
        value.type === 'StringLiteral' &&
        /^(?:user|always)$/.test(value.value as string)
          ? 'stops'
          : 'overrides';
    }
    return setting;
  };
  const configured = (element: Node): boolean =>
    configSetting(element) === 'stops';
  /**
   * The setting of the nearest MotionConfig around a node that sets
   * reduced motion: a nearer `reducedMotion="never"` overrides a
   * configured provider further out (#239 review).
   */
  const nearestConfig = (
    ancestors: Node[],
  ): 'stops' | 'overrides' | undefined => {
    for (let i = ancestors.length - 1; i >= 0; i -= 1) {
      const ancestor = ancestors[i]!;
      if (ancestor.type !== 'JSXElement') continue;
      const setting = configSetting(ancestor);
      if (setting !== undefined) return setting;
    }
    return undefined;
  };

  /**
   * Whether an ancestor stops the node for a visitor who asked: a branch
   * the preference rules out, a return before it that the preference
   * takes, or (for elements) a configured MotionConfig around it.
   */
  const guarded = (
    node: Node,
    ancestors: Node[],
    { provider }: { provider: boolean },
  ): boolean => {
    for (let i = ancestors.length - 1; i >= 0; i -= 1) {
      const ancestor = ancestors[i]!;
      const child = ancestors[i + 1] ?? node;
      if (
        ancestor.type === 'ConditionalExpression' ||
        ancestor.type === 'IfStatement'
      ) {
        if (
          within(child, ancestor.consequent) &&
          trueOnlyWithout(ancestor.test)
        ) {
          return true;
        }
        if (
          within(child, ancestor.alternate) &&
          reducedMakesTrue(ancestor.test)
        ) {
          return true;
        }
      }
      if (
        ancestor.type === 'LogicalExpression' &&
        within(child, ancestor.right)
      ) {
        if (ancestor.operator === '&&' && trueOnlyWithout(ancestor.left)) {
          return true;
        }
        if (ancestor.operator === '||' && reducedMakesTrue(ancestor.left)) {
          return true;
        }
      }
      if (ancestor.type === 'BlockStatement' || ancestor.type === 'Program') {
        for (const statement of ancestor.body as unknown[]) {
          if (!isNode(statement) || statement.start >= child.start) break;
          if (
            statement.type === 'IfStatement' &&
            reducedMakesTrue(statement.test) &&
            exits(statement.consequent)
          ) {
            return true;
          }
        }
      }
    }
    return provider && nearestConfig(ancestors) === 'stops';
  };

  const coverage: MotionCoverage = {
    declarative: { total: 0, uncovered: 0 },
    scripted: { total: 0, uncovered: 0 },
    providers: [],
    returnRoots: {},
  };
  const elementName = (opening: Node): string | undefined =>
    dotted(opening.name);
  const keyOf = (property: Node): string | undefined =>
    isNode(property.key)
      ? property.key.type === 'Identifier'
        ? (property.key.name as string)
        : property.key.type === 'StringLiteral'
          ? (property.key.value as string)
          : undefined
      : undefined;
  const unwrap = (value: unknown): Node | undefined => {
    const expression =
      isNode(value) && value.type === 'JSXExpressionContainer'
        ? value.expression
        : value;
    return isNode(expression) ? expression : undefined;
  };
  /**
   * What a visitor who asked is given by a value that decides on the
   * preference: the branch the preference takes (`reduce ? A : B` gives A,
   * `!reduce ? A : B` gives B), `null` when that is nothing
   * (`!reduce && A`), or `undefined` when the value does not decide on it
   * or the direction cannot be told (#239 review).
   */
  const reducedBranch = (expression: Node): Node | null | undefined => {
    if (expression.type === 'ConditionalExpression') {
      if (reducedMakesTrue(expression.test)) {
        return isNode(expression.consequent) ? expression.consequent : null;
      }
      if (trueOnlyWithout(expression.test)) {
        return isNode(expression.alternate) ? expression.alternate : null;
      }
      return undefined;
    }
    if (expression.type === 'LogicalExpression') {
      if (expression.operator === '&&') {
        if (trueOnlyWithout(expression.left)) return null;
        if (reducedMakesTrue(expression.left)) {
          return isNode(expression.right) ? expression.right : null;
        }
      }
      if (expression.operator === '||') {
        if (reducedMakesTrue(expression.left)) return null;
        if (trueOnlyWithout(expression.left)) {
          return isNode(expression.right) ? expression.right : null;
        }
      }
    }
    return undefined;
  };
  /**
   * A value that moves nothing: nothing, `false`, the resting value of a
   * moving key (0, or 1 for scale), keyframes of those, or an object whose
   * moving keys all rest. Opacity and colour are not movement.
   */
  const still = (value: unknown, key?: string): boolean => {
    const expression = unwrap(value);
    if (!expression) return false;
    switch (expression.type) {
      case 'NullLiteral':
        return true;
      case 'Identifier':
        return expression.name === 'undefined';
      case 'BooleanLiteral':
        return expression.value === false;
      case 'NumericLiteral':
        return (
          expression.value === (key !== undefined && /^scale/.test(key) ? 1 : 0)
        );
      case 'StringLiteral':
        return key !== undefined && /^scale/.test(key)
          ? /^1(?:\.0+)?$/.test(expression.value as string)
          : /^(?:-?0(?:\.0+)?(?:px|%|deg|rad|turn|rem|em|vh|vw)?|none)$/.test(
              expression.value as string,
            );
      case 'ArrayExpression':
        return (expression.elements as unknown[]).every((element) =>
          still(element, key),
        );
      case 'ObjectExpression':
        return (expression.properties as unknown[]).every((property) => {
          if (!isNode(property) || property.type !== 'ObjectProperty') {
            return false;
          }
          const name = keyOf(property);
          if (name === undefined) return false;
          if (name === 'transition' || !MOVEMENT.test(name)) return true;
          return still(property.value, name);
        });
      default:
        return false;
    }
  };
  /**
   * Whether a prop animates movement at all: any moving key, whatever its
   * value, since `y: 0` moves from wherever the element was; or a value
   * that is not written out (a variant name, a condition). Only `false`
   * and objects of fades and colours do not (#239 review).
   */
  /**
   * Keyframes that only fade or colour: `{ opacity: 1 }`, a list of such
   * objects, or a sequence whose every segment, `[el, { opacity: 1 }]`,
   * animates such keyframes. Labels in a sequence move nothing.
   */
  const fadeOnly = (node: Node, depth = 0): boolean => {
    // A target declared first, list or object (#239 review).
    const list = arrayUses.get(node);
    const resolved =
      (list && !mutatedArrays.has(list) ? list : undefined) ??
      resolveObject(node) ??
      node;
    if (resolved.type === 'ObjectExpression') return !moves(resolved);
    if (resolved.type !== 'ArrayExpression' || depth > 1) return false;
    const elements = resolved.elements as unknown[];
    return (
      elements.length > 0 &&
      elements.every((element) => {
        if (!isNode(element)) return false;
        if (element.type === 'ObjectExpression') return !moves(element);
        if (element.type === 'StringLiteral') return depth === 0;
        if (element.type === 'ArrayExpression' && depth === 0) {
          const segment = (element.elements as unknown[])[1];
          return isNode(segment) && fadeOnly(segment, depth + 1);
        }
        return false;
      })
    );
  };
  /** An object declared where it is written, for a name bound to it. */
  const resolveObject = (node: Node | undefined): Node | undefined => {
    if (node === undefined) return undefined;
    const object = objectUses.get(node);
    return object && !mutated.has(object) ? object : node;
  };
  const moves = (value: unknown): boolean => {
    // A target declared first, `const fade = { opacity: 1 }`, is read
    // where it is written (#239 review).
    const expression = resolveObject(unwrap(value));
    if (!expression) return true;
    if (expression.type === 'BooleanLiteral') return expression.value !== false;
    if (expression.type !== 'ObjectExpression') return true;
    return (expression.properties as unknown[]).some((property) => {
      if (!isNode(property) || property.type !== 'ObjectProperty') return true;
      const name = keyOf(property);
      return (
        name === undefined || (name !== 'transition' && MOVEMENT.test(name))
      );
    });
  };
  /**
   * Whether the preference leaves a value still for a visitor who asked:
   * the branch it takes is still (`reduce ? {} : { x: 100 }`, not
   * `reduce ? { x: 100 } : {}`), or, in an object, each key that moves is
   * (#239 review). `{ x: 200, opacity: reduce ? 0 : 1 }` still moves
   * along x.
   */
  const governs = (value: unknown, key?: string): boolean => {
    // A target declared first is read where it is written (#239 review).
    const expression = resolveObject(unwrap(value));
    if (!expression) return false;
    const branch = reducedBranch(expression);
    if (branch === null) return true;
    // The branch read where it is written, `reduce ? calm : {...}` with
    // `const calm = { x: 0 }` (#239 review).
    if (branch !== undefined) {
      const resolved = resolveObject(branch) ?? branch;
      return still(resolved, key) || governs(branch, key);
    }
    if (expression.type === 'ObjectExpression') {
      return (expression.properties as unknown[]).every((property) => {
        if (!isNode(property)) return false;
        if (property.type !== 'ObjectProperty') {
          return governs(property.argument);
        }
        const name = keyOf(property);
        if (
          name !== undefined &&
          (name === 'transition' || !MOVEMENT.test(name))
        ) {
          return true;
        }
        return governs(property.value, name);
      });
    }
    return false;
  };
  const referencesLinked = (node: Node): Node[] => {
    const found: Node[] = [];
    // Through a style object declared first, `const style = { y: scrollY }`
    // (#239 review).
    const seen = new Set<Node>();
    const visit = (current: Node, parent?: Node) => {
      const object = objectUses.get(current);
      if (object && !seen.has(object)) {
        seen.add(object);
        visit(object);
        // And what is written to it after (#239 review).
        for (const value of writes.get(object) ?? []) visit(value);
      }
      if (
        current.type === 'Identifier' &&
        linkedUses.has(current) &&
        !(
          parent &&
          parent.type === 'MemberExpression' &&
          parent.property === current &&
          !parent.computed
        ) &&
        !(
          parent &&
          parent.type === 'ObjectProperty' &&
          parent.key === current &&
          !parent.shorthand
        )
      ) {
        found.push(linkedUses.get(current)!);
      }
      for (const child of children(current)) visit(child, current);
    };
    visit(node);
    return found;
  };

  /**
   * An argument that configures a hook rather than giving it its value:
   * an options object, `useSpring(scrollY, { stiffness: 100 })`, in any
   * branch it takes.
   */
  const optionsArgument = (argument: Node): boolean => {
    if (argument.type === 'ObjectExpression') return true;
    if (argument.type === 'ConditionalExpression') {
      return [argument.consequent, argument.alternate].some(
        (branch) => isNode(branch) && optionsArgument(branch),
      );
    }
    if (argument.type === 'LogicalExpression') {
      return [argument.left, argument.right].some(
        (branch) => isNode(branch) && optionsArgument(branch),
      );
    }
    return false;
  };
  /**
   * A linked value's hook told to rest, by an argument that gives it its
   * value: `useTransform(p, [0, 1], reduce ? [0, 0] : [0, 200])`. Options
   * chosen on the preference, `useSpring(scrollY, reduce ? {} : {...})`,
   * still follow the source (#239 review).
   */
  const initRests = (init: Node): boolean =>
    init.type === 'CallExpression' &&
    (init.arguments as unknown[]).some(
      (argument) =>
        isNode(argument) &&
        !optionsArgument(argument) &&
        reducedBranch(argument) !== undefined &&
        governs(argument),
    );
  /**
   * Whether every linked value a style carries is replaced or told to rest
   * for a visitor who asked (#239 review): the style chosen on the
   * preference with no linked value in the branch it takes, or each key
   * that carries one decided so, or the value's own hook told to rest.
   * `{ y, opacity: reduce ? 0 : 1 }` still moves with y.
   */
  const linkedStyleStill = (value: unknown): boolean => {
    const expression = resolveObject(unwrap(value));
    if (!expression) return false;
    const branch = reducedBranch(expression);
    if (branch === null) return true;
    if (branch !== undefined) {
      return referencesLinked(branch).every((source) => initRests(source));
    }
    if (expression.type === 'ObjectExpression') {
      return (expression.properties as unknown[]).every((property) => {
        if (!isNode(property)) return false;
        const carried = isNode(property.value)
          ? property.value
          : isNode(property.argument)
            ? property.argument
            : undefined;
        if (!carried) return true;
        // A linked opacity or colour fades; only a key that moves counts
        // (#239 review).
        const key =
          property.type === 'ObjectProperty' ? keyOf(property) : undefined;
        if (key !== undefined && !MOVEMENT.test(key)) return true;
        const sources = referencesLinked(carried);
        if (sources.length === 0) return true;
        if (sources.every((source) => initRests(source))) return true;
        return linkedStyleStill(carried);
      });
    }
    return referencesLinked(expression).every((source) => initRests(source));
  };

  /**
   * The linked values a style moves the element by: under a key that
   * moves, or where the key cannot be read. `style={{ opacity }}` linked to
   * scroll fades, as a declarative fade does (#239 review).
   */
  const movingLinked = (value: unknown): Node[] => {
    const expression = resolveObject(unwrap(value));
    if (!expression) return [];
    if (expression.type !== 'ObjectExpression') {
      return referencesLinked(expression);
    }
    return (expression.properties as unknown[]).flatMap((property) => {
      if (!isNode(property)) return [];
      if (property.type !== 'ObjectProperty') return referencesLinked(property);
      const key = keyOf(property);
      if (key !== undefined && !MOVEMENT.test(key)) return [];
      return isNode(property.value) ? movingLinked(property.value) : [];
    });
  };

  const walk = (node: Node, ancestors: Node[]) => {
    if (node.type === 'JSXOpeningElement') {
      const name = elementName(node);
      if (name !== undefined && motionOpenings.has(node)) {
        const attributes = (node.attributes as unknown[]).filter(
          (attribute): attribute is Node =>
            isNode(attribute) &&
            attribute.type === 'JSXAttribute' &&
            MOTION_PROPS.has(dotted(attribute.name) ?? ''),
        );
        // A bare `layout` or `drag` moves; a prop that only fades does not,
        // and an element that only fades is not motion MotionConfig would
        // stop (#239 review).
        // `initial` alone sets where the element starts and animates
        // nothing: it moves only toward a target another prop, or a spread
        // that may carry one, gives it (#239 review).
        const targeted =
          attributes.some(
            (attribute) => dotted(attribute.name) !== 'initial',
          ) ||
          (node.attributes as unknown[]).some(
            (attribute) =>
              isNode(attribute) && attribute.type === 'JSXSpreadAttribute',
          );
        // And only by the keys a target animates: `initial={{ x: 100,
        // opacity: 0 }} animate={{ opacity: 1 }}` leaves x where it starts
        // (#239 review). Unknown when a target is not written out (a
        // variant name, a condition, a spread).
        const targetKeys = ((): Set<string> | undefined => {
          if (
            (node.attributes as unknown[]).some(
              (attribute) =>
                isNode(attribute) && attribute.type === 'JSXSpreadAttribute',
            )
          ) {
            return undefined;
          }
          const keys = new Set<string>();
          for (const attribute of attributes) {
            const name = dotted(attribute.name);
            if (
              name === 'initial' ||
              name === 'layout' ||
              name === 'layoutId' ||
              name === 'drag'
            ) {
              continue;
            }
            const target = resolveObject(unwrap(attribute.value));
            if (!target || target.type !== 'ObjectExpression') return undefined;
            for (const property of target.properties as unknown[]) {
              if (!isNode(property) || property.type !== 'ObjectProperty') {
                return undefined;
              }
              const key = keyOf(property);
              if (key === undefined) return undefined;
              keys.add(key);
            }
          }
          return keys;
        })();
        const initialMoves = (value: unknown): boolean => {
          if (targetKeys === undefined) return moves(value);
          const start = resolveObject(unwrap(value));
          if (!start || start.type !== 'ObjectExpression') return moves(value);
          return (start.properties as unknown[]).some((property) => {
            if (!isNode(property) || property.type !== 'ObjectProperty') {
              return true;
            }
            const key = keyOf(property);
            return (
              key === undefined ||
              (key !== 'transition' &&
                MOVEMENT.test(key) &&
                targetKeys.has(key))
            );
          });
        };
        const moving = attributes.filter((attribute) => {
          const initial = dotted(attribute.name) === 'initial';
          if (initial && !targeted) return false;
          if (attribute.value === null) return true;
          return initial
            ? initialMoves(attribute.value)
            : moves(attribute.value);
        });
        if (moving.length > 0) {
          coverage.declarative.total += 1;
          // Each prop that moves is left still by the preference itself:
          // `animate={reduce ? {} : { y: 0 }}`.
          const decided = moving.every(
            (attribute) => attribute.value !== null && governs(attribute.value),
          );
          // A provider stops only transforms and layout: a width, a
          // position or a path drawn keeps moving under it (#239 review).
          // Only what is written out where it can be read: an object of
          // transforms, or variant names whose variants are (#239 review).
          const transformsOnly = (value: unknown): boolean => {
            // A target declared first is read where it is written
            // (#239 review).
            const target = resolveObject(unwrap(value));
            if (!target || target.type !== 'ObjectExpression') return false;
            return (target.properties as unknown[]).every((property) => {
              if (!isNode(property) || property.type !== 'ObjectProperty') {
                return false;
              }
              const key = keyOf(property);
              return (
                key !== undefined &&
                (key === 'transition' ||
                  !MOVEMENT.test(key) ||
                  TRANSFORM.test(key))
              );
            });
          };
          const variantsAttribute = (node.attributes as unknown[]).find(
            (attribute): attribute is Node =>
              isNode(attribute) &&
              attribute.type === 'JSXAttribute' &&
              dotted(attribute.name) === 'variants',
          );
          const variantsValue = variantsAttribute
            ? unwrap(variantsAttribute.value)
            : undefined;
          const variants =
            variantsValue?.type === 'ObjectExpression'
              ? variantsValue
              : variantsValue?.type === 'Identifier'
                ? objectUses.get(variantsValue)
                : undefined;
          const variantStops = (name: string): boolean => {
            if (!variants) return false;
            const variant = (variants.properties as unknown[]).find(
              (property): property is Node =>
                isNode(property) &&
                property.type === 'ObjectProperty' &&
                keyOf(property) === name,
            );
            return variant !== undefined && transformsOnly(variant.value);
          };
          const providerStops = moving.every((attribute) => {
            const name = dotted(attribute.name) ?? '';
            if (name === 'layout' || name === 'layoutId' || name === 'drag') {
              return true;
            }
            const value = unwrap(attribute.value);
            if (!value) return false;
            if (value.type === 'StringLiteral') {
              return variantStops(value.value as string);
            }
            if (value.type === 'ArrayExpression') {
              return (value.elements as unknown[]).every(
                (element) =>
                  isNode(element) &&
                  element.type === 'StringLiteral' &&
                  variantStops(element.value as string),
              );
            }
            return transformsOnly(value);
          });
          if (
            !decided &&
            !(
              providerEverywhere &&
              providerStops &&
              nearestConfig(ancestors) !== 'overrides'
            ) &&
            !guarded(node, ancestors, { provider: providerStops })
          ) {
            coverage.declarative.uncovered += 1;
          }
        }
        // A value linked to scroll that reaches the element's style.
        for (const attribute of node.attributes as unknown[]) {
          if (
            !isNode(attribute) ||
            attribute.type !== 'JSXAttribute' ||
            dotted(attribute.name) !== 'style' ||
            !isNode(attribute.value)
          ) {
            continue;
          }
          const sources = movingLinked(attribute.value);
          if (sources.length === 0) continue;
          coverage.scripted.total += 1;
          const decided = linkedStyleStill(attribute.value);
          if (!decided && !guarded(node, ancestors, { provider: false })) {
            coverage.scripted.uncovered += 1;
          }
        }
      }
    }
    if (node.type === 'JSXElement' && configured(node)) {
      coverage.providers.push([node.start, node.end]);
    }
    // useAnimationFrame(() => { ... }) runs its callback every frame:
    // the callback has to leave the element still for a visitor who asked,
    // returning first or running only without the preference (#239 review).
    if (frameCalls.has(node)) {
      coverage.scripted.total += 1;
      const callback = (node.arguments as unknown[])[0];
      const body =
        isNode(callback) && isNode(callback.body) ? callback.body : undefined;
      const statements =
        body?.type === 'BlockStatement' ? (body.body as unknown[]) : [];
      const decided =
        // A guard that runs first: nothing but declarations before it, or
        // the frame has already moved (#239 review).
        statements.some(
          (statement, index) =>
            isNode(statement) &&
            statement.type === 'IfStatement' &&
            reducedMakesTrue(statement.test) &&
            exits(statement.consequent) &&
            statements
              .slice(0, index)
              .every(
                (before) =>
                  isNode(before) &&
                  before.type === 'VariableDeclaration' &&
                  !effects(before),
              ),
        ) ||
        (statements.length === 1 &&
          isNode(statements[0]) &&
          statements[0].type === 'IfStatement' &&
          trueOnlyWithout(statements[0].test) &&
          !statements[0].alternate);
      if (!decided && !guarded(node, ancestors, { provider: false })) {
        coverage.scripted.uncovered += 1;
      }
    }
    if (node.type === 'CallExpression') {
      const callee = node.callee;
      const starts =
        (isNode(callee) &&
          callee.type === 'Identifier' &&
          starterUses.has(callee)) ||
        starterCalls.has(node);
      const args = (node.arguments as unknown[]).filter(isNode);
      // The keyframes: the second argument, after the element or value it
      // moves (`animate(el, { x: 100 }, options)`), or the only one, a
      // sequence. Options decide nothing about what moves (#239 review).
      // A sequence, `animate([[el, { x: 100 }]], options)`, carries its
      // keyframes in the first (#239 review).
      // So does one declared first, `const seq = [[el, { x: 100 }]]`, and
      // one passed with only options after it, whatever it is called
      // (#239 review).
      const sequence =
        args.length < 2 ||
        args[0]?.type === 'ArrayExpression' ||
        (args[0] !== undefined && arrayUses.has(args[0])) ||
        (args.length === 2 &&
          args[1]!.type === 'ObjectExpression' &&
          (args[1]!.properties as unknown[]).length > 0 &&
          (args[1]!.properties as unknown[]).every((property) => {
            if (!isNode(property) || property.type !== 'ObjectProperty') {
              return false;
            }
            const key = keyOf(property);
            return key !== undefined && TIMING.test(key);
          }));
      const keyframes = sequence ? args[0] : args[1];
      // Keyframes that only fade or colour start no movement, as an
      // object, a list of them, or a sequence of such segments
      // (#239 review).
      if (starts && !(keyframes !== undefined && fadeOnly(keyframes))) {
        coverage.scripted.total += 1;
        // The keyframes decide, not any argument that mentions the
        // preference: `animate(el, { x: 100, opacity: reduce ? 0 : 1 })`
        // still moves (#239 review).
        const decided = keyframes !== undefined && governs(keyframes);
        if (!decided && !guarded(node, ancestors, { provider: false })) {
          coverage.scripted.uncovered += 1;
        }
      }
    }
    ancestors.push(node);
    for (const child of children(node)) walk(child, ancestors);
    ancestors.pop();
  };
  walk(program, []);
  coverage.returnRoots = returnRoots(program);
  return coverage;
}
