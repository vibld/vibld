import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ProjectSnapshot } from '@vibld/core';
import { renderDesignMd } from '@vibld/ai/design-spec';
import type { DesignSpec } from '@vibld/ai/design-spec';
import { SampleContent, sampleIn } from '../src/components/SampleContent.tsx';

/** The builder lists what a build wrote as sample content (D177). */

const SPEC: DesignSpec = {
  intent: 'A wedding site for two guests to plan a weekend by',
  tokens: {
    colors: [{ name: 'background', value: '#faf7f2', use: 'page' }],
    fonts: [
      {
        role: 'display',
        family: 'Fraunces',
        fallback: 'Georgia, serif',
        weights: [400],
      },
    ],
    type: [
      {
        name: 'hero',
        size: '4rem',
        lineHeight: '1',
        letterSpacing: '-0.02em',
      },
    ],
    space: [],
    radii: [],
    effects: [],
  },
  sections: [{ id: 'hero', purpose: 'p', layout: 'l', copy: [] }],
  breakpoints: [],
  motion: [],
  do: [],
  avoid: [],
  checks: [],
  sample: [],
};

function snapshot(files: { path: string; content: string }[]): ProjectSnapshot {
  return { revision: 'r1', files };
}

async function render(value: ProjectSnapshot | null): Promise<string> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<SampleContent snapshot={value} />));
  const text = container.textContent ?? '';
  act(() => root.unmount());
  container.remove();
  return text;
}

describe('the sample content to replace', () => {
  it("lists the spec's sample from the project's DESIGN.md", async () => {
    const value = snapshot([
      {
        path: 'DESIGN.md',
        content: renderDesignMd({
          ...SPEC,
          sample: ['Schedule: Saturday times', 'Schedule: Saturday times'],
        }),
      },
    ]);
    assert.deepEqual(sampleIn(value), ['Schedule: Saturday times']);
    const text = await render(value);
    assert.match(text, /Sample content to replace/);
    assert.match(text, /Schedule: Saturday times/);
  });

  it('shows nothing without a list, a spec or a project', async () => {
    assert.equal(
      await render(
        snapshot([{ path: 'DESIGN.md', content: renderDesignMd(SPEC) }]),
      ),
      '',
    );
    assert.equal(
      await render(snapshot([{ path: 'DESIGN.md', content: '# Design' }])),
      '',
    );
    assert.equal(await render(null), '');
  });
});
