#!/usr/bin/env node
/**
 * US English in everything people read (docs/decisions.md, D120).
 *
 *   node scripts/us-english.mjs          # check: list every UK spelling
 *   node scripts/us-english.mjs --fix    # rewrite them
 *
 * What people read is changed; what code reads is not:
 *
 * - TypeScript and JavaScript: string literals, template text and JSX
 *   text only (parsed with @babel/parser). Identifiers, comments, object
 *   keys, imports, and strings that look like a slug, path, URL or name
 *   (no space, and a `-`, `/`, `.`, `_`, `:` or `@` in them) stay as they
 *   are, because changing them changes behavior, not spelling.
 * - Markdown: prose only; code blocks, inline code and link targets stay.
 * - HTML: text only; tags, attributes, <style> and <script> stay.
 *
 * Third-party licence texts and anything under `EXCLUDE` are legal or
 * vendored text and are never touched.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** What people read. */
export const INCLUDE = [
  /^apps\/marketing\/app\/.+\.(ts|tsx)$/,
  /^apps\/marketing\/scripts\/.+\.ts$/,
  /^apps\/marketing\/public\/layers\/.+\.(html|md|txt)$/,
  /^apps\/web\/src\/.+\.(ts|tsx)$/,
  /^apps\/web\/worker\/.+\.ts$/,
  /^apps\/web\/index\.html$/,
  /^apps\/preview\/worker\/.+\.ts$/,
  /^apps\/publish\/worker\/.+\.ts$/,
  /^packages\/ai\/(src|data|bin)\/.+\.ts$/,
  /^templates\/[^/]+\/((src|app)\/.+\.(ts|tsx)|index\.html|README\.md|DESIGN\.md)$/,
  /^[^/]+\.md$/,
  /^apps\/[^/]+\/README\.md$/,
  /^packages\/[^/]+\/README\.md$/,
  /^docs\/.+\.md$/,
];

/** Legal or vendored text, generated fonts, and tests of this very file. */
export const EXCLUDE = [
  /(^|\/)LICEN[CS]E/i,
  /(^|\/)NOTICE/i,
  /\/fonts\//,
  /\.gen\.ts$/,
  /^docs\/archive\//,
  /^scripts\/us-english/,
];

