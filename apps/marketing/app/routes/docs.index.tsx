import { Link } from 'react-router';
import { Page } from '../components/SiteChrome';
import { DOC_TRACKS, guidesIn, metaFor } from '../site';

export function meta() {
  return metaFor('/docs');
}

export default function DocsIndex() {
  return (
    <Page
      eyebrow="Docs"
      title="Guides"
      lead="Two tracks, because they answer different questions. One is about using the hosted builder. The other is about running your own copy of it."
    >
      <div className="mt-12 space-y-14">
        {DOC_TRACKS.map((track) => (
          <section key={track.id} id={track.id} className="scroll-mt-8">
            <h2 className="font-display text-2xl font-bold tracking-tight">
              {track.label}
            </h2>
            <p className="mt-2 max-w-2xl text-[var(--color-ink-muted)] text-pretty">
              {track.lead}
            </p>
            <ul className="mt-6 divide-y divide-black/10 border-t border-b border-black/10 dark:divide-white/10 dark:border-white/10">
              {guidesIn(track.id).map((guide) => (
                <li key={guide.slug}>
                  <Link
                    to={`/docs/${guide.slug}`}
                    className="group flex items-center justify-between gap-4 py-5"
                  >
                    <span>
                      <span className="text-lg font-medium group-hover:text-[var(--color-accent-ink)] group-hover:underline group-hover:underline-offset-4">
                        {guide.label}
                      </span>
                      <span className="mt-1 block text-sm text-[var(--color-ink-muted)]">
                        {guide.description}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className="shrink-0 text-[var(--color-ink-muted)] group-hover:text-[var(--color-accent-ink)]"
                    >
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Page>
  );
}
