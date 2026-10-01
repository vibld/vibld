import type { ImportMap } from './import-map.ts';

/**
 * The page the in-browser preview (D125) shows: the project's own
 * index.html, with its module script replaced by the bundle, its packages
 * mapped to the CDN, and its compiled stylesheet.
 *
 * It is shown in an iframe with `sandbox="allow-scripts ..."` and no
 * `allow-same-origin`, so the project's code runs in an opaque origin: it
 * cannot read the builder's storage or cookies, or call the builder's API
 * as the person looking at it, the isolation a sandbox's separate domain
 * gives (L8).
 *
 * Media and public files are not in the page. Its bootstrap asks the
 * builder for them by message (`PREVIEW_MESSAGE`), and serves each from an
 * object URL of its own, written over every place the code names its path.
 */

/** What the page and the builder say to each other, as `source`. */
export const PREVIEW_MESSAGE = {
  fromPage: 'vibld-preview',
  fromBuilder: 'vibld-builder',
} as const;

/** The iframe's sandbox: scripts, forms, dialogs and new tabs, no origin. */
export const PREVIEW_SANDBOX =
  'allow-scripts allow-forms allow-modals allow-popups';

/**
 * A file the page asks for: a media file (`media/hero.jpg`, named with or
 * without a leading slash), a file under public/ (`logo.svg`, named from
 * the root, `/logo.svg`) or a project file the code names by URL
 * (`src/logo.svg`, named `/src/logo.svg`).
 */
export interface PreviewAsset {
  path: string;
  kind: 'media' | 'public' | 'project';
}

export interface PreviewDocumentInput {
  indexHtml: string;
  importMap: ImportMap;
  js: string;
  css: string;
  assets: readonly PreviewAsset[];
  /**
   * The workers the bundle built, each served at its path. The page makes
   * their files itself, after the files they name are served, so a path
   * in a worker is written over like one in the page's own code.
   */
  workers?: readonly { path: string; js: string }[];
}

/**
 * IndexedDB for an app that uses it. The browser refuses the page's opaque
 * origin a database (`indexedDB.open` throws), so the page is given an
 * in-memory one, fake-indexeddb (Apache-2.0) from the CDN, before the
 * app's own code runs. Like the page's storage, it lasts while the page is
 * open.
 */
export const INDEXED_DB_MODULE = 'https://esm.sh/fake-indexeddb@6.2.5?bundle';

const INDEXED_DB_SHIM = `data:text/javascript,${encodeURIComponent(
  [
    `import * as idb from ${JSON.stringify(INDEXED_DB_MODULE)};`,
    `for (const name of ["indexedDB", "IDBCursor", "IDBCursorWithValue", "IDBDatabase", "IDBFactory", "IDBIndex", "IDBKeyRange", "IDBObjectStore", "IDBOpenDBRequest", "IDBRequest", "IDBTransaction", "IDBVersionChangeEvent"]) {`,
    `  Object.defineProperty(globalThis, name, { value: idb[name], configurable: true, writable: true });`,
    `}`,
  ].join('\n'),
)}`;