// Word -> US word, lower case. Each stem's inflections are generated below.
const STEMS = {
  // -our
  colour: 'color',
  flavour: 'flavor',
  favour: 'favor',
  behaviour: 'behavior',
  honour: 'honor',
  humour: 'humor',
  labour: 'labor',
  neighbour: 'neighbor',
  rumour: 'rumor',
  harbour: 'harbor',
  vigour: 'vigor',
  savour: 'savor',
  armour: 'armor',
  odour: 'odor',
  endeavour: 'endeavor',
  saviour: 'savior',
  parlour: 'parlor',
  // -re
  centre: 'center',
  metre: 'meter',
  litre: 'liter',
  theatre: 'theater',
  fibre: 'fiber',
  calibre: 'caliber',
  sombre: 'somber',
  lustre: 'luster',
  meagre: 'meager',
  spectre: 'specter',
  // -ogue
  catalogue: 'catalog',
  analogue: 'analog',
  // -ise verbs that are -ize in US English (never advertise, promise, etc.)
  organise: 'organize',
  recognise: 'recognize',
  realise: 'realize',
  customise: 'customize',
  optimise: 'optimize',
  prioritise: 'prioritize',
  summarise: 'summarize',
  visualise: 'visualize',
  standardise: 'standardize',
  normalise: 'normalize',
  initialise: 'initialize',
  finalise: 'finalize',
  minimise: 'minimize',
  maximise: 'maximize',
  emphasise: 'emphasize',
  apologise: 'apologize',
  categorise: 'categorize',
  characterise: 'characterize',
  utilise: 'utilize',
  personalise: 'personalize',
  authorise: 'authorize',
  synchronise: 'synchronize',
  specialise: 'specialize',
  memorise: 'memorize',
  localise: 'localize',
  serialise: 'serialize',
  capitalise: 'capitalize',
  criticise: 'criticize',
  sanitise: 'sanitize',
  stabilise: 'stabilize',
  harmonise: 'harmonize',
  energise: 'energize',
  modernise: 'modernize',
  monetise: 'monetize',
  digitise: 'digitize',
  itemise: 'itemize',
  legitimise: 'legitimize',
  mobilise: 'mobilize',
  neutralise: 'neutralize',
  penalise: 'penalize',
  rationalise: 'rationalize',
  revolutionise: 'revolutionize',
  scrutinise: 'scrutinize',
  familiarise: 'familiarize',
  generalise: 'generalize',
  idealise: 'idealize',
  italicise: 'italicize',
  materialise: 'materialize',
  centralise: 'centralize',
  decentralise: 'decentralize',
  formalise: 'formalize',
  humanise: 'humanize',
  immunise: 'immunize',
  jeopardise: 'jeopardize',
  patronise: 'patronize',
  publicise: 'publicize',
  sympathise: 'sympathize',
  theorise: 'theorize',
  trivialise: 'trivialize',
  vaporise: 'vaporize',
  weaponise: 'weaponize',
  winterise: 'winterize',
  tokenise: 'tokenize',
  parametrise: 'parametrize',
  randomise: 'randomize',
  containerise: 'containerize',
  // -yse
  analyse: 'analyze',
  paralyse: 'paralyze',
  catalyse: 'catalyze',
  // -ence nouns
  defence: 'defense',
  offence: 'offense',
  licence: 'license',
  pretence: 'pretense',
  // others
  grey: 'gray',
  programme: 'program',
  cheque: 'check',
  judgement: 'judgment',
  acknowledgement: 'acknowledgment',
  artefact: 'artifact',
  aluminium: 'aluminum',
  jewellery: 'jewelry',
  sceptical: 'skeptical',
  manoeuvre: 'maneuver',
  cosy: 'cozy',
  mould: 'mold',
  enquiry: 'inquiry',
  enquire: 'inquire',
  ageing: 'aging',
  skilful: 'skillful',
  wilful: 'willful',
  practise: 'practice',
  tyre: 'tire',
  kerb: 'curb',
  plough: 'plow',
  doughnut: 'donut',
};

// Whole words (no inflection generated): past forms with doubled l and
// friends, and adverbs.
const WORDS = {
  whilst: 'while',
  amongst: 'among',
  learnt: 'learned',
  spelt: 'spelled',
  orientated: 'oriented',
  cancelled: 'canceled',
  cancelling: 'canceling',
  travelled: 'traveled',
  travelling: 'traveling',
  traveller: 'traveler',
  travellers: 'travelers',
  modelled: 'modeled',
  modelling: 'modeling',
  labelled: 'labeled',
  labelling: 'labeling',
  levelled: 'leveled',
  levelling: 'leveling',
  fuelled: 'fueled',
  fuelling: 'fueling',
  signalled: 'signaled',
  signalling: 'signaling',
  totalled: 'totaled',
  totalling: 'totaling',
  channelled: 'channeled',
  channelling: 'channeling',
  counsellor: 'counselor',
  counsellors: 'counselors',
  marvellous: 'marvelous',
  jewellers: 'jewelers',
  jeweller: 'jeweler',
  focussed: 'focused',
  focussing: 'focusing',
  benefitted: 'benefited',
  benefitting: 'benefiting',
  fulfil: 'fulfill',
  fulfils: 'fulfills',
  fulfilment: 'fulfillment',
  enrol: 'enroll',
  enrols: 'enrolls',
  enrolment: 'enrollment',
  instil: 'instill',
  distil: 'distill',
  instalment: 'installment',
  instalments: 'installments',
  dialled: 'dialed',
  dialling: 'dialing',
  pyjamas: 'pajamas',
};

