/**
 * First-party, cookieless analytics.
 *
 * Cloudflare Web Analytics was the obvious choice and does not work here: its
 * automatic mode injects a beacon by rewriting HTML at the edge, which does
 * not happen for a Worker serving its own static assets, and the manual
 * snippet's token is not exposed for an automatically-configured site.
 *
 * Writing our own has turned out better for the question that actually
 * matters -- which channel produced a waitlist signup -- because the pageview
 * and the signup land in the same dataset and can be joined. Nothing here
 * identifies a person: no cookie, no client ID, no IP address, no full URL
 * with its query string. Only the fields below are stored.
 */

/** The shape Workers Analytics Engine expects. Declared locally so this file stays runtime-free and testable. */
export interface AnalyticsDataset {
  writeDataPoint(point: {
    blobs?: (string | null)[];
    doubles?: number[];
    indexes?: string[];
  }): void;
}

export type EventKind = 'pageview' | 'signup';

/** Cap on any single stored value. Analytics Engine limits total blob bytes; this keeps one long field from evicting the rest. */
const MAX_FIELD = 96;

/**
 * Referrers are stored as a bare hostname, never the full referring URL --
 * a full URL can carry a session token or a private path in its query string,
 * and the hostname is all that channel attribution needs.
 *
 * Returns 'direct' when there is no referrer, and 'self' for our own pages so
 * internal navigation does not read as a referral.
 */
export function referrerHost(referrer: string, selfHost: string): string {
  if (!referrer) return 'direct';
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '');
    return host === selfHost.replace(/^www\./, '') ? 'self' : host;
  } catch {
    return 'direct';
  }
}

/** Keeps a stored value short, single-line and free of control characters. */
export function clean(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_FIELD);
}

/**
 * Only the path is kept, never the query string: UTM parameters are extracted
 * into their own fields and everything else in a query string is potentially
 * private.
 */
export function pathOf(rawUrl: string): string {
  try {
    return clean(new URL(rawUrl).pathname) || '/';
  } catch {
    return '/';
  }
}

export interface Attribution {
  referrer: string;
  source: string;
  medium: string;
  campaign: string;
}

/** Pulls channel attribution out of a URL's UTM parameters and its referrer. */
export function attributionFrom(
  rawUrl: string,
  referrer: string,
  selfHost: string,
): Attribution {
  let params = new URLSearchParams();
  try {
    params = new URL(rawUrl).searchParams;
  } catch {
    /* fall through to empty attribution */
  }
  return {
    referrer: referrerHost(referrer, selfHost),
    source: clean(params.get('utm_source')),
    medium: clean(params.get('utm_medium')),
    campaign: clean(params.get('utm_campaign')),
  };
}

/**
 * Builds the datapoint. Returned rather than written so the shape is testable
 * without a Workers runtime -- the same reasoning as `resendContactRequest`
 * in waitlist.ts.
 *
 * `indexes` takes the event kind because Analytics Engine allows exactly one
 * index and sampling is applied per index: keeping pageviews and signups in
 * separate buckets means a burst of pageviews can never cause signups -- the
 * rarer and far more valuable event -- to be sampled away.
 */
export function dataPointFor(
  kind: EventKind,
  attribution: Attribution,
  path: string,
  country: string,
) {
  return {
    indexes: [kind],
    blobs: [
      kind,
      path,
      attribution.referrer,
      attribution.source,
      attribution.medium,
      attribution.campaign,
      clean(country),
    ],
    doubles: [1],
  };
}

/**
 * Records an event, never letting analytics break the request it rode in on:
 * a missing binding or a throwing write is logged and swallowed. Losing a
 * datapoint is acceptable; losing a waitlist signup is not.
 */
export function record(
  dataset: AnalyticsDataset | undefined,
  kind: EventKind,
  request: Request,
  attribution: Attribution,
  path: string,
): void {
  if (!dataset) return;
  try {
    const country = request.headers.get('cf-ipcountry') ?? '';
    dataset.writeDataPoint(dataPointFor(kind, attribution, path, country));
  } catch (error) {
    console.error('analytics write failed', error);
  }
}
