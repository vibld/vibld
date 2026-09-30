import { Link } from 'react-router';
import { DESIGN_TEMPLATE_INDEX } from '@vibld/ai/design-template-index';

import { Page } from '../components/SiteChrome';
import { examples } from '../examples';
import type { Example } from '../examples';
import { metaFor } from '../site';
import { TEMPLATES } from '../templates';
import type { Template } from '../templates';

export function meta() {
  return metaFor('/examples');
}

/**
 * What vibld has built, shown as it was built (internal PR 59 follow-up, task #71).
 *
 * Every example is the generator's output with no hand edits. One that does
 * not build is regenerated or left out, never patched: an example page that
 * quietly fixes its examples is showing the fixer's work, not vibld's.
 *
 * The live copies are published with vibld's own publish service, on its own
 * domain. They are shown as generated, which includes whatever fonts they
 * load, so they cannot live on vibld.com without breaking the Cookie
 * Notice's promise that this site loads no external fonts.
 */
export default function Examples() {
  const all = examples();
  return (
    <Page
      eyebrow="Examples"
      title="Built with vibld"
      lead="The sites and apps in the first section are exactly what vibld generated from the prompt shown, with no hand edits. Open the live copy, or download the source and run it yourself."
    >
      <ul className="mt-12 grid gap-8 md:grid-cols-2">
        {all.map((example) => (
          <ExampleCard key={example.slug} example={example} />
        ))}
      </ul>
      <p className="mt-12 max-w-2xl text-sm text-[var(--color-ink-muted)] text-pretty">
        The live copies are published by vibld at{' '}
        <code className="font-mono">vibld-preview.dev</code>, not on this site.
        They are shown as generated, so some load fonts from Google Fonts, which
        vibld.com itself does not.
      </p>

      {/*
        After the generated examples and apart from them, so the promise at
        the top of the page stays true of everything it is made about. See
        app/templates.ts.
      */}
      <section
        aria-labelledby="templates-title"
        className="mt-20 border-t border-[var(--color-edge)] pt-14"
      >
        <p className="lb-eyebrow">Templates</p>
        <h2
          id="templates-title"
          className="mt-3 font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl"
        >
          Starter templates, written by hand
        </h2>
        <p className="mt-4 max-w-2xl text-lg text-[var(--color-ink-muted)] text-pretty">
          These are not vibld output. They are starting points people wrote,
          which the builder can begin a project from, and their copy is about
          businesses that do not exist.
        </p>
        <ul className="mt-10 grid gap-8 md:grid-cols-2">
          {TEMPLATES.map((template) => (
            <TemplateCard key={template.slug} template={template} />
          ))}
        </ul>
      </section>
    </Page>
  );
}

function TemplateCard({ template }: { template: Template }) {
  const titleId = `template-${template.slug}`;
  return (
    <li
      aria-labelledby={titleId}
      className="flex flex-col overflow-hidden rounded-2xl border border-dashed border-[var(--color-edge-strong)] bg-[var(--color-surface)]"
    >
      <div className="border-b border-[var(--color-edge)] bg-[var(--color-paper)]">
        <img
          src={template.screenshot}
          alt=""
          width={1440}
          height={900}
          loading="lazy"
          decoding="async"
          className="aspect-[16/10] w-full object-cover object-top"
        />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 id={titleId} className="font-display text-xl font-bold">
            {template.name}
          </h3>
          <span className="rounded-full border border-[var(--color-edge-strong)] px-2.5 py-0.5 font-mono text-xs tracking-wide text-[var(--color-ink)] uppercase">
            Template, hand-built
          </span>
        </div>
        <p className="text-sm text-[var(--color-ink-muted)]">
          {template.subject}. {template.description}
        </p>
        <p className="text-sm text-[var(--color-ink-muted)]">
          MIT license, per the template’s LICENSE file.
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-x-6 gap-y-2 pt-2">
          <a href={template.source} className="text-link">
            Read the source on GitHub
          </a>
        </div>
      </div>
    </li>
  );
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function ExampleCard({ example }: { example: Example }) {
  const titleId = `example-${example.slug}`;
  return (
    <li
      aria-labelledby={titleId}
      className="flex flex-col overflow-hidden rounded-2xl border border-[var(--color-edge)] bg-[var(--color-surface)]"
    >
      <a
        href={example.liveUrl}
        className="block border-b border-[var(--color-edge)] bg-[var(--color-paper)]"
        aria-label={`Open the live ${example.title}, built by ${example.modelLabel}`}
      >
        <img
          src={example.screenshot}
          alt=""
          width={1440}
          height={900}
          loading="lazy"
          decoding="async"
          className="aspect-[16/10] w-full object-cover object-top"
        />
      </a>
      <div className="flex flex-1 flex-col gap-3 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id={titleId} className="font-display text-xl font-bold">
            {example.title}
          </h2>
          <span className="font-mono text-xs tracking-wide text-[var(--color-ink-muted)] uppercase">
            {example.kind === 'app' ? 'App' : 'Site'}
          </span>
        </div>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Built by{' '}
          <strong className="font-semibold text-[var(--color-ink)]">
            {example.modelLabel}
          </strong>{' '}
          on{' '}
          <time dateTime={example.generatedOn}>
            {formatDate(example.generatedOn)}
          </time>
        </p>
        {example.notes.map((note) => (
          <p key={note} className="text-sm text-[var(--color-ink-muted)]">
            {note}
          </p>
        ))}
        {DESIGN_TEMPLATE_INDEX.filter(
          (t) =>
            t.mergedInto?.collection === 'examples' &&
            t.mergedInto.slug === example.slug,
        ).map((design) => (
          <p key={design.id} className="text-sm text-[var(--color-ink-muted)]">
            The same product is in the template catalog as{' '}
            <Link to={`/templates/${design.id}`} className="text-link">
              {design.name}
            </Link>
            , with its palette, type and a full build prompt.
          </p>
        ))}
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">The prompt</summary>
          <p className="mt-2 text-[var(--color-ink-muted)] text-pretty">
            {example.prompt}
          </p>
        </details>
        <div className="mt-auto flex flex-wrap items-center gap-x-6 gap-y-2 pt-2">
          <a href={example.liveUrl} className="text-link">
            Open the live copy
          </a>
          <a href={example.sourceZip} download className="text-link">
            Download the source
          </a>
        </div>
      </div>
    </li>
  );
}