function inflect(uk, us) {
  const out = { [uk]: us };
  const e = (a, b) => {
    out[a] = b;
  };
  if (/our$/.test(uk)) {
    for (const s of [
      's',
      'ed',
      'ing',
      'ful',
      'ite',
      'ites',
      'able',
      'less',
      'ist',
      'ists',
      'way',
      'ways',
      'ation',
      'hood',
      'hoods',
      'ly',
      'y',
    ]) {
      e(uk + s, us + s);
    }
    e(uk.replace(/our$/, 'ourer'), us.replace(/or$/, 'orer'));
    e('dis' + uk, 'dis' + us);
    e('re' + uk, 're' + us);
  } else if (/re$/.test(uk)) {
    const ukb = uk.slice(0, -2);
    const usb = us.slice(0, -2);
    for (const [a, b] of [
      ['re', 'er'],
      ['res', 'ers'],
      ['red', 'ered'],
      ['ring', 'ering'],
      ['repiece', 'erpiece'],
      ['repieces', 'erpieces'],
    ])
      e(ukb + a, usb + b);
    e('epi' + uk, 'epi' + us);
    e('centi' + uk, 'centi' + us);
    e('milli' + uk, 'milli' + us);
    e('kilo' + uk, 'kilo' + us);
  } else if (/ogue$/.test(uk)) {
    for (const s of ['s', 'd', 'r', 'rs'])
      e(
        uk + s,
        us + (s === 'd' ? 'ed' : s === 'r' ? 'er' : s === 'rs' ? 'ers' : s),
      );
    e(uk.replace(/ue$/, 'uing'), us + 'ing');
  } else if (/(ise|yse)$/.test(uk)) {
    const ukb = uk.slice(0, -1);
    const usb = us.slice(0, -1);
    // "analyses" and "paralyses" are also US plurals of the -ysis nouns.
    const suffixes = /yse$/.test(uk)
      ? ['e', 'ed', 'er', 'ers', 'ing']
      : ['e', 'es', 'ed', 'er', 'ers', 'ing', 'ation', 'ations', 'able'];
    for (const s of suffixes) e(ukb + s, usb + s);
    e(uk.replace(/ise$/, 'isation'), us.replace(/ize$/, 'ization'));
    e(uk.replace(/ise$/, 'isations'), us.replace(/ize$/, 'izations'));
    e('re' + uk, 're' + us);
    e('re' + ukb + 'ed', 're' + usb + 'ed');
    e('un' + ukb + 'ed', 'un' + usb + 'ed');
  } else if (/ence$/.test(uk)) {
    const ukb = uk.slice(0, -2);
    const usb = us.slice(0, -2);
    e(uk + 's', us + 's');
    if (uk === 'licence') {
      // The verb and the noun are both "license" in US English.
      e('licenced', 'licensed');
      e('unlicenced', 'unlicensed');
    }
    void ukb;
    void usb;
  } else {
    for (const s of ['s', 'd', 'ed', 'ing', 'er', 'ers', 'ly'])
      if (!out[uk + s]) e(uk + s, us + s);
    if (uk === 'grey') {
      e('greyish', 'grayish');
      e('greyscale', 'grayscale');
      e('greys', 'grays');
      e('greyed', 'grayed');
    }
    if (uk === 'practise') {
      e('practised', 'practiced');
      e('practising', 'practicing');
      e('practises', 'practices');
    }
    if (uk === 'programme') {
      e('programmes', 'programs');
    }
    if (uk === 'cheque') e('cheques', 'checks');
  }
  return out;
}

export const MAP = (() => {
  const map = {};
  for (const [uk, us] of Object.entries(STEMS)) {
    Object.assign(map, inflect(uk, us));
  }
  Object.assign(map, WORDS);
  // Inflection can produce a form that is already correct in both; drop it.
  for (const [uk, us] of Object.entries(map)) if (uk === us) delete map[uk];
  return map;
})();

const WORD = new RegExp(
  `(?<![\`'"\\w/._#@=])(${Object.keys(MAP)
    .sort((a, b) => b.length - a.length)
    .join('|')})(?![\`'"\\w/_#@=])`,
  'gi',
);

// Proper nouns that are spelled the UK way by their owners: a licence's
// official title is its name, not our prose.
export const PROPER_NOUNS = ['Ubuntu Font Licence'];
const PROTECTED = new RegExp(
  PROPER_NOUNS.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'g',
);

/** Offsets covered by a proper noun, which are never rewritten. */
function protectedSpans(text) {
  return [...text.matchAll(PROTECTED)].map((m) => [
    m.index,
    m.index + m[0].length,
  ]);
}

function inside(spans, at) {
  return spans.some(([a, b]) => at >= a && at < b);
}

