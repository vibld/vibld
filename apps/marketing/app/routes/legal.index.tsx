import { Link } from 'react-router';
import { Page } from '../components/SiteChrome';
import { LEGAL_DOCS, metaFor } from '../site';

export function meta() {
  return metaFor('/legal');
}

export default function LegalIndex() {
  return (
    <Page
      eyebrow="Legal"
      title="Legal documents"
      lead="Every policy governing Vibld and this site, in one place."
    >
      <ul className="mt-10 divide-y divide-black/10 border-t border-b border-black/10 dark:divide-white/10 dark:border-white/10">
        {LEGAL_DOCS.map((doc) => (
          <li key={doc.slug}>
            <Link
              to={`/legal/${doc.slug}`}
              className="group flex items-center justify-between gap-4 py-5"
            >
              <span>
                <span className="text-lg font-medium group-hover:text-[var(--color-accent-ink)] group-hover:underline group-hover:underline-offset-4">
                  {doc.label}
                </span>
                <span className="mt-1 block text-sm text-[var(--color-ink-muted)]">
                  {doc.description}
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
    </Page>
  );
}
