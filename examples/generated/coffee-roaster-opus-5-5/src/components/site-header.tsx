import { Bean } from 'lucide-react';
import { cn } from '@/lib/utils';

const links = [
  { href: '#coffees', label: 'Coffees', always: true },
  { href: '#how', label: 'How it works', always: false },
  { href: '#reviews', label: 'Reviews', always: false },
  { href: '#faq', label: 'FAQ', always: true },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-nav backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-page items-center justify-between gap-4 px-5 md:px-10">
        <a href="#top" className="inline-flex min-h-11 items-center gap-2 rounded-sm">
          <Bean className="size-5 text-primary" aria-hidden="true" />
          <span className="font-display text-xl font-semibold tracking-[-0.01em]">Wrenfield</span>
          <span className="hidden text-base text-muted-foreground sm:inline">Coffee Roasters</span>
        </a>
        <nav aria-label="Main">
          <ul className="flex items-center gap-1">
            {links.map((link) => (
              <li key={link.href} className={cn(!link.always && 'hidden md:block')}>
                <a
                  href={link.href}
                  className="inline-flex min-h-11 cursor-pointer items-center rounded-pill px-3 text-base font-medium text-foreground transition-colors duration-150 hover:bg-muted active:bg-secondary md:px-4"
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
