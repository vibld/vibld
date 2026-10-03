import { useState } from 'react';
import { Menu, X } from 'lucide-react';

const navLinks = [
  { href: '#work', label: 'Work' },
  { href: '#about', label: 'About' },
  { href: '#contact', label: 'Contact' },
];

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-background border-b-[3px] border-foreground">
      <div className="flex h-[72px] items-center justify-between px-[var(--gutter)]">
        <a
          href="#top"
          className="font-display text-2xl tracking-[-0.02em]"
          aria-label="Mara Voss, back to top"
        >
          MV
        </a>
        <nav className="hidden md:flex items-center gap-8" aria-label="Primary navigation">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="block py-2 px-1 text-sm font-bold uppercase tracking-[0.08em] transition-none hover:bg-primary"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <button
          type="button"
          className="md:hidden flex items-center justify-center w-11 h-11 border-[3px] border-foreground shadow-hard-sm"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
        </button>
      </div>
      {menuOpen && (
        <div
          id="mobile-menu"
          className="md:hidden absolute top-[72px] left-0 right-0 bg-background border-b-[3px] border-foreground"
        >
          <nav className="flex flex-col px-[var(--gutter)] py-4" aria-label="Mobile navigation">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="py-3 text-sm font-bold uppercase tracking-[0.08em] hover:bg-primary px-2"
                onClick={() => setMenuOpen(false)}
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
