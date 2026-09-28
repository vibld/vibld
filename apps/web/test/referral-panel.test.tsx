import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import { ReferralPanel } from '../src/components/ReferralPanel.tsx';
import type { ReferralStatus } from '../src/referral/referral-client.ts';

/**
 * "Refer a friend", rendered, in each state it can be in.
 *
 * The sentences themselves are pinned in `referral-client.test.ts`; this is
 * the wiring: what is on screen for a given status, what Copy does when the
 * clipboard works and when it does not, and that nothing from the status is
 * ever parsed as markup.
 */

function status(over: Partial<ReferralStatus> = {}): ReferralStatus {
  return {
    code: 'ABCD2345',
    url: 'https://app.vibld.com/?ref=ABCD2345',
    referred: 0,
    paid: 0,
    earnedCents: 0,
    rewardCents: { referrer: 500, referred: 500 },
    maxPaidReferrals: 25,
    ...over,
  };
}

async function mount(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });
  return {
    container,
    text: () => container.textContent ?? '',
    field: () => container.querySelector('input')!,
    button: () => container.querySelector('button')!,
    alert: () => container.querySelector('[role="alert"]'),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('the referral panel, rendered', () => {
  it('shows the link, what both sides get, and no progress yet', async () => {
    const view = await mount(<ReferralPanel status={status()} />);
    assert.equal(view.field().value, 'https://app.vibld.com/?ref=ABCD2345');
    assert.equal(view.field().readOnly, true);
    assert.match(view.text(), /you each get \$5 of build credit/);
    assert.match(view.text(), /for up to 25 friends/);
    assert.match(view.text(), /Nobody has signed up with your link yet\./);
    assert.equal(view.button().textContent, 'Copy');
    assert.equal(view.alert(), null);
    // The field is labelled for a screen reader, not only by position.
    const label = view.container.querySelector('label');
    assert.equal(label?.getAttribute('for'), view.field().id);
    view.unmount();
  });

  it('shows progress and what has been earned', async () => {
    const view = await mount(
      <ReferralPanel
        status={status({ referred: 3, paid: 2, earnedCents: 1000 })}
      />,
    );
    assert.match(
      view.text(),
      /3 friends signed up with your link, 2 paid\. You've earned \$10\./,
    );
    assert.doesNotMatch(view.text(), /limit of/);
    view.unmount();
  });

  it('says when the cap has been reached', async () => {
    const view = await mount(
      <ReferralPanel
        status={status({ referred: 40, paid: 25, earnedCents: 12500 })}
      />,
    );
    assert.match(view.text(), /limit of 25 paid referrals/);
    view.unmount();
  });

  it('copies the link and says so', async () => {
    const copied: string[] = [];
    const view = await mount(
      <ReferralPanel
        status={status()}
        copy={async (text) => {
          copied.push(text);
        }}
      />,
    );
    await act(async () => {
      view.button().click();
    });
    assert.deepEqual(copied, ['https://app.vibld.com/?ref=ABCD2345']);
    assert.equal(view.button().textContent, 'Copied');
    assert.equal(
      view.container.querySelector('[role="status"]')?.textContent,
      'Link copied.',
    );
    assert.equal(view.alert(), null);
    view.unmount();
  });

  it('falls back to a selected field when the clipboard refuses', async () => {
    const view = await mount(
      <ReferralPanel
        status={status()}
        copy={async () => {
          throw new DOMException('Write permission denied.', 'NotAllowedError');
        }}
      />,
    );
    await act(async () => {
      view.button().click();
    });
    assert.match(view.alert()?.textContent ?? '', /Couldn't copy the link/);
    assert.equal(view.button().textContent, 'Copy');
    const field = view.field();
    assert.equal(document.activeElement, field);
    assert.equal(field.selectionStart, 0);
    assert.equal(field.selectionEnd, field.value.length);
    view.unmount();
  });

  it('renders the link as text, never as markup', async () => {
    // The status is validated before it gets here, so this cannot arrive
    // from the Worker; the point is that the panel would not render it as
    // markup even if it did.
    const hostile = 'https://app.vibld.com/?ref=<img src=x onerror=alert(1)>';
    const view = await mount(
      <ReferralPanel status={status({ url: hostile })} />,
    );
    assert.equal(view.field().value, hostile);
    assert.equal(view.container.querySelector('img'), null);
    view.unmount();
  });
});
