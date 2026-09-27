import { Mail, Phone } from 'lucide-react';
import { PRACTICE } from '@/lib/hours';

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-secondary">
      <div className="mx-auto max-w-300 px-6 py-14 lg:px-12">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <h2 className="font-display text-title font-medium">Fernbank Dental</h2>
            <p className="mt-2 max-w-xs text-muted-foreground">Family and general dentistry on Fernbank Road, Millbrook.</p>
          </div>
          <div>
            <h2 className="font-medium">Visit</h2>
            <address className="mt-2 text-muted-foreground not-italic">
              <span className="block">{PRACTICE.street}</span>
              <span className="block">{PRACTICE.town}</span>
            </address>
          </div>
          <div>
            <h2 className="font-medium">Contact</h2>
            <ul className="mt-1">
              <li>
                <a
                  href={PRACTICE.phoneHref}
                  className="inline-flex min-h-11 items-center gap-2 text-muted-foreground underline-offset-4 transition-colors duration-400 ease-organic hover:text-foreground hover:underline"
                >
                  <Phone aria-hidden="true" className="size-4" />
                  {PRACTICE.phone}
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${PRACTICE.email}`}
                  className="inline-flex min-h-11 items-center gap-2 break-all text-muted-foreground underline-offset-4 transition-colors duration-400 ease-organic hover:text-foreground hover:underline"
                >
                  <Mail aria-hidden="true" className="size-4 shrink-0" />
                  {PRACTICE.email}
                </a>
              </li>
            </ul>
          </div>
        </div>
        <p className="mt-12 border-t border-border pt-6 text-small text-muted-foreground">
          © {year} Fernbank Dental. Demonstration site with sample details.
        </p>
      </div>
    </footer>
  );
}
