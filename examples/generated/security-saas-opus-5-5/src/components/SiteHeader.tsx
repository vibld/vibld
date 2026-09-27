import { Radar } from 'lucide-react';

const links = [
  { href: '#coverage', label: 'Coverage', onMobile: false },
  { href: '#pricing', label: 'Pricing', onMobile: true },
  { href: '#faq', label: 'FAQ', onMobile: false },
  { href: '#contact', label: 'Contact', onMobile: true },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-scrim backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a
          href="#top"
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md font-display text-lg font-semibold tracking-tight text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Radar className="size-5" aria-hidden="true" />
          Tripline
        </a>
        <nav aria-label="Main">
          <ul className="flex items-center gap-1">
            {links.map((link) => (
              <li key={link.href} className={link.onMobile ? undefined : 'hidden md:block'}>
                <a
                  href={link.href}
                  className="inline-flex min-h-11 cursor-pointer items-center rounded-md px-3 text-small font-medium text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
