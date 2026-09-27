import { Radar } from 'lucide-react';

const links = [
  { href: '#coverage', label: 'Coverage' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
  { href: '#contact', label: 'Contact' },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 md:flex-row md:items-center md:justify-between">
        <div>
          <a
            href="#top"
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md font-display text-lg font-semibold tracking-tight text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Radar className="size-5" aria-hidden="true" />
            Tripline
          </a>
          <p className="mt-1 max-w-md text-small text-muted-foreground">
            Tripline is a sample product made for this page. Its names, prices and data are illustrative.
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-1">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="inline-flex min-h-11 cursor-pointer items-center rounded-md px-3 text-small text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <p className="text-small text-muted-foreground">© 2025 Tripline</p>
      </div>
    </footer>
  );
}
