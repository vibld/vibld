// Reads a Workers Observability query's response and prints the events in
// it, for .github/workflows/worker-logs.yml.
//
//   node scripts/worker-logs.mjs body <from> <to> <service> [match]
//   node scripts/worker-logs.mjs print <response.json>
//
// A line logged as JSON (generation.step) or as a name and a JSON string
// (preview.step, preview.updated) is kept by Workers Logs as fields under
// `source`, not as `$metadata.message`, so a match against the message
// alone never found it. The match is sent as the query's `needle`, which
// Cloudflare applies to every field before its row limit, and each event's
// own fields are printed beside the request's. Events that carry a step
// and a duration are summed up per step at the end.
//
// Only fields about the request, the error and what our code logged are
// printed. Never headers or bodies, which is where a token or a person's
// text would be: those keys are dropped wherever they appear.

import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SECRET_KEYS =
  /^(headers?|body|request|response|authorization|cookies?|token)$/i;

/** The query body: one service, a time window, and the match if any. */
export function queryBody({ from, to, service, match = '', limit = 2000 }) {
  return {
    queryId: 'worker-logs',
    timeframe: { from, to },
    view: 'events',
    limit,
    parameters: {
      datasets: ['cloudflare-workers'],
      filters: [
        {
          key: '$metadata.service',
          operation: 'eq',
          type: 'string',
          value: service,
        },
      ],
      ...(match
        ? { needle: { value: match, isRegex: false, matchCase: true } }
        : {}),
    },
  };
}

/** A copy of `value` without any key that could hold a header or a body. */
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    if (!SECRET_KEYS.test(key)) out[key] = redact(inner);
  }
  return out;
}

function parseLogged(text) {
  const trimmed = text.trim();
  // `console.log(JSON.stringify({ event, ... }))`
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
  }
  // `console.log('preview.step', JSON.stringify({ step, ms }))`
  const named = /^([\w.-]+)\s+(\{[\s\S]*\})$/.exec(trimmed);
  if (named) {
    try {
      const parsed = JSON.parse(named[2]);
      if (parsed && typeof parsed === 'object')
        return { event: named[1], ...parsed };
    } catch {}
  }
  return null;
}

/**
 * What our code logged on this event, as fields, or null when it logged
 * plain text (or nothing: a request's own event).
 */
export function fieldsOf(event) {
  const source = event?.source;
  if (typeof source === 'string') return parseLogged(source);
  if (source && typeof source === 'object') {
    const { message, ...rest } = source;
    if (Object.keys(rest).length > 0) {
      const fromMessage =
        typeof message === 'string' ? parseLogged(message) : null;
      return { ...(fromMessage ?? {}), ...rest };
    }
    if (Array.isArray(message)) {
      return parseLogged(
        message
          .map((part) =>
            typeof part === 'string' ? part : JSON.stringify(part),
          )
          .join(' '),
      );
    }
    if (typeof message === 'string') return parseLogged(message);
  }
  const text = event?.$metadata?.message;
  return typeof text === 'string' ? parseLogged(text) : null;
}

function isProblem(event) {
  const meta = event.$metadata ?? {};
  return (
    (meta.error ?? '') !== '' ||
    /error|warn/i.test(meta.level ?? '') ||
    (meta.statusCode ?? 0) >= 500 ||
    (event.$workers?.outcome ?? 'ok') !== 'ok'
  );
}

function matches(event, match) {
  if (!match) return true;
  const meta = event.$metadata ?? {};
  // The needle already chose these server-side; this keeps a response
  // read without one (or a needle that ignored a field) to the same rule.
  return (
    (meta.message ?? '').includes(match) ||
    (meta.error ?? '').includes(match) ||
    JSON.stringify(event.source ?? '').includes(match)
  );
}

/** The events to print, oldest first. */
export function selectEvents(events, { errorsOnly, match }) {
  return [...events]
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter((event) => matches(event, match))
    .filter((event) => !errorsOnly || isProblem(event));
}

/** One line per event, `|`-separated. */
export function formatEvent(event) {
  const meta = event.$metadata ?? {};
  const fields = fieldsOf(event);
  return [
    new Date(event.timestamp).toISOString(),
    String(meta.statusCode ?? '-'),
    event.$workers?.outcome ?? '-',
    meta.level ?? '-',
    (meta.url ?? '').replace(/\?.*$/, ''),
    (meta.error ?? '').slice(0, 400),
    fields ? '' : (meta.message ?? '').slice(0, 400),
    fields ? JSON.stringify(redact(fields)).slice(0, 600) : '',
  ].join(' | ');
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

/**
 * Per step, how long it took: every event whose fields carry a numeric
 * `ms`, grouped by its event name and step (`step`, or `name` for a
 * generation step, with the group's number folded so group 1 and group 7
 * sum together).
 */
export function stepSummary(events) {
  const groups = new Map();
  for (const event of events) {
    const fields = fieldsOf(event);
    if (!fields || typeof fields.ms !== 'number') continue;
    const label = fields.step ?? fields.name;
    const key = [
      fields.event ?? '-',
      typeof label === 'string' ? label.replace(/\d+/g, 'N') : '-',
    ];
    const id = key.join('\u0000');
    const group = groups.get(id) ?? { event: key[0], step: key[1], ms: [] };
    group.ms.push(fields.ms);
    groups.set(id, group);
  }
  return [...groups.values()]
    .map(({ event, step, ms }) => {
      const sorted = [...ms].sort((a, b) => a - b);
      return {
        event,
        step,
        n: sorted.length,
        median: percentile(sorted, 0.5),
        p90: percentile(sorted, 0.9),
        max: sorted[sorted.length - 1],
      };
    })
    .sort((a, b) => a.event.localeCompare(b.event) || b.median - a.median);
}

export function summaryTable(rows) {
  if (rows.length === 0) return '';
  return [
    '| Event | Step | Count | Median ms | p90 ms | Max ms |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...rows.map(
      (r) =>
        `| \`${r.event}\` | \`${r.step}\` | ${r.n} | ${r.median} | ${r.p90} | ${r.max} |`,
    ),
  ].join('\n');
}

function main([command, ...args]) {
  if (command === 'body') {
    const [from, to, service, match = ''] = args;
    process.stdout.write(
      JSON.stringify(
        queryBody({ from: Number(from), to: Number(to), service, match }),
      ),
    );
    return;
  }
  if (command === 'print') {
    const response = JSON.parse(readFileSync(args[0], 'utf8'));
    const events = response.result?.events?.events ?? [];
    const count = response.result?.events?.count;
    console.log(
      `Events returned: ${events.length}${typeof count === 'number' ? ` of ${count} matching` : ''}`,
    );
    const match = process.env.MATCH ?? '';
    const errorsOnly = process.env.ERRORS_ONLY === 'true';
    for (const event of selectEvents(events, { errorsOnly, match })) {
      console.log(formatEvent(event));
    }
    // Timings are read from every matching event, not only the problems.
    const table = summaryTable(
      stepSummary(selectEvents(events, { errorsOnly: false, match })),
    );
    if (table) {
      console.log(`\n${table}`);
      if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(
          process.env.GITHUB_STEP_SUMMARY,
          `### Step timings\n\n${table}\n`,
        );
      }
    }
    return;
  }
  console.error(
    'usage: worker-logs.mjs body <from> <to> <service> [match] | print <response.json>',
  );
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2));
}
