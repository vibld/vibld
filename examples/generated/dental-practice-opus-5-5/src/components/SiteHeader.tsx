import { Phone, Sprout } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Lift } from '@/components/Lift';
import { PRACTICE } from '@/lib/hours';

const LINKS = [
  { href: '#services', label: 'Services' },
  { href: '#hours', label: 'Hours' },
  { href: '#directions', label: 'Directions' },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-300 flex-wrap items-center justify-between gap-x-6 px-6 py-3 lg:px-12">
        <a href="#top" className="inline-flex min-h-11 items-center gap-3 rounded-full">
          <span className="grid size-10 place-items-center rounded-blob bg-primary text-primary-foreground">
            <Sprout aria-hidden="true" className="size-5" />
          </span>
          <span className="font-display text-title font-medium">Fernbank Dental</span>
        </a>

        <nav aria-label="Main" className="order-last w-full md:order-none md:w-auto">
          <ul className="flex items-center justify-between gap-2 md:gap-8">
            {LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="group relative inline-flex min-h-11 items-center px-1 text-body font-medium text-foreground transition-colors duration-400 ease-organic hover:text-primary"
                >
                  {link.label}
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-1 bottom-2 h-px origin-left scale-x-0 bg-primary transition-transform duration-400 ease-organic group-hover:scale-x-100"
                  />
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <Lift>
          <Button asChild>
            <a href={PRACTICE.phoneHref} aria-label={`Call ${PRACTICE.phone}`}>
              <Phone aria-hidden="true" className="size-4" />
              <span className="sm:hidden">Call</span>
              <span className="hidden sm:inline">{PRACTICE.phone}</span>
            </a>
          </Button>
        </Lift>
      </div>
    </header>
  );
}
