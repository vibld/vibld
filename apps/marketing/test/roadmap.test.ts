import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STYLE_PRESETS } from '@vibld/ai/style-presets';

import {
  ROADMAP_GROUPS,
  ROADMAP_ITEMS,
  VOTABLE_IDS,
  isVotable,
  itemsIn,
} from '../app/roadmap.ts';
import {
  EMPTY_TALLY,
  ROADMAP_TURNSTILE_ACTION,
  errorOf,
  failureMessage,
  readVotesPayload,
  restored,
  settled,
  snapshotOf,
  tallyFrom,
  toggled,
  voteLabel,
} from '../app/roadmap-votes.ts';
import {
  PRODUCT_PAGES,
  ROUTE_PATHS,
  SITE,
  metaFor,
  routeFor,
} from '../app/site.ts';
import {
  isTurnstileVerified,
  WAITLIST_TURNSTILE_ACTION,
} from '../worker/waitlist.ts';

/**
 * The roadmap's data file and the page's side of voting, with no Worker and
 * no browser. The Worker and the database are in roadmap-api.test.ts; the
 * built page is in prerender.test.ts.
 */

describe('the roadmap data', () => {
  it('gives every item a unique id', () => {
    // Votes are stored under the id, so two items sharing one would share
    // their votes, and neither count would mean anything.
    const ids = ROADMAP_ITEMS.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('keeps ids to one plain shape', () => {
    // An id reaches the database from a request body, so it is worth being
    // sure none of the real ones needs quoting or could be mistaken for
    // another after trimming or case-folding.
    for (const item of ROADMAP_ITEMS) {
      assert.match(item.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, item.id);
      assert.ok(item.id.length <= 40, item.id);
    }
  });

  it('lets every item that has not shipped be voted for', () => {
    for (const item of ROADMAP_ITEMS) {
      assert.equal(isVotable(item), item.status !== 'shipped', item.id);
    }
    assert.deepEqual(
      [...VOTABLE_IDS],
      ROADMAP_ITEMS.filter((item) => item.status !== 'shipped').map(
        (item) => item.id,
      ),
    );
  });

  it('puts every item in a group the page draws, and draws no empty group', () => {
    const statuses = ROADMAP_GROUPS.map((group) => group.status);
    assert.equal(new Set(statuses).size, statuses.length);
    for (const item of ROADMAP_ITEMS) {
      assert.ok(statuses.includes(item.status), `${item.id} has no group`);
    }
    for (const group of ROADMAP_GROUPS) {
      assert.ok(itemsIn(group.status).length > 0, `${group.status} is empty`);
    }
  });

  it('uses the grouping Chris set on 2026-09-27, exactly', () => {
    const titles = (status: string) =>
      ROADMAP_ITEMS.filter((item) => item.status === status).map(
        (item) => item.title,
      );
    assert.deepEqual(titles('in-progress'), [
      'Public beta',
      'Modern component stack',
    ]);
    assert.deepEqual(titles('upcoming'), [
      'Checkpoint history and rollback',
      'Custom domains',
      'Screenshot and image import',
      'Template gallery',
    ]);
    assert.deepEqual(titles('considering'), [
      'Figma import',
      'GitHub repository import',
      'Authentication for your app’s users',
      'Forms and email capture',
      'Payments in your app',
      'Blog and editable content',
      'Bring your own model key',
      'Comments on shared previews',
      'Command-line sync',
    ]);
    assert.deepEqual(titles('shipped'), [
      'Sandbox previews with share links',
      'One-step publishing',
      'GitHub pull requests',
      '24 style presets',
      'Build from a reference URL',
      'Projects',
      'Project links and remix',
      'Chat before building',
      'Draft preview',
      'Media uploads',
      'Style moods and suggestions',
      'Animated backgrounds',
      'Build-and-repair reliability',
    ]);
  });

  it('describes each item in one sentence', () => {
    for (const item of ROADMAP_ITEMS) {
      assert.match(item.description, /\.$/, item.id);
      assert.doesNotMatch(item.description, /\.\s/, `${item.id} has two`);
    }
  });

  it('counts the style presets the builder actually has', () => {
    // The one number in the list. A preset added to the builder without this
    // changing would make a shipped claim false by understating it.
    const item = ROADMAP_ITEMS.find((each) => each.id === 'style-presets');
    assert.equal(item?.title, `${STYLE_PRESETS.length} style presets`);
  });
});

describe('the /roadmap route', () => {
  it('is declared, so it is prerendered and put in the sitemap', () => {
    // react-router.config.ts prerenders ROUTE_PATHS and postbuild.ts writes
    // the sitemap from ROUTES; prerender.test.ts checks both in the build.
    assert.ok(ROUTE_PATHS.includes('/roadmap'));
    assert.equal(routeFor('/roadmap').path, '/roadmap');
  });

  it('has meta that names the site and points at itself', () => {
    const meta = metaFor('/roadmap') as unknown as Record<string, string>[];
    const title = meta.find((tag) => 'title' in tag)?.title ?? '';
    assert.ok(title.includes(SITE.name), title);
    const canonical = meta.find((tag) => tag.rel === 'canonical');
    assert.equal(canonical?.href, new URL('/roadmap', SITE.url).toString());
    const description = meta.find((tag) => tag.name === 'description');
    assert.ok((description?.content ?? '').length > 0);
  });

  it('is in the navigation and the footer', () => {
    // Both draw from PRODUCT_PAGES (SiteChrome.tsx).
    assert.ok(PRODUCT_PAGES.some((page) => page.path === '/roadmap'));
  });
});

describe('the page’s tally', () => {
  const loaded = tallyFrom({
    counts: { 'figma-import': 12, 'cli-sync': 0 },
    voted: ['cli-sync'],
    verified: true,
  });

  it('adds a vote at once, before the Worker answers', () => {
    const next = toggled(loaded, 'figma-import');
    assert.ok(next.voted.has('figma-import'));
    assert.equal(next.counts?.['figma-import'], 13);
    // The input is left alone, so a failed vote has something to go back to.
    assert.ok(!loaded.voted.has('figma-import'));
  });

  it('takes a vote back on the second press', () => {
    const next = toggled(loaded, 'cli-sync');
    assert.ok(!next.voted.has('cli-sync'));
    assert.equal(next.counts?.['cli-sync'], 0);
  });

  it('never shows a count below zero', () => {
    const stale = tallyFrom({
      counts: { 'cli-sync': 0 },
      voted: ['cli-sync'],
      verified: true,
    });
    assert.equal(toggled(stale, 'cli-sync').counts?.['cli-sync'], 0);
  });

  it('flips the button without inventing a count it never had', () => {
    const next = toggled(EMPTY_TALLY, 'figma-import');
    assert.ok(next.voted.has('figma-import'));
    assert.equal(next.counts, null);
  });

  it('replaces its guess with what the Worker says', () => {
    const guessed = toggled(loaded, 'figma-import');
    const next = settled(guessed, {
      id: 'figma-import',
      voted: true,
      count: 20,
    });
    assert.equal(next.counts?.['figma-import'], 20);
    assert.ok(next.voted.has('figma-import'));
    assert.equal(next.verified, true);
  });

  it('puts a failed vote back exactly as it was', () => {
    const before = snapshotOf(loaded, 'figma-import');
    const guessed = toggled(loaded, 'figma-import');
    const back = restored(guessed, 'figma-import', before);
    assert.equal(back.counts?.['figma-import'], 12);
    assert.ok(!back.voted.has('figma-import'));
  });

  it('reads only a well-formed GET body', () => {
    assert.equal(readVotesPayload(null), null);
    assert.equal(readVotesPayload({ counts: {}, voted: 'x' }), null);
    assert.equal(
      readVotesPayload({ counts: {}, voted: [], verified: 'yes' }),
      null,
    );
    assert.deepEqual(
      readVotesPayload({
        counts: { a: 1, b: -1, c: 'x' },
        voted: ['a', 2],
        verified: false,
      }),
      { counts: { a: 1 }, voted: ['a'], verified: false },
    );
  });
});

describe('what a vote button is called', () => {
  it('names the item and the count it shows', () => {
    assert.equal(
      voteLabel('Figma import', 12),
      'Vote for Figma import, 12 votes',
    );
    assert.equal(voteLabel('Figma import', 1), 'Vote for Figma import, 1 vote');
    assert.equal(
      voteLabel('Figma import', 0),
      'Vote for Figma import, 0 votes',
    );
  });

  it('names the item alone before there is a count', () => {
    assert.equal(voteLabel('Figma import', undefined), 'Vote for Figma import');
  });
});

describe('what a failed vote says', () => {
  it('reads a known error code and nothing else', () => {
    assert.equal(errorOf({ error: 'rate-limited' }), 'rate-limited');
    assert.equal(errorOf({ error: 'made-up' }), null);
    assert.equal(errorOf('rate-limited'), null);
    assert.equal(errorOf(null), null);
  });

  it('gives each a message, and a general one for the rest', () => {
    assert.match(failureMessage('rate-limited'), /Too many votes/);
    assert.match(failureMessage('check-failed'), /did not pass/);
    assert.match(failureMessage('check-unavailable'), /could not run/);
    assert.match(failureMessage('unavailable'), /unavailable/);
    assert.match(failureMessage(null), /did not go through/);
  });
});

describe('the Turnstile action', () => {
  it('keeps a vote token and a waitlist token apart', () => {
    // One site key serves both widgets, so the action is what stops a token
    // solved for one being spent on the other.
    const vote = {
      success: true,
      action: ROADMAP_TURNSTILE_ACTION,
      hostname: 'vibld.com',
    };
    assert.equal(isTurnstileVerified(vote, ROADMAP_TURNSTILE_ACTION), true);
    assert.equal(isTurnstileVerified(vote), false);
    const signup = { ...vote, action: WAITLIST_TURNSTILE_ACTION };
    assert.equal(isTurnstileVerified(signup), true);
    assert.equal(isTurnstileVerified(signup, ROADMAP_TURNSTILE_ACTION), false);
  });
});
