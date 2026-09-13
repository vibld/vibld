import { useEffect, useId, useState } from 'react';

import { SITE } from '../site.ts';

type Status = 'idle' | 'submitting' | 'success' | 'error';

/**
 * The minimum of Turnstile's global API this component calls. `reset()`
 * with no id resets every widget on the page, which is fine here -- this
 * form is the only one that ever renders one.
 */
declare global {
  interface Window {
    turnstile?: { reset(widgetId?: string): void };
  }
}

/**
 * Submits to a real endpoint (`/api/waitlist`, handled by the Worker in
 * `worker/`) via `fetch`, with the form's own `action`/`method` as a fallback
 * for a caller without JavaScript -- a full-page post still reaches the same
 * handler and gets a real confirmation page back.
 */
export function WaitlistForm() {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const emailId = useId();
  const honeypotId = useId();
  const [pageUrl, setPageUrl] = useState('');
  const [pageReferrer, setPageReferrer] = useState('');

  // Read after mount, never during render: these do not exist while the page
  // is being prerendered, and reading them in the render body would make the
  // server and client markup disagree.
  useEffect(() => {
    setPageUrl(window.location.href);
    setPageReferrer(document.referrer);
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('submitting');
    setMessage(null);

    const form = event.currentTarget;
    const body = new FormData(form);

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { accept: 'application/json' },
        body,
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;

      if (response.ok && data?.ok) {
        setStatus('success');
        form.reset();
      } else {
        setStatus('error');
        setMessage(
          data?.error ?? 'Something went wrong. Please try again in a moment.',
        );
        // Turnstile tokens are single-use. Without this, a retry after any
        // failure -- including one that has nothing to do with Turnstile --
        // would always be rejected on the second attempt too.
        window.turnstile?.reset();
      }
    } catch {
      setStatus('error');
      setMessage(
        'Could not reach the server. Check your connection and try again.',
      );
      window.turnstile?.reset();
    }
  }

  if (status === 'success') {
    return (
      <p
        role="status"
        className="mt-8 rounded-md bg-[var(--color-surface)] px-5 py-4 text-[var(--color-ink)]"
      >
        You're on the list. We'll email you when Vibld is ready.
      </p>
    );
  }

  return (
    <form
      action="/api/waitlist"
      method="post"
      onSubmit={handleSubmit}
      noValidate
      className="mt-8 max-w-md"
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor={emailId} className="sr-only">
          Email address
        </label>
        <input
          id={emailId}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          className="w-full flex-1 rounded-md border border-black/15 bg-[var(--color-paper)] px-4 py-3 text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-accent)] dark:border-white/15"
        />
        {/*
          Honeypot: hidden from sighted and screen-reader users, present in
          the DOM and the tab order removed. A bot that fills every field it
          can find fills this one; a person never does. See worker/waitlist.ts.
        */}
        <div className="absolute h-0 w-0 overflow-hidden opacity-0">
          <label htmlFor={honeypotId}>Company</label>
          <input
            id={honeypotId}
            name="company"
            type="text"
            tabIndex={-1}
            autoComplete="off"
          />
        </div>
        {/*
          Channel attribution. The Worker only sees its own /api/waitlist URL,
          so the page reports where the visitor actually was. Filled by the
          browser at submit time; an empty value (no JavaScript) is fine and
          simply records the signup as direct.
        */}
        <input type="hidden" name="page_url" value={pageUrl} />
        <input type="hidden" name="page_referrer" value={pageReferrer} />
        <button
          type="submit"
          disabled={status === 'submitting'}
          className="shrink-0 rounded-md bg-[var(--color-accent)] px-6 py-3 font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {status === 'submitting' ? 'Joining…' : 'Join the waitlist'}
        </button>
      </div>
      {/*
        Auto-render mode: the api.js script (loaded in root.tsx) finds this
        div on its own and turns it into the interactive widget, injecting
        its token as a `cf-turnstile-response` field into this same <form> --
        no ref, no manual render() call, and it flows through unchanged
        whether the browser submits via the fetch/FormData path above or the
        plain POST fallback below it (see worker/waitlist.ts).
      */}
      <div
        className="cf-turnstile mt-3"
        data-sitekey={SITE.turnstileSiteKey}
        data-action="waitlist"
      />
      {status === 'error' && message ? (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
          {message}
        </p>
      ) : null}
      <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
        No spam. One email when Vibld opens up. Unsubscribe any time.
      </p>
    </form>
  );
}
