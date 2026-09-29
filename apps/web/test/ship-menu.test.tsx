import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { ProjectSnapshot } from '@vibld/core';

import { ShipMenu } from '../src/components/ShipMenu.tsx';
import { connectFlow } from '../src/github/connect-flow.ts';
import { githubStatus } from '../src/github/github-status.ts';
import type { ProjectSummary } from '../src/projects/projects-client.ts';

/**
 * The Ship menu (D72): export, publish and push to GitHub, beside Share in
 * the top bar, because a real person could not find them at the top of the
 * Code tab's file list.
 *
 * The three components it holds have their own tests. What these cover is
 * the menu itself: that all three are in it, that it is a control a
 * keyboard and a screen reader can use, that closing it does not throw away
 * a publish in flight, and that a project with no repository is offered the
 * two ways to get one.
 */

const SNAPSHOT = {
  revision: 'r7',
  files: [{ path: 'index.html', content: '<h1>hi</h1>' }],
} as ProjectSnapshot;

const PROJECT: ProjectSummary = {
  id: 'north-star',
  name: 'North Star',
  archived: false,
  archivedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  editedAt: '2026-09-28T00:00:00.000Z',
  lastOpenedAt: '2026-09-28T00:00:00.000Z',
  hasCode: true,
  turns: 3,
  settings: {
    style: null,
    referenceUrl: null,
    model: null,
    knowledge: null,
    styleDna: null,
  },
  site: null,
};

function reply(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Answers the status route with `status`, and everything else with `{}`. */
function serving(status: unknown): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    if (url.includes('/api/github/status')) return reply(status);
    return reply({});
  }) as typeof fetch;
  return asked;
}

