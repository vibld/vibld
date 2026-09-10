import { LegalPage } from '../components/SiteChrome';
import { LEGAL_DOCS, SITE, metaFor } from '../site';

const DOC = LEGAL_DOCS.find((d) => d.slug === 'licenses')!;
const UPDATED = '2026-09-10';

export function meta() {
  return metaFor('/legal/licenses');
}

export default function Licenses() {
  return (
    <LegalPage title={DOC.label} updated={UPDATED}>
      <p>
        Vibld is built on open-source foundations, and its own source is
        published openly under a dual-license structure. This page explains what
        that means for the core project, for starter templates, and for what you
        build with Vibld.
      </p>

      <h2>The Vibld core</h2>
      <p>
        The Vibld core — the builder, its provider integrations, and the
        platform code — is licensed under the{' '}
        <a
          href="https://www.apache.org/licenses/LICENSE-2.0"
          rel="noopener noreferrer"
        >
          Apache License, Version 2.0
        </a>
        . The source is public at{' '}
        <a href="https://github.com/vibld/vibld" rel="noopener noreferrer">
          github.com/vibld/vibld
        </a>
        , including its{' '}
        <a
          href="https://github.com/vibld/vibld/blob/main/LICENSE"
          rel="noopener noreferrer"
        >
          LICENSE
        </a>{' '}
        file. Vibld intends to keep a complete, single-user version of the
        builder available and self-hostable outside the hosted product — saving
        your work, connecting Git, bringing your own model keys, and exporting
        your project are not features locked behind a paid plan.
      </p>

      <h2>Starter templates</h2>
      <p>
        Reusable starter-template source that Vibld generates from (for example,
        the marketing-site template this website itself is an instance of) is
        separately licensed under the{' '}
        <a href="https://opensource.org/license/mit/" rel="noopener noreferrer">
          MIT License
        </a>{' '}
        at its own boundary within the repository, with upstream notices
        preserved.
      </p>

      <h2>What you build</h2>
      <p>
        Code that Vibld generates for you is yours to license as you choose,
        subject to the obligations of any third-party or open-source components
        it includes. Vibld does not claim ownership of, or require attribution
        in, projects you build and export.
      </p>

      <h2>Third-party components</h2>
      <p>
        Vibld and this website depend on a number of open-source packages, each
        under its own license. A complete, current list is available in the
        repository&apos;s package manifests and lockfile at the link above
        rather than duplicated here, so it never falls out of date.
      </p>

      <h2>Questions</h2>
      <p>
        Licensing questions can be sent to{' '}
        <a href={`mailto:${SITE.emails.legal}`}>{SITE.emails.legal}</a>.
      </p>
    </LegalPage>
  );
}
