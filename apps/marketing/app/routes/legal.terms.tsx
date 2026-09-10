import { LegalPage } from '../components/SiteChrome';
import { LEGAL_DOCS, SITE, metaFor } from '../site';

const DOC = LEGAL_DOCS.find((d) => d.slug === 'terms')!;
const UPDATED = '2026-09-10';

export function meta() {
  return metaFor('/legal/terms');
}

export default function Terms() {
  return (
    <LegalPage title={DOC.label} updated={UPDATED}>
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) are an agreement between
        you and {SITE.legalEntity} (&ldquo;{SITE.name}&rdquo;, &ldquo;
        we&rdquo;, &ldquo;us&rdquo;), a Georgia limited liability company with a
        mailing address of {SITE.mailingAddress}. They govern your use of this
        website and, once available, the Vibld application-building service
        (together, the &ldquo;Service&rdquo;).
      </p>
      <p>
        By using the Service you agree to these Terms. If you do not agree, do
        not use the Service.
      </p>

      <h2>1. What the Service is today</h2>
      <p>
        Vibld is currently in a pre-launch phase. This site collects email
        addresses from people who want to be notified when Vibld opens for use.
        Joining the waitlist is not a purchase, a subscription, a reservation,
        or a guarantee of access, of any particular price, or of any feature. We
        may invite people from the waitlist in any order, or not at all.
      </p>

      <h2>2. Who may use the Service</h2>
      <p>
        You must be at least 18 years old, or the age of majority in your
        jurisdiction, to join the waitlist or use the Service. The Service is
        offered to users located in the United States; see our{' '}
        <a href="/legal/privacy">Privacy Policy</a> for more on this.
      </p>

      <h2>3. Your account and content</h2>
      <p>
        When account creation and project generation become available, a
        separate or updated version of these Terms will describe account
        registration, acceptable use of generated content, and ownership of what
        you build. As a general principle we intend for you to own the code
        Vibld generates for you, subject to the licenses of any third-party or
        open-source components it includes.
      </p>

      <h2>4. Acceptable use</h2>
      <p>
        You agree not to use the Service, including the waitlist form, to submit
        false information, to harvest other people&apos;s data, to transmit
        malicious code, or to attempt to disrupt or gain unauthorized access to
        the Service. See our{' '}
        <a href="/legal/acceptable-use">Acceptable Use Policy</a> for the full
        list once the product is live.
      </p>

      <h2>5. Intellectual property</h2>
      <p>
        The Vibld name, logo, and this website&apos;s design and content are
        owned by {SITE.legalEntity} or its licensors. The Vibld core software is
        separately licensed under the Apache License, Version 2.0; see our{' '}
        <a href="/legal/licenses">Open-Source Notices</a> page. Nothing here
        grants you rights to our trademarks.
      </p>

      <h2>6. Copyright complaints (DMCA)</h2>
      <p>
        If you believe content associated with the Service infringes your
        copyright, send a notice to{' '}
        <a href={`mailto:${SITE.emails.legal}`}>{SITE.emails.legal}</a> that
        identifies the copyrighted work, the material you claim is infringing
        and where it is located, your contact information, and a statement,
        under penalty of perjury, that you are authorized to act and that the
        information in your notice is accurate. We will designate an agent for
        service under 17 U.S.C. § 512(c) and publish that agent&apos;s
        registration here once it is on file with the U.S. Copyright Office;
        until then, notices to the address above will be treated as a DMCA
        notice.
      </p>

      <h2>7. Disclaimers</h2>
      <p>
        The Service, including this website, is provided &ldquo;as is&rdquo; and
        &ldquo;as available&rdquo; without warranties of any kind, express or
        implied, including warranties of merchantability, fitness for a
        particular purpose, and non-infringement, to the fullest extent
        permitted by law.
      </p>

      <h2>8. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, {SITE.legalEntity} will not be
        liable for any indirect, incidental, special, consequential, or punitive
        damages, or any loss of profits or data, arising from your use of, or
        inability to use, the Service.
      </p>

      <h2>9. Governing law and venue</h2>
      <p>
        These Terms are governed by the laws of {SITE.governingLaw}, without
        regard to its conflict-of-laws rules. Any dispute arising from these
        Terms or the Service will be brought exclusively in the state or federal
        courts sitting in Gwinnett County, Georgia, and you consent to personal
        jurisdiction there.
      </p>

      <h2>10. Changes to these Terms</h2>
      <p>
        We may update these Terms as the Service develops. We will update the
        &ldquo;Last updated&rdquo; date above when we do, and for material
        changes we will make reasonable efforts to notify waitlist members by
        email before the changes take effect.
      </p>

      <h2>11. Contact</h2>
      <p>
        Questions about these Terms can be sent to{' '}
        <a href={`mailto:${SITE.emails.legal}`}>{SITE.emails.legal}</a> or to
        our mailing address above.
      </p>
    </LegalPage>
  );
}
