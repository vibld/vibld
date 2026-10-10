/**
 * Select and Annotate on the live preview (D188).
 *
 * The builder cannot reach into the preview: in a sandbox it is another
 * origin, and in the browser it is a frame with no origin at all. So the
 * page carries a small script of its own (`INSPECTOR_SCRIPT`), added by
 * whoever serves it (apps/preview's Worker for a sandbox, the in-browser
 * document for D125), and the two talk by message.
 *
 * Nothing here is written into the project. The script is added on the way
 * to the frame and never reaches an export, a push or a published site,
 * so the code somebody takes away is the code the model wrote.
 *
 * What comes back is a description of an element: its tag, text and
 * classes, the React components it sits in, and, where the dev server's
 * stack names it, the file that renders it. `locatePick` turns that into a
 * file and line in the project's own snapshot, and `withPicks` writes it
 * into the message, where the person sending it can read exactly what the
 * model is told.
 */

import type { ProjectFile } from './types.ts';

/** The `source` each side stamps on its messages. */
export const INSPECT_MESSAGE = {
  toPage: 'vibld-inspect:builder',
  fromPage: 'vibld-inspect:page',
} as const;

/**
 * Where apps/preview serves the script on a sandbox's own origin. A file
 * rather than an inline script, because a project's own
 * Content-Security-Policy may allow `'self'` and nothing inline.
 */
export const INSPECTOR_PATH = '/__vibld/inspect.js';

export type InspectMode = 'select' | 'annotate';

/** One element, as the page describes it. */
export interface PickedElement {
  tag: string;
  id?: string;
  classes: string[];
  /** Its visible text, trimmed and cut short. */
  text: string;
  /** alt, aria-label, title, placeholder, href or src, whichever it has. */
  attributes: Record<string, string>;
  /** Innermost first, as React names them. */
  components: string[];
  /** The project file the dev server's stack names, if it named one. */
  file?: string;
  /** That stack's line, which is of the served module and so approximate. */
  line?: number;
}

/** What one Select or Annotate gesture produced. */
export interface PreviewPick {
  kind: InspectMode;
  elements: PickedElement[];
}

const MAX_ELEMENTS = 6;
const MAX_TEXT = 160;
const MAX_CLASSES = 6;
const MAX_COMPONENTS = 6;
const ATTRIBUTE_NAMES = [
  'alt',
  'aria-label',
  'title',
  'placeholder',
  'href',
  'src',
] as const;

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * A page's message, checked. The page is the project's code and may say
 * anything, so every field is read as untrusted and cut to size.
 */
export function readPick(value: unknown): PreviewPick | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (data.source !== INSPECT_MESSAGE.fromPage) return null;
  const kind =
    data.kind === 'selected'
      ? 'select'
      : data.kind === 'annotated'
        ? 'annotate'
        : null;
  if (!kind || !Array.isArray(data.elements)) return null;
  const elements: PickedElement[] = [];
  for (const raw of data.elements.slice(0, MAX_ELEMENTS)) {
    const element = readElement(raw);
    if (element) elements.push(element);
  }
  return elements.length > 0 ? { kind, elements } : null;
}

function readElement(value: unknown): PickedElement | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const tag = text(raw.tag, 32)?.toLowerCase();
  if (!tag || !/^[a-z][a-z0-9-]*$/.test(tag)) return null;
  const element: PickedElement = {
    tag,
    classes: Array.isArray(raw.classes)
      ? raw.classes
          .map((entry) => text(entry, 60))
          .filter((entry): entry is string => entry !== undefined)
          .slice(0, MAX_CLASSES)
      : [],
    text: text(raw.text, MAX_TEXT) ?? '',
    attributes: {},
    components: Array.isArray(raw.components)
      ? raw.components
          .map((entry) => text(entry, 60))
          .filter(
            (entry): entry is string =>
              entry !== undefined && /^[A-Za-z_$][\w$.]*$/.test(entry),
          )
          .slice(0, MAX_COMPONENTS)
      : [],
  };
  const id = text(raw.id, 60);
  if (id) element.id = id;
  if (raw.attributes && typeof raw.attributes === 'object') {
    const attributes = raw.attributes as Record<string, unknown>;
    for (const name of ATTRIBUTE_NAMES) {
      const entry = text(attributes[name], 120);
      if (entry) element.attributes[name] = entry;
    }
  }
  const file = text(raw.file, 200);
  if (file && /^[\w./@-]+$/.test(file) && !file.includes('..')) {
    element.file = file.replace(/^\/+/, '');
  }
  if (
    typeof raw.line === 'number' &&
    Number.isInteger(raw.line) &&
    raw.line > 0
  ) {
    element.line = raw.line;
  }
  return element;
}

