import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SHARE_COOKIE,
  answerShare,
  readGrant,
  shareIdFromHost,
  shareLink,
  withoutGrantCookie,
} from '../worker/share-route.ts';
import { signShare } from '../worker/share-token.ts';

/**
 * A share link redeemed on its own origin into a cookie, so the shared
 * app's absolute paths (`/src/main.tsx`, `/media/hero.jpg`) reach the
 * preview without credentials in their URLs (internal issue 222).
 */

const SECRET = 'share-secret';
const HOST = 'vibld-preview.dev';
const SHARE = '3f2a9c1e-0b7d-4e6a-9c52-1d8e7f604ab3';
const OTHER = '9d1c0b2a-7e6f-4a5b-8c3d-2e1f0a9b8c7d';
const NOW = 1_800_000_000_000;
const EXP = NOW + 3_600_000;

async function redeemed(shareId = SHARE, expiresAt = EXP) {
  const link = new URL(
    shareLink(
      HOST,
      'user_2Ab',
      shareId,
      expiresAt,
      await signShare(SECRET, shareId, expiresAt),
    ),
  );
  return answerShare(link, null, shareId, SECRET, NOW);
}

function cookieFrom(setCookie: string): string {
  return setCookie.split(';')[0]!;
}

describe('a share host', () => {
  it('is its own origin, named by the share id', () => {
    assert.equal(shareIdFromHost(`sh-${SHARE}.${HOST}`, HOST), SHARE);
    // Not the older single share host, not a preview, not another domain.
    assert.equal(shareIdFromHost(`share.${HOST}`, HOST), undefined);
    assert.equal(shareIdFromHost(`8080-user-abc-tok.${HOST}`, HOST), undefined);
    assert.equal(shareIdFromHost(`sh-${SHARE}.evil.example`, HOST), undefined);
    assert.equal(shareIdFromHost(`sh-${SHARE}.x.${HOST}`, HOST), undefined);
    // Exactly the preview domain's length of something else after the id.
    assert.equal(
      shareIdFromHost(`sh-${SHARE}${'.'.padEnd(HOST.length + 1, 'x')}`, HOST),
      undefined,
    );
    assert.equal(shareIdFromHost(`sh-${SHARE}.${HOST}`, undefined), undefined);
  });

  it('hands the link out on that origin', async () => {
    const link = new URL(
      shareLink(
        HOST,
        'user_2Ab',
        SHARE,
        EXP,
        await signShare(SECRET, SHARE, EXP),
      ),
    );
    assert.equal(link.hostname, `sh-${SHARE}.${HOST}`);
    assert.equal(link.pathname, '/__vibld/share');
    assert.equal(link.searchParams.get('s'), 'user_2Ab');
  });
});

