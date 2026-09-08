import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { Page } from '../components/SiteChrome';
import { metaFor, routeFor } from '../site';

export function meta() {
  return metaFor('/contact');
}

const FIELD =
  'mt-1 w-full rounded-md border border-black/20 bg-transparent px-3 py-2 dark:border-white/25';

/**
 * A demonstration form.
 *
 * There is no backend behind this template and it does not pretend otherwise:
 * the notice sits in the prerendered HTML, above the fields, where someone
 * reads it before typing rather than after submitting. Wiring it to a real
 * endpoint is a deliberate step the site's owner takes -- see the README.
 */
export default function Contact() {
  const route = routeFor('/contact');
  const [submitted, setSubmitted] = useState(false);
  const nameId = useId();
  const emailId = useId();
  const partId = useId();
  const detailId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <Page title="Contact" lead={route.description}>
      <div className="mt-10 max-w-xl">
        <p
          className="rounded-md border border-[var(--color-accent)] px-4 py-3 text-sm"
          role="note"
        >
          <strong>This form is a demonstration.</strong> Nothing you enter is
          sent anywhere, stored, or read by a person. Connect it to a real
          endpoint before using this site to collect enquiries.
        </p>

        <form className="mt-6 space-y-5" onSubmit={handleSubmit} noValidate>
          <div>
            <label htmlFor={nameId} className="font-medium">
              Your name
            </label>
            <input id={nameId} name="name" type="text" className={FIELD} />
          </div>

          <div>
            <label htmlFor={emailId} className="font-medium">
              Email
            </label>
            <input id={emailId} name="email" type="email" className={FIELD} />
          </div>

          <div>
            <label htmlFor={partId} className="font-medium">
              Part number
            </label>
            <input id={partId} name="part" type="text" className={FIELD} />
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              If the number is unreadable, describe the machine instead.
            </p>
          </div>

          <div>
            <label htmlFor={detailId} className="font-medium">
              When do you need it?
            </label>
            <textarea id={detailId} name="detail" rows={4} className={FIELD} />
          </div>

          <button
            type="submit"
            className="rounded-md bg-[var(--color-accent)] px-5 py-3 font-medium text-white hover:opacity-90"
          >
            Send enquiry
          </button>

          {/*
            Announced to a screen reader when it appears, because a visual
            confirmation below a button is invisible to someone who cannot
            see the page change.
          */}
          <p aria-live="polite" className="text-sm">
            {submitted
              ? 'Nothing was sent. This form is a demonstration and has no backend.'
              : ''}
          </p>
        </form>
      </div>
    </Page>
  );
}
