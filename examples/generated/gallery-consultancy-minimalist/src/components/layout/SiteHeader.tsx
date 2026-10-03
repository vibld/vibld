import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Menu, X } from 'lucide-react';

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <a href="#top" className="font-display text-xl font-semibold tracking-tight text-foreground" aria-label="Morrow & Co. home">
          Morrow &amp; Co.
        </a>
        <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
          <a href="#services" className="rounded-sm px-1 py-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Services
          </a>
          <a href="#cases" className="rounded-sm px-1 py-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Case studies
          </a>
          <a href="#contact" className="rounded-sm px-1 py-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Contact
          </a>
        </nav>
        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center rounded-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          onClick={() => setMenuOpen((prev) => !prev)}
        >
          {menuOpen ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
        </button>
      </div>
      <AnimatePresence>
        {menuOpen && (
          <motion.nav
            id="mobile-menu"
            className="border-t border-border bg-background md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            aria-label="Mobile"
          >
            <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">
              <a href="#services" onClick={() => setMenuOpen(false)} className="rounded-sm px-1 py-2 text-base text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Services
              </a>
              <a href="#cases" onClick={() => setMenuOpen(false)} className="rounded-sm px-1 py-2 text-base text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Case studies
              </a>
              <a href="#contact" onClick={() => setMenuOpen(false)} className="rounded-sm px-1 py-2 text-base text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Contact
              </a>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
