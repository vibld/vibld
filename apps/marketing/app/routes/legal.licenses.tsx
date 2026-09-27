import { LegalPage } from '../components/SiteChrome';
import { LEGAL_DOCS, SITE, metaFor } from '../site';

const DOC = LEGAL_DOCS.find((d) => d.slug === 'licenses')!;
const UPDATED = '2026-09-27';

/**
 * The self-hosted typefaces (app.css), stated as facts: the family, the
 * copyright line exactly as its licence file gives it, the licence named in
 * that file, and where the file is served. `test/fonts.test.ts` checks each
 * copyright line against the file it quotes.
 */
const FONTS = [
  {
    family: 'Bricolage Grotesque',
    package: '@fontsource-variable/bricolage-grotesque 5.3.0',
    copyright:
      'Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage)',
    licence: '/fonts/BricolageGrotesque-OFL.txt',
  },
  {
    family: 'Hanken Grotesk',
    package: '@fontsource-variable/hanken-grotesk 5.3.0',
    copyright:
      'Copyright 2021 The Hanken Grotesk Project Authors (https://github.com/marcologous/hanken-grotesk)',
    licence: '/fonts/HankenGrotesk-OFL.txt',
  },
  {
    family: 'JetBrains Mono',
    package: '@fontsource-variable/jetbrains-mono 5.3.0',
    copyright:
      'Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)',
    licence: '/fonts/JetBrainsMono-OFL.txt',
  },
];

export function meta() {
  return metaFor('/legal/licenses');
}

export default function Licenses() {
  return (
    <LegalPage title={DOC.label} updated={UPDATED}>
      <p>
        vibld is built on open-source foundations, and its own source will be
        published under a dual-license structure. This page explains what that
        means for the core project, for starter templates, and for what you
        build with vibld.
      </p>

      <h2>The vibld core</h2>
      <p>
        The vibld core (the builder, its provider integrations, and the platform
        code) is licensed under the{' '}
        <a
          href="https://www.apache.org/licenses/LICENSE-2.0"
          rel="noopener noreferrer"
        >
          Apache License, Version 2.0
        </a>
        . The source is not public yet. It will be published at{' '}
        <a href={SITE.repoUrl} rel="noopener noreferrer">
          github.com/vibld/vibld
        </a>
        , with its{' '}
        <a href={`${SITE.repoUrl}/blob/main/LICENSE`} rel="noopener noreferrer">
          LICENSE
        </a>{' '}
        and{' '}
        <a href={`${SITE.repoUrl}/blob/main/NOTICE`} rel="noopener noreferrer">
          NOTICE
        </a>{' '}
        files. vibld intends to keep a complete, single-user version of the
        builder available and self-hostable outside the hosted product: saving
        your work, connecting Git, bringing your own model keys, and exporting
        your project are not features locked behind a paid plan.
      </p>

      <h2>Starter templates</h2>
      <p>
        Reusable starter-template source that vibld generates from (for example,
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
        Code that vibld generates for you is yours to license as you choose,
        subject to the obligations of any third-party or open-source components
        it includes. vibld does not claim ownership of, or require attribution
        in, projects you build and export.
      </p>

      <h2>Third-party components</h2>
      <p>
        vibld and this website depend on a number of open-source packages, each
        under its own license. The complete, current list is the
        repository&apos;s package manifests and lockfile, rather than a copy
        here that could fall out of date.
      </p>
      <p>
        Some of vibld&apos;s source adapts material from other open-source
        projects.{' '}
        <a
          href={`${SITE.repoUrl}/blob/main/THIRD_PARTY_NOTICES.md`}
          rel="noopener noreferrer"
        >
          THIRD_PARTY_NOTICES.md
        </a>{' '}
        lists projects whose material is adapted, the files that credit each
        one, and each listed project&apos;s licence text as that project
        publishes it.
      </p>

      <h2>Typefaces on this website</h2>
      <p>
        This website serves three typefaces from its own origin. The files were
        copied from the Fontsource packages named below, and each package’s
        licence file is served unchanged beside the fonts.
      </p>
      {/*
        A list rather than a table: the copyright lines are long, and four
        columns of them scrolled sideways on a phone.
      */}
      <ul>
        {FONTS.map((font) => (
          <li key={font.family}>
            <strong>{font.family}</strong> (<code>{font.package}</code>).{' '}
            {font.copyright}. SIL Open Font License 1.1. Licence text:{' '}
            <a href={font.licence} className="break-all">
              {font.licence}
            </a>
          </li>
        ))}
      </ul>

      <h2>Questions</h2>
      <p>
        Licensing questions can be sent to{' '}
        <a href={`mailto:${SITE.emails.legal}`}>{SITE.emails.legal}</a>.
      </p>
    </LegalPage>
  );
}
