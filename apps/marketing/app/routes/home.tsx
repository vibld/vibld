import { WaitlistForm } from '../components/WaitlistForm';
import { SITE, metaFor } from '../site';

export function meta() {
  return metaFor('/');
}

export default function Home() {
  return (
    <article className="mx-auto max-w-5xl px-5 py-16 sm:py-24">
      <p className="font-mono text-sm font-medium tracking-wide text-[var(--color-accent-ink)] uppercase">
        Coming soon
      </p>
      <h1 className="mt-3 max-w-3xl font-display text-5xl font-bold tracking-tight text-balance sm:text-6xl">
        Vibe. Build. Ship.
      </h1>
      <p className="mt-6 max-w-2xl text-lg text-[var(--color-ink-muted)] text-pretty sm:text-xl">
        Vibld is an AI application builder that turns a conversation into a
        working project, and generates a conventional, portable codebase when
        it&apos;s done, not a proprietary format that only runs inside Vibld. No
        lock-in, no required runtime, code you can actually read and take with
        you.
      </p>

      <WaitlistForm />

      <p className="mt-4 text-sm text-[var(--color-ink-muted)]">
        Vibld's core is open source under Apache-2.0: no lock-in by promise, not
        just by product design.{' '}
        <a
          href={SITE.repoUrl}
          className="font-medium text-[var(--color-accent-ink)] underline underline-offset-4"
        >
          View the code on GitHub →
        </a>
      </p>

      <BuildPreview />
    </article>
  );
}

/**
 * An illustration of the product concept, not a screenshot -- there is no
 * public build to capture yet. Labeled as a concept rather than presented as
 * a real screen, so it never misrepresents what exists today.
 */
function BuildPreview() {
  return (
    <figure className="mt-20">
      <div className="overflow-hidden rounded-xl border border-black/10 bg-[var(--color-surface)] shadow-sm dark:border-white/10">
        <div className="flex items-center gap-1.5 border-b border-black/10 px-4 py-3 dark:border-white/10">
          <span className="size-2.5 rounded-full bg-black/15 dark:bg-white/20" />
          <span className="size-2.5 rounded-full bg-black/15 dark:bg-white/20" />
          <span className="size-2.5 rounded-full bg-black/15 dark:bg-white/20" />
        </div>
        <div className="grid gap-px bg-black/10 sm:grid-cols-3 dark:bg-white/10">
          <div className="bg-[var(--color-paper)] p-5">
            <p className="text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
              You say
            </p>
            <p className="mt-2 text-sm text-[var(--color-ink)]">
              &ldquo;A pricing page with three tiers and an annual
              toggle.&rdquo;
            </p>
          </div>
          <div className="bg-[var(--color-paper)] p-5 font-mono text-xs leading-relaxed text-[var(--color-ink-muted)]">
            <p className="text-[var(--color-ink)]">app/pricing.tsx</p>
            <p className="mt-2">export default function Pricing() {'{'}</p>
            <p className="pl-3">const [annual, setAnnual] =</p>
            <p className="pl-6">useState(false);</p>
            <p>{'}'}</p>
          </div>
          <div className="bg-[var(--color-paper)] p-5">
            <p className="text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
              You get
            </p>
            <div className="mt-2 flex gap-1.5">
              {['Free', 'Build', 'Ship'].map((tier) => (
                <span
                  key={tier}
                  className="rounded border border-black/10 px-2 py-1 text-xs text-[var(--color-ink-muted)] dark:border-white/10"
                >
                  {tier}
                </span>
              ))}
            </div>
            <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
              A live preview, and a codebase you own.
            </p>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-sm text-[var(--color-ink-muted)]">
        An illustration of how Vibld works, not a screenshot of the product.
      </figcaption>
    </figure>
  );
}