function matchCase(source, target) {
  if (source === source.toUpperCase()) return target.toUpperCase();
  if (source[0] === source[0].toUpperCase())
    return target[0].toUpperCase() + target.slice(1);
  return target;
}

/** The text with every UK spelling in it made US. */
export function toUsEnglish(text) {
  const spans = protectedSpans(text);
  return text.replace(WORD, (word, _w, at) =>
    inside(spans, at) ? word : matchCase(word, MAP[word.toLowerCase()]),
  );
}

/** Every UK spelling in the text, as found. */
export function ukWords(text) {
  return text.match(WORD) ?? [];
}

// A string with no space in it is a value, key, slug, path, URL or name
// ('cancelled' is a run status stored in D1), never prose, unless it is
// one capitalized word: a label or message a person reads ('Cancelled',
// 'Cancelled.'). Codex review of internal PR 336 found both left unconverted.
const ONE_WORD_TEXT = /^[A-Z][a-z]+(-[a-z]+)*[.!?]?$/;
const notProse = (text) => /^\S*$/.test(text) && !ONE_WORD_TEXT.test(text);
// SQL, whose quoted values are data (`status = 'cancelled'`).
const SQL =
  /\b(SELECT|UPDATE|INSERT INTO|DELETE FROM|CREATE (TABLE|INDEX)|WHERE)\b/;
// JSX attributes read by code; every other attribute with a space in its
// value (lede, lead, eyebrow, title, alt, aria-label) is text a person reads.
const CODE_ATTRIBUTES = new Set([
  'className',
  'class',
  'style',
  'href',
  'src',
  'srcSet',
  'id',
  'key',
  'to',
  'rel',
  'type',
  'name',
  'role',
  'target',
  'as',
  'method',
  'action',
  'htmlFor',
  'd',
  'viewBox',
  'fill',
  'stroke',
  'transform',
  'points',
  'pattern',
  'accept',
  'autoComplete',
  'inputMode',
  'lang',
  'xmlns',
  'sizes',
  'media',
  'integrity',
  'crossOrigin',
  'referrerPolicy',
  'sandbox',
  'allow',
]);
const isCodeAttribute = (name) =>
  typeof name === 'string' &&
  (CODE_ATTRIBUTES.has(name) ||
    name.startsWith('data-') ||
    name.startsWith('aria-hidden') ||
    /^aria-(controls|labelledby|describedby|owns|activedescendant)$/.test(
      name,
    ));

let babel;
function parseScript(source, file) {
  babel ??= createRequire(join(ROOT, 'packages/ai/package.json'))(
    '@babel/parser',
  );
  return babel.parse(source, {
    sourceType: 'module',
    errorRecovery: true,
    plugins: ['typescript', ...(file.endsWith('x') ? ['jsx'] : [])],
  });
}

const SKIP_PARENTS = new Set([
  'ImportDeclaration',
  'ExportNamedDeclaration',
  'ExportAllDeclaration',
  'TSLiteralType',
  'TSExternalModuleReference',
  'TSEnumMember',
]);

/** [start, end] of each piece of a script that people read. */
function scriptRanges(source, file) {
  const ast = parseScript(source, file);
  const ranges = [];
  const visit = (node, parent, key) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'StringLiteral') {
      const isKey =
        [
          'ObjectProperty',
          'TSPropertySignature',
          'ClassProperty',
          'ObjectMethod',
        ].includes(parent?.type) && key === 'key';
      const isMember =
        parent?.type === 'MemberExpression' && key === 'property';
      const isComparedOrCased =
        parent?.type === 'BinaryExpression' || parent?.type === 'SwitchCase';
      const isAttribute =
        parent?.type === 'JSXAttribute' && isCodeAttribute(parent.name?.name);
      if (
        !isKey &&
        !isMember &&
        !isComparedOrCased &&
        !isAttribute &&
        !SKIP_PARENTS.has(parent?.type) &&
        !notProse(node.value) &&
        !SQL.test(node.value)
      ) {
        ranges.push([node.start + 1, node.end - 1]);
      }
      return;
    }
    if (node.type === 'TemplateLiteral') {
      const text = node.quasis.map((q) => q.value.raw).join('');
      if (!SQL.test(text) && !notProse(text)) {
        for (const q of node.quasis) ranges.push([q.start, q.end]);
      }
      for (const e of node.expressions) visit(e, node, 'expressions');
      return;
    }
    if (node.type === 'JSXText') {
      ranges.push([node.start, node.end]);
      return;
    }
    for (const [k, child] of Object.entries(node)) {
      if (k === 'loc' || k === 'comments' || k.endsWith('Comments')) continue;
      if (Array.isArray(child)) for (const c of child) visit(c, node, k);
      else if (child && typeof child === 'object') visit(child, node, k);
    }
  };
  visit(ast.program, null, null);
  return ranges;
}

