import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import { ProjectBar } from '../src/components/ProjectBar.tsx';
import { ProjectsView } from '../src/components/ProjectsView.tsx';
import type { ProjectSummary } from '../src/projects/projects-client.ts';
import type { ProjectsController } from '../src/projects/use-projects.ts';

/**
 * The Projects page and the project in the header, as they are wired: what
 * each control asks of the projects controller, and what the page says.
 *
 * Driven with a controller that records what it was asked rather than the
 * real hook, because the rules behind each action (ownership, the limit,
 * what a delete removes) are the Worker's and are tested there. What only
 * the page can get wrong is which action a button takes, and whether
 * deleting asks first.
 */

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function render(element: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(element);
    await settle();
  });
  const buttons = (text: RegExp) =>
    [...container.querySelectorAll('button')].filter((b) =>
      text.test(b.textContent ?? ''),
    );
  return {
    container,
    text: () => container.textContent ?? '',
    buttons,
    async press(target: HTMLElement | undefined) {
      assert.ok(target, 'nothing to press');
      await act(async () => {
        target.click();
        await settle();
      });
    },
    rerender: async (next: ReactElement) => {
      await act(async () => {
        root.render(next);
        await settle();
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const summary = (over: Partial<ProjectSummary>): ProjectSummary => ({
  id: 'p1',
  name: 'Bakery',
  archived: false,
  archivedAt: null,
  createdAt: '2026-09-28T12:00:00.000Z',
  editedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
  lastOpenedAt: '2026-09-28T12:00:00.000Z',
  hasCode: true,
  turns: 2,
  settings: {
    style: null,
    referenceUrl: null,
    model: null,
    knowledge: null,
    styleDna: null,
  },
  ...over,
});

function controller(
  over: Partial<ProjectsController> = {},
): ProjectsController & { asked: string[] } {
  const asked: string[] = [];
  const note =
    (name: string) =>
    async (...args: unknown[]) => {
      asked.push(`${name}(${args.map((a) => JSON.stringify(a)).join(',')})`);
    };
  return {
    asked,
    mode: 'server',
    current: summary({}),
    list: {
      projects: [
        summary({}),
        summary({ id: 'p2', name: 'Garage' }),
        summary({ id: 'p3', name: 'Old site', archived: true }),
      ],
      limits: { tier: 'free', active: 2, maxActive: 3 },
    },
    saveStatus: 'saved',
    notice: null,
    busy: null,
    clearNotice: () => asked.push('clearNotice()'),
    refreshList: note('refreshList'),
    showList: () => asked.push('showList()'),
    open: (id) => asked.push(`open("${id}")`),
    create: note('create'),
    rename: note('rename'),
    duplicate: note('duplicate'),
    setArchived: note('setArchived'),
    remove: note('remove'),
    ...over,
  };
}

function rowFor(container: HTMLElement, name: string): HTMLElement {
  const row = [...container.querySelectorAll('li')].find((li) =>
    li.textContent?.includes(name),
  );
  assert.ok(row, `no row for ${name}`);
  return row as HTMLElement;
}

function buttonIn(row: HTMLElement, text: RegExp): HTMLElement | undefined {
  return [...row.querySelectorAll('button')].find((b) =>
    text.test(b.textContent ?? ''),
  ) as HTMLElement | undefined;
}

describe('the Projects page', () => {
  it('lists active projects with when each was edited, and the archived ones apart', async () => {
    const projects = controller();
    const view = await render(<ProjectsView projects={projects} />);
    const active = view.container.querySelector(
      '[aria-label="Active projects"]',
    );
    const archived = view.container.querySelector(
      '[aria-label="Archived projects"]',
    );
    assert.match(active?.textContent ?? '', /Bakery/);
    assert.match(active?.textContent ?? '', /Garage/);
    assert.match(active?.textContent ?? '', /Edited 3 minutes ago/);
    assert.match(active?.textContent ?? '', /Open now/);
    assert.doesNotMatch(active?.textContent ?? '', /Old site/);
    assert.match(archived?.textContent ?? '', /Old site/);
    assert.match(view.text(), /2 of 3 active projects/);

    // An archived project can be brought back or deleted, and nothing else.
    const old = rowFor(view.container, 'Old site');
    assert.ok(buttonIn(old, /^Unarchive$/));
    assert.ok(buttonIn(old, /^Delete$/));
    assert.equal(buttonIn(old, /^Open$/), undefined);
    assert.equal(buttonIn(old, /^Rename$/), undefined);
    view.unmount();
  });

  it('opens, duplicates, archives and unarchives through the controller', async () => {
    const projects = controller();
    const view = await render(<ProjectsView projects={projects} />);
    const garage = rowFor(view.container, 'Garage');
    await view.press(buttonIn(garage, /^Open$/));
    await view.press(buttonIn(garage, /^Duplicate$/));
    await view.press(buttonIn(garage, /^Archive$/));
    await view.press(
      buttonIn(rowFor(view.container, 'Old site'), /^Unarchive$/),
    );
    assert.deepEqual(projects.asked, [
      'open("p2")',
      'duplicate("p2")',
      'setArchived("p2",true)',
      'setArchived("p3",false)',
    ]);
    view.unmount();
  });

  it('asks in the page before deleting, and deletes nothing if kept', async () => {
    const projects = controller();
    const view = await render(<ProjectsView projects={projects} />);
    await view.press(buttonIn(rowFor(view.container, 'Garage'), /^Delete$/));
    const row = rowFor(view.container, 'Garage');
    assert.match(row.textContent ?? '', /Delete “Garage” for good\?/);
    assert.match(row.textContent ?? '', /cannot be recovered/);
    assert.deepEqual(projects.asked, [], 'deleted before it was confirmed');

    await view.press(buttonIn(row, /^Keep it$/));
    assert.deepEqual(projects.asked, []);

    await view.press(buttonIn(rowFor(view.container, 'Garage'), /^Delete$/));
    await view.press(
      buttonIn(rowFor(view.container, 'Garage'), /^Delete for good$/),
    );
    assert.deepEqual(projects.asked, ['remove("p2")']);
    view.unmount();
  });

  it('renames in place', async () => {
    const projects = controller();
    const view = await render(<ProjectsView projects={projects} />);
    await view.press(buttonIn(rowFor(view.container, 'Garage'), /^Rename$/));
    const input = view.container.querySelector('input')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, 'Car repairs');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await view.press(view.buttons(/^Save$/)[0]);
    assert.deepEqual(projects.asked, ['rename("p2","Car repairs")']);
    view.unmount();
  });

  it('starts a new project', async () => {
    const projects = controller();
    const view = await render(<ProjectsView projects={projects} />);
    await view.press(view.buttons(/^New project$/)[0]);
    assert.deepEqual(projects.asked, ['create()']);
    view.unmount();
  });

  it('gives the limit its reason and a way to upgrade, through Checkout', async () => {
    const calls: { url: string; body: unknown }[] = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(
        JSON.stringify({ url: 'https://checkout.example/session' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    const was = window.location.href;

    const projects = controller({
      notice: {
        kind: 'limit',
        limit: 3,
        message:
          'A free account can have 3 active projects. Archive one to start another, or upgrade for unlimited projects.',
      },
    });
    const view = await render(<ProjectsView projects={projects} />);
    const alert = view.container.querySelector('[role="alert"]');
    assert.match(
      alert?.textContent ?? '',
      /A free account can have 3 active projects/,
    );

    await view.press(view.buttons(/Upgrade for unlimited projects/)[0]);
    const checkout = calls.find((call) => call.url === '/api/billing/checkout');
    assert.ok(checkout, 'the upgrade did not start Checkout');
    assert.deepEqual(checkout.body, { tier: 'build', interval: 'monthly' });
    assert.equal(window.location.href, 'https://checkout.example/session');
    window.location.href = was;
    view.unmount();
  });

  it('shows any other failure without an upgrade', async () => {
    const projects = controller({
      notice: { kind: 'failed', status: 500, message: 'Something broke.' },
    });
    const view = await render(<ProjectsView projects={projects} />);
    assert.match(view.text(), /Something broke\./);
    assert.equal(view.buttons(/Upgrade/).length, 0);
    await view.press(view.buttons(/^Dismiss$/)[0]);
    assert.deepEqual(projects.asked, ['clearNotice()']);
    view.unmount();
  });
});

describe('the project in the header', () => {
  it('names the open project, says whether it is saved, and leads back to the list', async () => {
    const projects = controller({ saveStatus: 'saving' });
    const view = await render(<ProjectBar projects={projects} />);
    assert.match(view.text(), /Projects/);
    assert.match(view.text(), /Bakery/);
    assert.match(view.text(), /Saving…/);

    const failing = controller({ saveStatus: 'error' });
    await view.rerender(<ProjectBar projects={failing} />);
    assert.match(view.text(), /Couldn’t save/);

    const link = view.container.querySelector('a')!;
    assert.equal(link.getAttribute('href'), '/projects');
    await view.press(link);
    assert.deepEqual(failing.asked, ['showList()']);
    view.unmount();
  });

  it('renames the open project where it stands, and Escape keeps the name', async () => {
    const projects = controller();
    const view = await render(<ProjectBar projects={projects} />);
    const type = async (value: string) => {
      const input = view.container.querySelector('input')!;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value',
        )?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      return input;
    };
    const key = async (input: HTMLInputElement, name: string) => {
      await act(async () => {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: name, bubbles: true }),
        );
        await settle();
      });
    };

    await view.press(view.buttons(/^Bakery$/)[0]);
    await key(await type('Thrown away'), 'Escape');
    assert.deepEqual(projects.asked, []);

    await view.press(view.buttons(/^Bakery$/)[0]);
    await key(await type('Corner bakery'), 'Enter');
    assert.deepEqual(projects.asked, ['rename("p1","Corner bakery")']);
    view.unmount();
  });

  it('is absent without projects, and says so when they could not be loaded', async () => {
    const local = await render(
      <ProjectBar projects={controller({ mode: 'local' })} />,
    );
    assert.equal(local.text(), '');
    local.unmount();

    const failed = await render(
      <ProjectBar
        projects={controller({
          mode: 'local',
          notice: { kind: 'failed', status: 500, message: 'x' },
        })}
      />,
    );
    assert.match(failed.text(), /this session is not being saved/);
    failed.unmount();
  });
});
