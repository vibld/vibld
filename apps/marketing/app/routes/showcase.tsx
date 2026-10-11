import { SHOWCASE_PROMPTS, type ShowcasePrompt } from '@vibld/ai/showcase';

import { Page } from '../components/SiteChrome';
import { SITE, metaFor } from '../site';

export function meta() {
  return metaFor('/showcase');
}

/**
 * Showcase prompts (packages/ai/src/showcase.ts): requests written to show
 * off the 3D scenes, the animated backgrounds and motion. "Build this"
 * opens the builder with the prompt in the composer, through the same link
 * as "Start from this template" (D106), so nothing is spent until the
 * person sends it.
 */
export default function Showcase() {
  return (
    <Page
      eyebrow="Showcase"
      title="Prompts that show off"
      lead="Requests written to build something that moves: 3D globes and orbs, living backgrounds and scroll-driven motion. Pick one and the builder opens with it ready to send, or to change first."
    >
      <ul className="mt-12 grid gap-8 md:grid-cols-2">
        {SHOWCASE_PROMPTS.map((entry) => (
          <ShowcaseCard key={entry.id} entry={entry} />
        ))}
      </ul>
      <p className="mt-12 max-w-2xl text-sm text-[var(--color-ink-muted)] text-pretty">
        The art on each card is a sketch of its colors, not a screenshot. Every
        build is new, so yours will differ from anyone else’s, and the builder
        shows what it will cost before you send it.
      </p>
    </Page>
  );
}

/** The builder's address with this prompt in its composer (D106). */
function showcaseStartUrl(entry: ShowcasePrompt): string {
  return `${SITE.appUrl}/#${new URLSearchParams({
    template: entry.id,
    brief: entry.prompt,
  }).toString()}`;
}

function ShowcaseCard({ entry }: { entry: ShowcasePrompt }) {
  const titleId = entry.id;
  const [ground, glow] = entry.colors;
  return (
    <li
      aria-labelledby={titleId}
      className="flex flex-col overflow-hidden rounded-2xl border border-[var(--color-edge)] bg-[var(--color-surface)]"
    >
      <div
        aria-hidden="true"
        className="relative aspect-[16/9] w-full"
        style={{
          background: `radial-gradient(60% 70% at 70% 45%, ${glow}, transparent 70%), radial-gradient(40% 50% at 20% 80%, ${glow}55, transparent 70%), ${ground}`,
        }}
      >
        <span className="absolute bottom-4 left-5 font-display text-2xl font-bold text-white">
          {entry.name}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id={titleId} className="font-display text-xl font-bold">
            {entry.name}
          </h2>
          <span className="rounded-full border border-[var(--color-edge-strong)] px-2.5 py-0.5 font-mono text-xs tracking-wide text-[var(--color-ink)] uppercase">
            {entry.effect}
          </span>
        </div>
        <p className="text-sm text-[var(--color-ink-muted)]">{entry.summary}</p>
        <details className="text-sm">
          <summary className="cursor-pointer text-[var(--color-ink)]">
            Read the prompt
          </summary>
          <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-[var(--color-paper)] p-4 font-mono text-xs whitespace-pre-wrap text-[var(--color-ink-muted)]">
            {entry.prompt}
          </pre>
        </details>
        <div className="mt-auto flex flex-wrap items-center gap-x-6 gap-y-2 pt-2">
          <a className="button" href={showcaseStartUrl(entry)}>
            Build this
          </a>
        </div>
      </div>
    </li>
  );
}
