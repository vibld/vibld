import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import { ParkedQueuePanel } from '../src/components/ParkedQueuePanel.tsx';

/**
 * The panel around the parked queue (#46).
 *
 * `parked-queue-view.test.ts` covers the wording. What is left here is the
 * behaviour a view model cannot have: that opening it is what costs a query,
 * that a transport failure says so rather than sitting on "Reading the
 * queue...", and that a count from the database and a capped page of rows
 * are never presented as if they were the same number.
 */

function reply(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Counts what was asked for, so "does not read until opened" is checkable. */
function serving(answer: () => Response | Promise<Response>): {
  calls: number;
} {
  const seen = { calls: 0 };
  globalThis.fetch = (async () => {
    seen.calls += 1;
    return answer();
  }) as typeof fetch;
  return seen;
}

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<ParkedQueuePanel />);
  });
  return {
    container,
    text: () => container.textContent ?? '',
    /** What a person does to this panel: open the disclosure. */
    async open() {
      const details = container.querySelector('details');
      assert.ok(details, 'no disclosure to open');
      await act(async () => {
        details.open = true;
        details.dispatchEvent(new Event('toggle', { bubbles: false }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('the parked queue panel', () => {
  it('costs nothing until somebody opens it', async () => {
    // A queue nobody is looking at should not be read on every page load.
    const seen = serving(() => reply({ parked: 0, events: [] }));
    const panel = await mount();
    assert.equal(seen.calls, 0, 'the panel read the queue before being opened');
    panel.unmount();
  });

  it('shows the count and the age once opened', async () => {
    serving(() =>
      reply({
        parked: 3,
        oldestFirstSeenAt: daysAgo(5),
        oldestCreated: 1_700_000_000,
        events: [
          {
            stripeEventId: 'evt_1',
            type: 'invoice.paid',
            created: 1_700_000_000,
            firstSeenAt: daysAgo(5),
            attempts: 5,
            customerId: 'cus_42',
            amountCents: 1999,
            currency: 'usd',
          },
        ],
      }),
    );
    const panel = await mount();
    await panel.open();

    assert.match(panel.text(), /3 payments waiting to be attributed/);
    assert.match(panel.text(), /the oldest for 5 days/);
    assert.match(panel.text(), /\$19\.99/);
    assert.match(panel.text(), /cus_42/);
    assert.match(
      panel.text(),
      /Nothing here has been credited to anybody/,
      'the panel let "these are already handled" stand',
    );
    panel.unmount();
  });

  it('says the rows are a page when the queue is bigger than them', async () => {
    serving(() =>
      reply({
        parked: 400,
        oldestFirstSeenAt: daysAgo(0.1),
        oldestCreated: 1,
        events: [
          {
            stripeEventId: 'evt_1',
            type: 'invoice.paid',
            created: 1,
            firstSeenAt: daysAgo(0.1),
            attempts: 1,
          },
        ],
      }),
    );
    const panel = await mount();
    await panel.open();

    assert.match(panel.text(), /400 payments waiting/);
    assert.match(
      panel.text(),
      /count above is the whole queue/,
      'one row under a headline of 400 read as a bug in the panel',
    );
    panel.unmount();
  });

  it('reports a transport failure instead of loading for ever', async () => {
    globalThis.fetch = (async () => {
      throw new Error('the network went away');
    }) as typeof fetch;
    const panel = await mount();
    await panel.open();

    assert.match(panel.text(), /could not be read/);
    assert.doesNotMatch(panel.text(), /Reading the queue/);
    panel.unmount();
  });

  it('passes on a refusal the route worded itself', async () => {
    serving(() => reply({ error: 'Billing is not configured here.' }, 503));
    const panel = await mount();
    await panel.open();

    assert.match(
      panel.text(),
      /Billing is not configured here/,
      'a configuration problem was reported as something else',
    );
    panel.unmount();
  });

  it('says nothing is waiting rather than showing an empty table', async () => {
    serving(() =>
      reply({
        parked: 0,
        oldestFirstSeenAt: null,
        oldestCreated: null,
        events: [],
      }),
    );
    const panel = await mount();
    await panel.open();

    assert.match(panel.text(), /No payments waiting to be attributed/);
    panel.unmount();
  });
});
