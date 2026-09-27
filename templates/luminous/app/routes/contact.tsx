import { useId, useState } from 'react';
import type { FormEvent } from 'react';

import { PageHead } from '../components/SiteChrome';
import { metaFor, routeFor } from '../site';

export function meta() {
  return metaFor('/contact');
}

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
  const teamId = useId();
  const teamHintId = useId();
  const detailId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <>
      <PageHead
        kicker="Contact"
        title="See it working"
        emphasis="on your own feedback"
        lead={route.description}
      />
      <section className="page-body" aria-labelledby="form-title">
        <div className="wrap">
          <div className="form-card">
            <h2 id="form-title" className="text-2xl font-bold tracking-tight">
              Tell us where your feedback lives
            </h2>
            <p className="notice mt-4" role="note">
              <strong>This form is a demonstration.</strong> Nothing you enter
              is sent anywhere, stored, or read by a person. Connect it to a
              real endpoint before using this site to collect enquiries.
            </p>

            <form className="mt-6 space-y-5" onSubmit={handleSubmit} noValidate>
              <div className="field">
                <label htmlFor={nameId}>Your name</label>
                <input
                  id={nameId}
                  name="name"
                  type="text"
                  autoComplete="name"
                />
              </div>

              <div className="field">
                <label htmlFor={emailId}>Work email</label>
                <input
                  id={emailId}
                  name="email"
                  type="email"
                  autoComplete="email"
                />
              </div>

              <div className="field">
                <label htmlFor={teamId}>How many people are on the team?</label>
                <input
                  id={teamId}
                  name="team"
                  type="text"
                  inputMode="numeric"
                  aria-describedby={teamHintId}
                />
                <p className="hint" id={teamHintId}>
                  A rough number is fine. It decides which plan we show you.
                </p>
              </div>

              <div className="field">
                <label htmlFor={detailId}>
                  Where does your feedback arrive today?
                </label>
                <textarea id={detailId} name="detail" rows={4} />
              </div>

              <button type="submit" className="btn btn-warm">
                Send request
              </button>

              {/*
                Announced to a screen reader when it appears, because a visual
                confirmation below a button is invisible to someone who cannot
                see the page change.
              */}
              <p aria-live="polite" className="text-[15px]">
                {submitted
                  ? 'Nothing was sent. This form is a demonstration and has no backend.'
                  : ''}
              </p>
            </form>
          </div>
        </div>
      </section>
    </>
  );
}