async function mount(element: React.ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });
  const toggle = () => {
    const button = container.querySelector<HTMLButtonElement>(
      '.projectbar__shipbutton',
    );
    assert.ok(button, 'no Ship button');
    return button;
  };
  return {
    container,
    toggle,
    panel: () => container.querySelector<HTMLElement>('.projectbar__shippanel'),
    text: () => container.textContent ?? '',
    buttons: () =>
      [...container.querySelectorAll('button')].map(
        (each) => each.textContent ?? '',
      ),
    async open() {
      await act(async () => toggle().click());
    },
    async key(key: string) {
      await act(async () => {
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key }));
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const BOUND = {
  configured: true,
  canPush: true,
  canConnect: true,
  account: { connected: true, login: 'chris' },
  projectId: 'north-star',
  connected: true,
  owner: 'chris',
  repo: 'north-star',
  defaultBranch: 'main',
};

const UNBOUND = {
  configured: true,
  canPush: true,
  canConnect: true,
  account: { connected: true, login: 'chris' },
  projectId: 'north-star',
  connected: false,
  reason: 'none',
};

beforeEach(() => {
  githubStatus.forget();
  githubStatus.setProject(null);
  connectFlow.set({ phase: { at: 'idle' }, projectId: null });
});

describe('the Ship menu', () => {
  it('holds export, publish and push to GitHub', async () => {
    serving(BOUND);
    const view = await mount(
      <ShipMenu project={PROJECT} snapshot={SNAPSHOT} />,
    );
    await view.open();

    const headings = [...view.container.querySelectorAll('h2')].map(
      (each) => each.textContent,
    );
    assert.deepEqual(headings, ['Export', 'Publish', 'Push to GitHub']);
    const buttons = view.buttons();
    assert.ok(
      buttons.some((each) => /Download \.zip/.test(each)),
      `no export: ${buttons.join(' | ')}`,
    );
    assert.ok(
      buttons.some((each) => /^Publish/.test(each)),
      `no publish: ${buttons.join(' | ')}`,
    );
    assert.ok(
      buttons.some((each) => each === 'Push to chris/north-star'),
      `no push: ${buttons.join(' | ')}`,
    );
    view.unmount();
  });

  it('says what it controls and whether it is open, for a screen reader', async () => {
    serving(BOUND);
    const view = await mount(
      <ShipMenu project={PROJECT} snapshot={SNAPSHOT} />,
    );
    const button = view.toggle();
    const panel = view.panel();
    assert.ok(panel);
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(button.getAttribute('aria-controls'), panel.id);
    assert.equal(panel.getAttribute('role'), 'group');
    assert.equal(panel.getAttribute('aria-label'), 'Ship this project');
    assert.equal(panel.hidden, true);

    await view.open();
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.equal(panel.hidden, false);
    view.unmount();
  });

  it('closes on Escape and puts focus back on its button', async () => {
    serving(BOUND);
    const view = await mount(
      <ShipMenu project={PROJECT} snapshot={SNAPSHOT} />,
    );
    await view.open();
    await view.key('Escape');
    assert.equal(view.panel()?.hidden, true);
    assert.equal(document.activeElement, view.toggle());
    view.unmount();
  });

  it('closes on a click anywhere else', async () => {
    serving(BOUND);
    const view = await mount(
      <ShipMenu project={PROJECT} snapshot={SNAPSHOT} />,
    );
    await view.open();
    await act(async () => {
      document.body.dispatchEvent(
        new window.MouseEvent('mousedown', { bubbles: true }),
      );
    });
    assert.equal(view.panel()?.hidden, true);
    view.unmount();
  });

  it('hides its actions rather than unmounting them, so one in flight survives', async () => {
    serving(BOUND);
    const view = await mount(
      <ShipMenu project={PROJECT} snapshot={SNAPSHOT} />,
    );
    // Closed from the start, and the push button is already there.
    assert.equal(view.panel()?.hidden, true);
    assert.ok(view.buttons().some((each) => /Push to/.test(each)));
    view.unmount();
  });

  it('says there is nothing to ship before a build is accepted', async () => {
    serving(BOUND);
    const view = await mount(<ShipMenu project={PROJECT} snapshot={null} />);
    await view.open();
    assert.match(view.text(), /Nothing to ship yet/);
    assert.equal(view.container.querySelectorAll('h2').length, 0);
    view.unmount();
  });

  it('says which files the actions act on when those are not on screen', async () => {
    serving(BOUND);
    const view = await mount(
      <ShipMenu
        project={PROJECT}
        snapshot={SNAPSHOT}
        note="These act on the last accepted checkpoint, not the staged files."
      />,
    );
    await view.open();
    assert.match(view.text(), /not the staged files/);
    view.unmount();
  });

  it('offers a project with no repository the two ways to get one', async () => {
    serving(UNBOUND);
    const view = await mount(
      <ShipMenu project={PROJECT} snapshot={SNAPSHOT} />,
    );
    await view.open();
    const buttons = view.buttons();
    assert.ok(buttons.includes('Create a new repository'), buttons.join(' | '));
    assert.ok(
      buttons.includes('Use an existing repository'),
      buttons.join(' | '),
    );
    // Named from the project, and private unless unticked.
    const name = view.container.querySelector<HTMLInputElement>(
      '.github-chooser__name',
    );
    assert.equal(name?.value, 'north-star');
    const hidden = view.container.querySelector<HTMLInputElement>(
      '.github-chooser__private input, input[type="checkbox"]',
    );
    assert.equal(hidden?.checked, true);
    // Labelled, so a screen reader names the field.
    const label = view.container.querySelector(`label[for="${name?.id}"]`);
    assert.match(label?.textContent ?? '', /repository name/i);
    // And no push button, since there is nowhere to push to yet.
    assert.equal(
      buttons.some((each) => /^Push to/.test(each)),
      false,
    );
    view.unmount();
  });

  it('asks the status about the open project', async () => {
    const asked = serving(BOUND);
    const view = await mount(
      <ShipMenu project={PROJECT} snapshot={SNAPSHOT} />,
    );
    assert.ok(
      asked.includes('/api/github/status?project=north-star'),
      asked.join(' | '),
    );
    view.unmount();
  });

  it('opens by itself with the answer to a trip to GitHub it started', async () => {
    // The page GitHub returns to is a fresh load with every menu closed.
    serving(UNBOUND);
    const view = await mount(
      <ShipMenu project={PROJECT} snapshot={SNAPSHOT} />,
    );
    assert.equal(view.panel()?.hidden, true);
    await act(async () => {
      connectFlow.set({
        phase: { at: 'problem', error: 'GitHub said no.' },
        projectId: 'north-star',
        from: 'ship',
      });
    });
    assert.equal(view.panel()?.hidden, false);
    assert.match(view.text(), /GitHub said no/);
    view.unmount();
  });

  it('stays shut for a trip started from the settings panel', async () => {
    serving(UNBOUND);
    const view = await mount(
      <ShipMenu project={PROJECT} snapshot={SNAPSHOT} />,
    );
    await act(async () => {
      connectFlow.set({
        phase: { at: 'problem', error: 'GitHub said no.' },
        projectId: 'north-star',
        from: 'settings',
      });
    });
    assert.equal(view.panel()?.hidden, true);
    view.unmount();
  });
});
