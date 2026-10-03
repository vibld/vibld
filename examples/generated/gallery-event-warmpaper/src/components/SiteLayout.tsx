import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/Button';
import { fadeIn } from '@/lib/motion';

const navLinks = [
  { href: '#lineup', label: 'Lineup' },
  { href: '#schedule', label: 'Schedule' },
  { href: '#tickets', label: 'Tickets' },
  { href: '#directions', label: 'Directions' },
];

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <motion.header
        variants={fadeIn}
        initial="hidden"
        animate="show"
        transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/85 backdrop-blur-sm"
      >
        <div className="mx-auto flex h-16 container-page items-center justify-between px-6">
          <a href="#top" className="font-display text-xl font-semibold tracking-tight text-foreground">
            Ember Table
          </a>
          <nav className="hidden md:flex items-center gap-1" aria-label="Main navigation">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="flex h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <Button asChild>
            <a href="#tickets">Get tickets</a>
          </Button>
        </div>
      </motion.header>

      <main>{children}</main>

      <footer className="border-t border-border py-12">
        <div className="mx-auto flex container-page flex-col gap-8 px-6 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <a href="#top" className="font-display text-xl font-semibold tracking-tight text-foreground">
              Ember Table
            </a>
            <p className="text-sm text-muted-foreground">
              A weekend for slow food and long tables.
            </p>
          </div>
          <div className="flex flex-col gap-4 md:flex-row md:gap-12">
            <nav className="flex flex-col gap-2" aria-label="Footer navigation">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="inline-flex h-11 items-center rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <div className="space-y-2 text-sm text-muted-foreground">
              <a
                href="mailto:hello@embertable.example"
                className="inline-flex h-11 items-center rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                hello@embertable.example
              </a>
              <p>© 2025 The Ember Table Festival</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