/** A file and line in the project's snapshot. */
export interface PickLocation {
  path: string;
  line: number;
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let at = 0; at < index; at += 1) {
    if (content.charCodeAt(at) === 10) line += 1;
  }
  return line;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Where a component is defined, if the project defines it once. */
function definitionOf(
  name: string,
  files: ProjectFile[],
): PickLocation | undefined {
  const base = name.split('.').pop() ?? name;
  const pattern = new RegExp(
    `\\b(?:function|const|let|class)\\s+${escapeRegExp(base)}\\b`,
  );
  for (const file of files) {
    const match = pattern.exec(file.content);
    if (match)
      return { path: file.path, line: lineOf(file.content, match.index) };
  }
  return undefined;
}

/**
 * What in an element's source is most likely to be written literally in
 * the file: its own text, then its id, alt or label, then a class name.
 */
function needles(element: PickedElement): string[] {
  const found: string[] = [];
  if (element.text) {
    const words = element.text.replace(/…$/, '').trim();
    found.push(words.slice(0, 40));
    // JSX often breaks a sentence over lines or around an expression, so
    // its first few words are worth a second look on their own.
    const first = words.split(' ').slice(0, 4).join(' ');
    if (first.length >= 8 && first !== found[0]) found.push(first);
  }
  if (element.id) found.push(`id="${element.id}"`);
  for (const name of ['alt', 'aria-label', 'placeholder', 'title'] as const) {
    const value = element.attributes[name];
    if (value) found.push(value.slice(0, 40));
  }
  for (const name of element.classes) {
    if (name.length >= 4) found.push(name);
  }
  return found.filter((entry) => entry.length >= 3);
}

function isSource(path: string): boolean {
  return /\.(?:tsx|jsx|ts|js|html)$/.test(path);
}

/**
 * Where an element is written, in the files the preview is running.
 *
 * In order: the file the dev server's stack named, searched for the
 * element's own text, id, label or classes; then the files that define the
 * components it sits in, innermost first; then any source file. A file
 * found with nothing in it to point at is still worth naming, at the
 * stack's line or the component's definition.
 */
export function locatePick(
  element: PickedElement,
  files: ProjectFile[],
): PickLocation | null {
  const sources = files.filter((file) => isSource(file.path));
  // The exact path, else the longest project path the stack's ends with.
  const byPath = (path: string) =>
    sources.find((file) => file.path === path) ??
    sources
      .filter((file) => path.endsWith(`/${file.path}`))
      .sort((a, b) => b.path.length - a.path.length)[0];
  const search = needles(element);
  // The first needle found wins. Where it is written more than once (two
  // buttons sharing a class), the occurrence nearest `near`, the line the
  // stack named, is the one; with no line, the first.
  const searchIn = (
    file: ProjectFile,
    near?: number,
  ): PickLocation | undefined => {
    for (const needle of search) {
      let index = file.content.indexOf(needle);
      if (index === -1) continue;
      let best = lineOf(file.content, index);
      while (near !== undefined) {
        index = file.content.indexOf(needle, index + needle.length);
        if (index === -1) break;
        const line = lineOf(file.content, index);
        if (Math.abs(line - near) < Math.abs(best - near)) best = line;
      }
      return { path: file.path, line: best };
    }
    return undefined;
  };

  const stackFile = element.file ? byPath(element.file) : undefined;
  if (stackFile) {
    const found = searchIn(stackFile, element.line);
    if (found) return found;
  }

  const definitions = element.components
    .map((name) => definitionOf(name, sources))
    .filter((entry): entry is PickLocation => entry !== undefined);
  for (const definition of definitions) {
    const file = byPath(definition.path);
    const found = file ? searchIn(file) : undefined;
    if (found) return found;
  }

  if (stackFile) {
    const lines = stackFile.content.split('\n').length;
    return {
      path: stackFile.path,
      line: element.line && element.line <= lines ? element.line : 1,
    };
  }
  if (definitions[0]) return definitions[0];

  for (const file of sources) {
    const found = searchIn(file);
    if (found) return found;
  }
  return null;
}