/** Whether the bundle uses IndexedDB, itself or through a package for it. */
export function usesIndexedDb(js: string): boolean {
  return /\bindexedDB\b|(?:\bfrom\s*|\bimport\s*\(\s*)["'](?:idb|idb-keyval|dexie|localforage)(?:\/[^"']*)?["']/.test(
    js,
  );
}

/** JSON that is safe inside a `<script>` element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

/**
 * Runs first in the page. Plain script, not a module, so it is in place
 * before the import map is read; written out as text because it runs in
 * the preview's document, not the builder's.
 */
const BOOTSTRAP = `(function () {
  var payload = JSON.parse(document.getElementById('vibld-preview-payload').textContent);
  function report(kind, message) {
    try {
      parent.postMessage({ source: ${JSON.stringify(PREVIEW_MESSAGE.fromPage)}, kind: kind, message: message === undefined ? undefined : String(message).slice(0, 2000) }, '*');
    } catch (error) {}
  }
  window.addEventListener('error', function (event) {
    report('error', event.message || 'The app threw an error.');
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    report('error', reason && reason.message ? reason.message : String(reason));
  });
  // The page has no origin, so the browser refuses it storage and any
  // change of its URL. Storage is kept in memory for as long as the page
  // is open; a history entry keeps its state without the URL, and a link
  // to a path of the app stays in the frame instead of loading the
  // builder there.
  function memoryStorage() {
    var items = {};
    return {
      get length() { return Object.keys(items).length; },
      key: function (index) { var keys = Object.keys(items); return index < keys.length ? keys[index] : null; },
      getItem: function (key) { key = String(key); return Object.prototype.hasOwnProperty.call(items, key) ? items[key] : null; },
      setItem: function (key, value) { items[String(key)] = String(value); },
      removeItem: function (key) { delete items[String(key)]; },
      clear: function () { items = {}; }
    };
  }
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    try {
      window[name].getItem('vibld');
    } catch (error) {
      try {
        Object.defineProperty(window, name, { value: memoryStorage(), configurable: true });
      } catch (ignored) {}
    }
  });
  var history = window.history;
  if (history) {
    ['pushState', 'replaceState'].forEach(function (name) {
      var original = history[name];
      history[name] = function (state, title, url) {
        try {
          return original.apply(history, arguments);
        } catch (error) {
          return original.call(history, state, title);
        }
      };
    });
  }
  // Nor will it start a module worker from a file it was handed (the
  // browser refuses the load), though a classic one is allowed: a module
  // worker is started as a classic one that imports the module, with the
  // messages sent meanwhile held until the module is listening.
  // The workers the bundle built are modules, however the code starts them.
  // A worker that starts workers of its own is given the same shim.
  function installWorkerShim(scope, built) {
    var NativeWorker = scope.Worker;
    if (!NativeWorker) return;
    var ModuleWorker = function Worker(url, options) {
      var isModule = (options && options.type === 'module') || built[String(url)];
      if (!isModule) return new NativeWorker(url, options);
      var rest = {};
      Object.keys(options || {}).forEach(function (key) {
        if (key !== 'type') rest[key] = options[key];
      });
      var loader = 'var held = [];' +
        'function hold(event) { held.push(event); }' +
        'self.onmessage = hold;' +
        'import(' + JSON.stringify(String(url)) + ').then(function () {' +
        '  if (self.onmessage === hold) self.onmessage = null;' +
        '  held.forEach(function (event) { self.dispatchEvent(new MessageEvent("message", { data: event.data, ports: event.ports })); });' +
        '}, function (error) { setTimeout(function () { throw error; }); });';
      return new NativeWorker(URL.createObjectURL(new Blob([loader], { type: 'text/javascript' })), rest);
    };
    ModuleWorker.prototype = NativeWorker.prototype;
    try {
      Object.defineProperty(scope, 'Worker', { value: ModuleWorker, configurable: true, writable: true });
    } catch (ignored) {}
    // Shared workers are refused outright, so one is a worker of the page's
    // own, its port handed over in a connect event as the browser would.
    if (!scope.SharedWorker) return;
    var SharedPageWorker = function SharedWorker(url, options) {
      if (typeof options === 'string') options = { name: options };
      var isModule = (options && options.type === 'module') || built[String(url)];
      var rest = {};
      Object.keys(options || {}).forEach(function (key) {
        if (key !== 'type') rest[key] = options[key];
      });
      var load = isModule
        ? 'import(' + JSON.stringify(String(url)) + ')'
        : 'Promise.resolve().then(function () { importScripts(' + JSON.stringify(String(url)) + '); })';
      var loader = 'self.addEventListener("message", function connect(event) {' +
        '  self.removeEventListener("message", connect);' +
        '  var port = event.ports[0];' +
        '  ' + load + '.then(function () {' +
        '    var connected = new MessageEvent("connect", { ports: [port] });' +
        '    if (typeof self.onconnect === "function") self.onconnect(connected);' +
        '    self.dispatchEvent(connected);' +
        '  }, function (error) { setTimeout(function () { throw error; }); });' +
        '});';
      var channel = new MessageChannel();
      var worker = new NativeWorker(URL.createObjectURL(new Blob([loader], { type: 'text/javascript' })), rest);
      worker.postMessage('connect', [channel.port2]);
      worker.port = channel.port1;
      return worker;
    };
    try {
      Object.defineProperty(scope, 'SharedWorker', { value: SharedPageWorker, configurable: true, writable: true });
    } catch (ignored) {}
  }
  var builtWorkers = {};
  installWorkerShim(window, builtWorkers);
  if (document.addEventListener) {
    document.addEventListener('click', function (event) {
      var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!link || event.defaultPrevented || (link.target && link.target !== '_self')) return;
      var href = link.getAttribute('href') || '';
      if (href.charAt(0) === '/' && href.charAt(1) !== '/') event.preventDefault();
    });
  }
  function escapeRegExp(text) {
    return text.replace(/[.*+?^\${}()|[\\]\\\\/]/g, '\\\\$&');
  }
  // The bootstrap runs in <head>, before the body exists.
  function whenParsed(urls, texts) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        start(urls, texts || {});
      });
    } else {
      start(urls, texts || {});
    }
  }
  function start(urls, texts) {
    var patterns = [];
    function serve(path, lead, url) {
      // A query (\`?v=2\`) is dropped: an object URL is matched exactly,
      // apart from its fragment, which is kept.
      patterns.push([new RegExp('(^|[^\\\\w./-])' + lead + escapeRegExp(path) + '(?![\\\\w-]|\\\\.\\\\w)(?:\\\\?[^#\\'"\\\\s)\`<>]*)?', 'g'), '$1' + url]);
    }
    // The page is at the root, so a string that is a file's name alone
    // (\`"logo.svg"\`, \`"./logo.svg"\`) names it from there too.
    function serveRelative(path, url) {
      patterns.push([new RegExp('(["\\'\`])(?:\\\\./)?' + escapeRegExp(path) + '(?:\\\\?[^#"\\'\`\\\\s]*)?(#[^"\\'\`\\\\s]*)?\\\\1', 'g'), '$1' + url + '$2$1']);
    }
    function serveAsset(asset, url) {
      serve(asset.path, asset.kind === 'media' ? '\\\\/?' : '\\\\/', url);
      if (asset.kind !== 'media') serveRelative(asset.path, url);
    }
    var sheets = [];
    payload.assets.forEach(function (asset) {
      var url = urls[asset.path];
      if (!url) return;
      if (typeof texts[asset.path] === 'string') sheets.push(asset);
      else serveAsset(asset, url);
    });
    // Each file whose text names another of the list comes after that one,
    // so the other is served in it; a cycle is broken where it is found.
    function dependenciesFirst(items, pathOf, textOf) {
      var left = items.slice();
      var order = [];
      while (left.length > 0) {
        var next = 0;
        for (var k = 0; k < left.length; k++) {
          var text = textOf(left[k]);
          var waits = left.some(function (other) {
            return other !== left[k] && text.indexOf(pathOf(other)) !== -1;
          });
          if (!waits) {
            next = k;
            break;
          }
        }
        order.push(left.splice(next, 1)[0]);
      }
      return order;
    }
    // A stylesheet the page is handed names files by their paths too
    // (\`url(/hero.png)\`), which are served in it before it is.
    dependenciesFirst(sheets, function (asset) { return asset.path; }, function (asset) { return texts[asset.path]; }).forEach(function (asset) {
      var url = URL.createObjectURL(new Blob([served(texts[asset.path])], { type: 'text/css' }));
      serveAsset(asset, url);
    });
    function served(text) {
      patterns.forEach(function (pattern) {
        text = text.replace(pattern[0], pattern[1]);
      });
      return text;
    }
    // A worker that starts another is made after it, and each one's own
    // paths are served like the page's.
    dependenciesFirst(payload.workers || [], function (worker) { return worker.path; }, function (worker) { return worker.js; }).forEach(function (worker) {
      var shim = '(' + installWorkerShim.toString() + ')(self, ' + JSON.stringify(builtWorkers) + ');\\n';
      var url = URL.createObjectURL(new Blob([shim + served(worker.js)], { type: 'text/javascript' }));
      builtWorkers[url] = true;
      serve(worker.path, '\\\\/', url);
    });
    var js = served(payload.js);
    var css = served(payload.css);
    // index.html can name the same files: an icon, an image. It sits at
    // the root, so a relative name (\`logo.svg\`, \`./logo.svg\`) is one
    // from the root too.
    function servedFromRoot(value) {
      var next = served(value);
      if (next !== value || /^(?:[a-z][a-z0-9+.-]*:|\\/|#|\\?)/i.test(value)) return next;
      var rooted = '/' + value.replace(/^(?:\\.\\/)+/, '');
      next = served(rooted);
      return next !== rooted ? next : value;
    }
    var named = patterns.length > 0 ? document.querySelectorAll('[src], [href], [poster], [srcset]') : [];
    for (var i = 0; i < named.length; i++) {
      ['src', 'href', 'poster', 'srcset'].forEach(function (name) {
        var value = named[i].getAttribute(name);
        if (value === null) return;
        var next = name === 'srcset'
          ? value.split(',').map(function (candidate) {
              var lead = /^\\s*/.exec(candidate)[0];
              var parts = candidate.slice(lead.length).split(/(\\s+)/);
              parts[0] = servedFromRoot(parts[0]);
              return lead + parts.join('');
            }).join(',')
          : servedFromRoot(value.trim());
        if (next !== value && next !== value.trim()) named[i].setAttribute(name, next);
      });
    }
    // Its own styles can name them too (\`url(/hero.png)\`).
    var styled = patterns.length > 0 ? document.querySelectorAll('style, [style]') : [];
    for (var j = 0; j < styled.length; j++) {
      var element = styled[j];
      var inline = element.getAttribute('style');
      if (inline) {
        var servedInline = served(inline);
        if (servedInline !== inline) element.setAttribute('style', servedInline);
      }
      if (element.tagName === 'STYLE' && typeof element.textContent === 'string') {
        var servedSheet = served(element.textContent);
        if (servedSheet !== element.textContent) element.textContent = servedSheet;
      }
    }
    // Where index.html linked a project stylesheet, so the page's own
    // styles after it still come after it; otherwise last in <head>.
    var linked = document.querySelector ? document.querySelector('style[data-vibld-styles]') : null;
    if (linked) {
      linked.textContent = css;
    } else {
      var style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
    }
    var script = document.createElement('script');
    script.type = 'module';
    script.textContent = js;
    script.addEventListener('error', function () {
      report('error', 'A package the app imports could not be loaded.');
    });
    document.body.appendChild(script);
    report('started');
  }
  if (payload.assets.length === 0) {
    whenParsed({});
    return;
  }
  var asking;
  window.addEventListener('message', function onMessage(event) {
    var data = event.data;
    if (event.source !== parent || !data || data.source !== ${JSON.stringify(PREVIEW_MESSAGE.fromBuilder)}) return;
    window.removeEventListener('message', onMessage);
    clearInterval(asking);
    var urls = {};
    var texts = {};
    var reading = [];
    (data.assets || []).forEach(function (asset) {
      if (asset && typeof asset.path === 'string' && asset.blob instanceof Blob) {
        urls[asset.path] = URL.createObjectURL(asset.blob);
        if (asset.blob.type === 'text/css' && asset.blob.text) {
          reading.push(asset.blob.text().then(function (text) {
            texts[asset.path] = text;
          }, function () {}));
        }
      }
    });
    if (reading.length === 0) whenParsed(urls, texts);
    else Promise.all(reading).then(function () {
      whenParsed(urls, texts);
    });
  });
  // Asked again until answered: the page can load before the builder is
  // listening, and a request sent then is lost.
  var asks = 0;
  report('assets');
  asking = setInterval(function () {
    asks += 1;
    if (asks >= 40) clearInterval(asking);
    report('assets');
  }, 250);
})();`;

/**
 * index.html without the module scripts that load project files, which
 * are bundled, or a Content-Security-Policy meta tag: the page runs the
 * bundle inline, which a policy written for the dev server's own files
 * (`script-src 'self'`) would block, and the frame's sandbox is what
 * isolates it here.
 */
function withoutEntryScripts(indexHtml: string): string {
  return indexHtml
    .replace(
      /<meta\b(?=[^>]*\bhttp-equiv=["']?content-security-policy["']?)[^>]*>/gi,
      '',
    )
    .replace(
      /<script\b(?=[^>]*\btype=["']?module\b)(?=[^>]*\bsrc=(?:["'](?![a-z][a-z0-9+.-]*:|\/\/)|(?![a-z][a-z0-9+.-]*:|\/\/|["'])))[^>]*>\s*<\/script>/gi,
      '',
    );
}

/** The page, as the `srcdoc` of the preview's iframe. */
export function previewDocument(input: PreviewDocumentInput): string {
  const head = [
    `<script type="importmap">${scriptJson(input.importMap)}</script>`,
    `<script type="application/json" id="vibld-preview-payload">${scriptJson({
      js: usesIndexedDb(input.js)
        ? `import ${JSON.stringify(INDEXED_DB_SHIM)};\n${input.js}`
        : input.js,
      css: input.css,
      assets: input.assets,
      workers: input.workers ?? [],
    })}</script>`,
    `<script>${BOOTSTRAP}</script>`,
  ].join('\n');

  const page = withoutEntryScripts(input.indexHtml);
  if (/<head\b[^>]*>/i.test(page)) {
    return page.replace(/<head\b[^>]*>/i, (open) => `${open}\n${head}`);
  }
  return `<!doctype html><html><head>${head}</head><body>${page}</body></html>`;
}