/** [start, end] of prose in Markdown: not code, not link targets. */
function markdownRanges(source) {
  const ranges = [];
  let offset = 0;
  let fenced = false;
  for (const line of source.split(/(?<=\n)/)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced) {
      // Split around inline code, link targets, bare URLs and HTML tags.
      const skip = /`[^`]*`|\]\([^)]*\)|<[^>]+>|https?:\/\/\S+|\{#[^}]*\}/g;
      let last = 0;
      for (const m of line.matchAll(skip)) {
        ranges.push([offset + last, offset + m.index]);
        last = m.index + m[0].length;
      }
      ranges.push([offset + last, offset + line.length]);
    }
    offset += line.length;
  }
  return ranges;
}

/** [start, end] of HTML text: outside tags, <style> and <script>. */
function htmlRanges(source) {
  const ranges = [];
  const skip = /<(style|script)\b[\s\S]*?<\/\1>|<[^>]*>/gi;
  let last = 0;
  for (const m of source.matchAll(skip)) {
    ranges.push([last, m.index]);
    last = m.index + m[0].length;
  }
  ranges.push([last, source.length]);
  return ranges;
}

/** The pieces of a file that people read, by its kind. */
export function readableRanges(source, file) {
  if (/\.(ts|tsx|mjs|js)$/.test(file)) return scriptRanges(source, file);
  if (/\.md$/.test(file)) return markdownRanges(source);
  if (/\.html$/.test(file)) return htmlRanges(source);
  return [[0, source.length]];
}

/** The file's text with its readable parts made US English. */
export function convert(source, file) {
  const ranges = readableRanges(source, file).sort((a, b) => a[0] - b[0]);
  const pieces = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start < at) continue;
    pieces.push(source.slice(at, start), toUsEnglish(source.slice(start, end)));
    at = end;
  }
  pieces.push(source.slice(at));
  return pieces.join('');
}

/** Each UK spelling a reader would see, with its line. */
export function findings(source, file) {
  const found = [];
  const starts = [0];
  for (let i = source.indexOf('\n'); i !== -1; i = source.indexOf('\n', i + 1))
    starts.push(i + 1);
  const lineOf = (at) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= at) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  for (const [start, end] of readableRanges(source, file)) {
    const piece = source.slice(start, end);
    const spans = protectedSpans(piece);
    for (const m of piece.matchAll(WORD)) {
      if (inside(spans, m.index)) continue;
      const at = start + m.index;
      const line = lineOf(at);
      found.push({
        line,
        word: m[0],
        us: matchCase(m[0], MAP[m[0].toLowerCase()]),
      });
    }
  }
  return found;
}

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(
      (f) =>
        f && INCLUDE.some((r) => r.test(f)) && !EXCLUDE.some((r) => r.test(f)),
    );
}

function main(args) {
  const fix = args.includes('--fix');
  let total = 0;
  const files = trackedFiles();
  for (const file of files) {
    const path = join(ROOT, file);
    const source = readFileSync(path, 'utf8');
    const found = findings(source, file);
    if (found.length === 0) continue;
    total += found.length;
    if (fix) writeFileSync(path, convert(source, file));
    else
      for (const f of found)
        console.log(`${relative(ROOT, path)}:${f.line}: ${f.word} -> ${f.us}`);
  }
  if (fix) {
    console.log(
      `Rewrote ${total} UK spellings in ${files.length} files checked.`,
    );
  } else if (total > 0) {
    console.error(
      `\n${total} UK spellings where people read them. vibld is written in US English (D120). Run: node scripts/us-english.mjs --fix`,
    );
    process.exit(1);
  } else {
    console.log(`US English in ${files.length} files.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