/** An element in a few words: `<h1 class="hero-title"> "Fresh coffee"`. */
export function describeElement(element: PickedElement): string {
  const parts = [`<${element.tag}`];
  if (element.id) parts.push(` id="${element.id}"`);
  if (element.classes.length > 0) {
    parts.push(` class="${element.classes.join(' ')}"`);
  }
  parts.push('>');
  const label =
    element.text ||
    element.attributes.alt ||
    element.attributes['aria-label'] ||
    element.attributes.title ||
    element.attributes.placeholder;
  if (label) parts.push(` "${label}"`);
  return parts.join('');
}

/** A pick, located, ready to show on a chip and to send. */
export interface LocatedPick extends PreviewPick {
  locations: (PickLocation | null)[];
}

export function locatePicks(
  pick: PreviewPick,
  files: ProjectFile[],
): LocatedPick {
  return {
    ...pick,
    locations: pick.elements.map((element) => locatePick(element, files)),
  };
}

function elementLine(
  element: PickedElement,
  location: PickLocation | null,
): string {
  const where = [
    element.components[0] ? `in ${element.components[0]}` : null,
    location ? `(${location.path}:${location.line})` : null,
  ]
    .filter(Boolean)
    .join(' ');
  return `- ${describeElement(element)}${where ? ` ${where}` : ''}`;
}

/**
 * The message as sent: what was typed, then what was pointed at, in plain
 * words. Written into the message rather than sent beside it, so the
 * conversation shows the model's whole instruction and a follow-up build
 * needs nothing new to carry it.
 */
export function withPicks(
  prompt: string,
  picks: LocatedPick[],
  /**
   * The longest message the server takes. What was pointed at is added
   * only while it fits, so a prompt the composer accepted is never turned
   * into one the server refuses; the person's own words always go.
   */
  limit = Number.POSITIVE_INFINITY,
): string {
  let message = prompt.trimEnd();
  if (picks.length === 0) return prompt;
  for (const pick of picks) {
    const heading =
      pick.kind === 'select'
        ? 'Selected in the preview:'
        : 'Marked in the preview (a box drawn around these):';
    const lines = pick.elements.map((element, index) =>
      elementLine(element, pick.locations[index] ?? null),
    );
    let block = `\n\n${heading}`;
    for (const line of lines) {
      if (message.length + block.length + 1 + line.length > limit) break;
      block += `\n${line}`;
    }
    if (block === `\n\n${heading}`) break;
    message += block;
  }
  return message;
}

/**
 * The script the preview page runs. Plain JavaScript, written to run in
 * any page a model writes, with nothing to import.
 *
 * It answers only its parent frame, and only to the origin that parent's
 * own message came from. It does nothing until asked: Select outlines what
 * is under the pointer and reports the element clicked, without the click
 * reaching the app; Annotate lets somebody drag a box and reports the
 * elements inside it. Escape, or a message from the builder, stops either.
 */