describe('redeeming a link', () => {
  it('sets a host-only cookie holding the grant and sends the viewer to /', async () => {
    const answer = await redeemed();
    assert.equal(answer.kind, 'redeem');
    if (answer.kind !== 'redeem') return;
    assert.equal(answer.location, '/');
    assert.match(answer.setCookie, /^__Host-vibld_share=/);
    assert.match(answer.setCookie, /; Path=\//);
    assert.match(answer.setCookie, /; Secure/);
    assert.match(answer.setCookie, /; HttpOnly/);
    assert.doesNotMatch(answer.setCookie, /Domain=/i);
    assert.match(answer.setCookie, /Max-Age=3600;/);
  });

  it('refuses a link that is forged, altered, expired or for another share', async () => {
    const good = new URL(
      shareLink(
        HOST,
        'user_2Ab',
        SHARE,
        EXP,
        await signShare(SECRET, SHARE, EXP),
      ),
    );
    const later = new URL(good);
    later.searchParams.set('exp', String(EXP + 1));
    assert.equal(
      (await answerShare(later, null, SHARE, SECRET, NOW)).kind,
      'deny',
    );
    // The same signature, redeemed on another share's host.
    assert.equal(
      (await answerShare(good, null, OTHER, SECRET, NOW)).kind,
      'deny',
    );
    const expired = await redeemed(SHARE, NOW - 1);
    assert.deepEqual(expired, {
      kind: 'deny',
      status: 403,
      message: 'This share link has expired.',
    });
    const bare = new URL(`https://sh-${SHARE}.${HOST}/__vibld/share`);
    assert.equal(
      (await answerShare(bare, null, SHARE, SECRET, NOW)).kind,
      'deny',
    );
  });
});

describe('a request after redemption', () => {
  it("serves any of the app's absolute paths from the grant's preview", async () => {
    const answer = await redeemed();
    assert.equal(answer.kind, 'redeem');
    if (answer.kind !== 'redeem') return;
    const cookie = `theme=dark; ${cookieFrom(answer.setCookie)}`;
    for (const path of [
      '/',
      '/src/main.tsx',
      '/@vite/client',
      '/media/hero.jpg',
    ]) {
      const url = new URL(`https://sh-${SHARE}.${HOST}${path}`);
      assert.deepEqual(await answerShare(url, cookie, SHARE, SECRET, NOW), {
        kind: 'proxy',
        sandboxId: 'user_2Ab',
        shareId: SHARE,
      });
    }
  });

  it('refuses without the cookie, and says how to get it', async () => {
    const url = new URL(`https://sh-${SHARE}.${HOST}/src/main.tsx`);
    assert.deepEqual(await answerShare(url, 'theme=dark', SHARE, SECRET, NOW), {
      kind: 'deny',
      status: 403,
      message: 'Open the share link again to view this preview.',
    });
  });

  it('refuses a cookie edited to another sandbox, a later expiry, or another share', async () => {
    const answer = await redeemed();
    if (answer.kind !== 'redeem') throw new Error('not redeemed');
    const value = cookieFrom(answer.setCookie).slice(`${SHARE_COOKIE}=`.length);
    const [, exp, sig] = value.split('~');
    const url = new URL(`https://sh-${SHARE}.${HOST}/`);
    for (const forged of [
      `user_other~${exp}~${sig}`,
      `user_2Ab~${Number(exp) + 60_000}~${sig}`,
    ]) {
      const result = await answerShare(
        url,
        `${SHARE_COOKIE}=${forged}`,
        SHARE,
        SECRET,
        NOW,
      );
      // The sandbox id is not signed; the share id and expiry are. A cookie
      // naming another sandbox reaches that sandbox's own share table,
      // which does not hold this share, so `proxyShared` refuses it there.
      if (forged.startsWith('user_other')) {
        assert.deepEqual(result, {
          kind: 'proxy',
          sandboxId: 'user_other',
          shareId: SHARE,
        });
      } else {
        assert.equal(result.kind, 'deny', forged);
      }
    }
    // A valid cookie for this share, sent to another share's host.
    assert.equal(
      (await answerShare(url, cookieFrom(answer.setCookie), OTHER, SECRET, NOW))
        .kind,
      'deny',
    );
    // Past its expiry.
    assert.equal(
      (
        await answerShare(
          url,
          cookieFrom(answer.setCookie),
          SHARE,
          SECRET,
          EXP + 1,
        )
      ).kind,
      'deny',
    );
  });
});

describe('the cookie', () => {
  it('reads back a sandbox id with any characters', () => {
    assert.deepEqual(
      readGrant(`${SHARE_COOKIE}=${encodeURIComponent('a~b c')}~5~sig`),
      {
        sandboxId: 'a~b c',
        expiresAt: 5,
        signature: 'sig',
      },
    );
    assert.equal(readGrant(`${SHARE_COOKIE}=broken`), undefined);
    assert.equal(readGrant(null), undefined);
  });

  it('is taken out before the request reaches the app', () => {
    assert.equal(
      withoutGrantCookie(`a=1; ${SHARE_COOKIE}=x~1~s; b=2`),
      'a=1; b=2',
    );
    assert.equal(withoutGrantCookie(`${SHARE_COOKIE}=x~1~s`), null);
    assert.equal(withoutGrantCookie(null), null);
  });
});

describe('share links on this machine under Docker (D126)', () => {
  it('are plain HTTP on the preview port, and read back with it', () => {
    const id = '0123abcd-4567-89ab-cdef-0123456789ab';
    const link = new URL(shareLink('localhost:8788', 'sandbox', id, 1, 'sig'));
    assert.equal(link.protocol, 'http:');
    assert.equal(link.host, `sh-${id}.localhost:8788`);
    assert.equal(shareIdFromHost(link.host, 'localhost:8788'), id);
    assert.equal(
      new URL(shareLink('vibld-preview.dev', 'sandbox', id, 1, 'sig')).protocol,
      'https:',
    );
  });
});
