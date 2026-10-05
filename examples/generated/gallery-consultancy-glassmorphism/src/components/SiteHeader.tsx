import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EASE_OUT } from '@/lib/motion';

export default function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const navItems = [
    { href: '#services', label: 'Services' },
    { href: '#case-studies', label: 'Case studies' },
    { href: '#contact', label: 'Contact' },
  ];

  return (
    <header id="top" className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <a href="#top" className="font-display text-xl font-semibold tracking-tight text-foreground">
          Crestline
        </a>
        <nav aria-label="Main navigation" className="hidden items-center gap-8 md:flex">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="md:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
          </Button>
        </div>
      </div>
      <AnimatePresence>
        {menuOpen && (
          <motion.nav
            id="mobile-menu"
            aria-label="Mobile navigation"
            className="glass-panel mx-4 mb-4 overflow-hidden rounded-2xl p-2 md:hidden"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15, ease: EASE_OUT }}
          >
            <div className="flex flex-col">
              {navItems.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg px-4 py-3 text-base font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  {item.label}
                </a>
              ))}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