export const INSPECTOR_SCRIPT = `(function () {
  'use strict';
  if (window.__vibldInspect || window.parent === window) return;
  window.__vibldInspect = true;
  var TO_PAGE = ${JSON.stringify(INSPECT_MESSAGE.toPage)};
  var FROM_PAGE = ${JSON.stringify(INSPECT_MESSAGE.fromPage)};
  var ATTRIBUTES = ${JSON.stringify(ATTRIBUTE_NAMES)};
  var builder = '*';
  var mode = null;
  var outline = null;
  var tag = null;
  var layer = null;
  var box = null;
  var start = null;

  function post(message) {
    message.source = FROM_PAGE;
    try { parent.postMessage(message, builder); } catch (e) {}
  }

  function cut(value, max) {
    value = String(value || '').replace(/\\s+/g, ' ').trim();
    return value.length > max ? value.slice(0, max - 1) + '\\u2026' : value;
  }

  function fiberOf(node) {
    for (var key in node) {
      if (key.indexOf('__reactFiber$') === 0) return node[key];
    }
    return null;
  }

  function nameOf(type) {
    if (!type) return null;
    if (typeof type === 'function') return type.displayName || type.name || null;
    if (typeof type === 'object') {
      return type.displayName || nameOf(type.render) || nameOf(type.type);
    }
    return null;
  }

  // The dev server's modules are served at their own paths, so a stack
  // frame names the file: React 19 keeps the JSX call's stack on the
  // fiber, and older versions keep its source.
  function sourceOf(fiber) {
    for (var f = fiber, hops = 0; f && hops < 20; f = f._debugOwner || null, hops++) {
      if (f._debugSource && f._debugSource.fileName) {
        return { file: f._debugSource.fileName, line: f._debugSource.lineNumber };
      }
      var stack = f._debugStack && f._debugStack.stack;
      if (typeof stack === 'string') {
        var lines = stack.split('\\n');
        for (var i = 0; i < lines.length; i++) {
          var match = /(?:https?:\\/\\/[^/\\s)]+)?(\\/src\\/[^?:\\s)]+)(?:\\?[^:\\s)]*)?:(\\d+):\\d+/.exec(lines[i]);
          if (match && !/node_modules/.test(match[1])) {
            return { file: match[1].replace(/^\\//, ''), line: Number(match[2]) };
          }
        }
      }
    }
    return null;
  }

  function describe(node) {
    var element = {
      tag: node.tagName.toLowerCase(),
      classes: [],
      text: cut(node.innerText || node.textContent, 160),
      attributes: {},
      components: []
    };
    if (node.id) element.id = cut(node.id, 60);
    var className = typeof node.className === 'string' ? node.className : node.getAttribute('class');
    if (className) element.classes = className.split(/\\s+/).filter(Boolean).slice(0, 6);
    for (var i = 0; i < ATTRIBUTES.length; i++) {
      var value = node.getAttribute(ATTRIBUTES[i]);
      if (value) element.attributes[ATTRIBUTES[i]] = cut(value, 120);
    }
    var fiber = fiberOf(node);
    for (var f = fiber; f && element.components.length < 6; f = f.return) {
      var name = nameOf(f.type);
      if (name && /^[A-Z]/.test(name) && element.components.indexOf(name) === -1) {
        element.components.push(name);
      }
    }
    var source = fiber && sourceOf(fiber);
    if (source) {
      element.file = source.file;
      if (source.line) element.line = source.line;
    }
    return element;
  }

  function ours(node) {
    return node === outline || node === tag || node === layer || node === box;
  }

  function show(node) {
    if (!outline) {
      outline = document.createElement('div');
      outline.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #ff4a1c;background:rgba(255,74,28,0.08);border-radius:2px;';
      tag = document.createElement('div');
      tag.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;font:12px/1.4 system-ui,sans-serif;color:#fff;background:#ff4a1c;padding:1px 6px;border-radius:3px;white-space:nowrap;';
      document.documentElement.appendChild(outline);
      document.documentElement.appendChild(tag);
    }
    var rect = node.getBoundingClientRect();
    outline.style.left = rect.left + 'px';
    outline.style.top = rect.top + 'px';
    outline.style.width = rect.width + 'px';
    outline.style.height = rect.height + 'px';
    var fiber = fiberOf(node);
    var component = null;
    for (var f = fiber; f && !component; f = f.return) {
      var name = nameOf(f.type);
      if (name && /^[A-Z]/.test(name)) component = name;
    }
    tag.textContent = node.tagName.toLowerCase() + (component ? ' \\u00b7 ' + component : '');
    tag.style.left = Math.max(0, rect.left) + 'px';
    tag.style.top = Math.max(0, rect.top - 20) + 'px';
  }

  function hide() {
    if (outline) { outline.remove(); tag.remove(); outline = null; tag = null; }
    if (layer) { layer.remove(); layer = null; box = null; start = null; }
  }

  function onMove(event) {
    if (mode === 'annotate') {
      block(event);
      return;
    }
    var node = event.target;
    if (mode !== 'select' || !(node instanceof Element) || ours(node)) return;
    show(node);
  }

  // On window in the capture phase, the first stop on every event's path,
  // and registered before the app's own code runs (the tag loading this is
  // synchronous and first in <head>), so nothing of the app sees a press.
  // The mouseup and click a browser sends after the pointerup that ends an
  // annotation come once the mode is off; they are swallowed too.
  var swallowUntil = 0;

  function block(event) {
    if (mode === null && Date.now() > swallowUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onClick(event) {
    if (mode === null && Date.now() > swallowUntil) return;
    block(event);
    if (mode !== 'select') return;
    var node = event.target;
    if (!(node instanceof Element) || ours(node)) return;
    post({ kind: 'selected', elements: [describe(node)] });
    stop();
  }

  // Every element whose box lies within the drawn one, or, when none lies
  // wholly within it, every element it overlaps: from the elements' own
  // bounds, so nothing small between two points is missed.
  // Laid out but not seen (visibility: hidden, or transparent itself or
  // through an ancestor): a closed menu, a modal waiting off.
  function shown(node) {
    if (typeof node.checkVisibility === 'function') {
      return node.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    }
    var style = getComputedStyle(node);
    return style.visibility === 'visible' && style.opacity !== '0';
  }

  function inside(rect) {
    var right = rect.left + rect.width;
    var bottom = rect.top + rect.height;
    var contained = [];
    var overlapping = [];
    var all = document.body ? document.body.getElementsByTagName('*') : [];
    for (var i = 0; i < all.length; i++) {
      var node = all[i];
      if (ours(node) || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|LINK|META)$/.test(node.tagName)) continue;
      var r = node.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || !shown(node)) continue;
      if (r.right <= rect.left || r.left >= right || r.bottom <= rect.top || r.top >= bottom) continue;
      overlapping.push(node);
      if (r.left >= rect.left && r.right <= right && r.top >= rect.top && r.bottom <= bottom) {
        contained.push(node);
      }
    }
    var found = contained.length > 0 ? contained : overlapping;
    // The innermost of each: an element whose child is also inside says
    // less than the child does.
    var leaves = found.filter(function (node) {
      return !found.some(function (other) { return other !== node && node.contains(other); });
    });
    return leaves.slice(0, 6).map(describe);
  }

  function annotate() {
    layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;inset:0;z-index:2147483646;cursor:crosshair;touch-action:none;background:rgba(18,20,24,0.04);';
    box = document.createElement('div');
    box.style.cssText = 'position:fixed;display:none;border:2px dashed #ff4a1c;background:rgba(255,74,28,0.08);border-radius:4px;pointer-events:none;';
    layer.appendChild(box);
    document.documentElement.appendChild(layer);
  }

  // The drawing gesture, taken in window's capture phase like Select's
  // presses, so none of it reaches the app's own pointer handlers.
  function onPointer(event) {
    if (mode === 'select') {
      if (event.type !== 'pointermove') block(event);
      return;
    }
    if (mode !== 'annotate' || !layer) return;
    block(event);
    // A gesture the browser took over draws nothing: annotate stops.
    if (event.type === 'pointercancel') {
      stop();
      return;
    }
    if (event.type === 'pointerdown') {
      start = { x: event.clientX, y: event.clientY };
      layer.setPointerCapture(event.pointerId);
      box.style.display = 'block';
      drawn(event);
      return;
    }
    if (!start) return;
    if (event.type === 'pointermove') {
      drawn(event);
      return;
    }
    var rect = drawn(event);
    start = null;
    if (rect.width < 4 && rect.height < 4) {
      rect = { left: rect.left - 1, top: rect.top - 1, width: 2, height: 2 };
    }
    var elements = inside(rect);
    if (elements.length > 0) post({ kind: 'annotated', elements: elements });
    swallowUntil = Date.now() + 500;
    stop();
  }

  function drawn(event) {
    var left = Math.min(start.x, event.clientX);
    var top = Math.min(start.y, event.clientY);
    var rect = {
      left: left,
      top: top,
      width: Math.abs(event.clientX - start.x),
      height: Math.abs(event.clientY - start.y)
    };
    box.style.left = rect.left + 'px';
    box.style.top = rect.top + 'px';
    box.style.width = rect.width + 'px';
    box.style.height = rect.height + 'px';
    return rect;
  }

  function stop() {
    if (mode === null) return;
    mode = null;
    hide();
    post({ kind: 'mode', mode: null });
  }

  document.addEventListener('mousemove', onMove, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('mousedown', block, true);
  window.addEventListener('mouseup', block, true);
  window.addEventListener('pointerdown', onPointer, true);
  window.addEventListener('pointermove', onPointer, true);
  window.addEventListener('pointerup', onPointer, true);
  window.addEventListener('pointercancel', onPointer, true);
  // Touch events come alongside the pointer ones and are kept from the app
  // too. Not canceled: that would stop the tap's click, which Select reads.
  function onTouch(event) {
    if (mode === null && Date.now() > swallowUntil) return;
    event.stopImmediatePropagation();
  }
  window.addEventListener('touchstart', onTouch, true);
  window.addEventListener('touchmove', onTouch, true);
  window.addEventListener('touchend', onTouch, true);
  window.addEventListener('submit', block, true);
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && mode !== null) {
      block(event);
      stop();
    }
  }, true);

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (event.source !== parent || !data || data.source !== TO_PAGE) return;
    builder = event.origin && event.origin !== 'null' ? event.origin : '*';
    if (data.kind === 'hello') {
      post({ kind: 'ready' });
      return;
    }
    if (data.kind !== 'mode') return;
    hide();
    mode = data.mode === 'select' || data.mode === 'annotate' ? data.mode : null;
    if (mode === 'annotate') annotate();
    post({ kind: 'mode', mode: mode });
  });

  post({ kind: 'ready' });
})();
`;
