import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import GlassPanel from '@/components/GlassPanel';
import { cn } from '@/lib/utils';

const navLinks = [
  { href: '#/install', label: 'Installation', hash: '#/install' },
  { href: '#/quick-start', label: 'Quick start', hash: '#/quick-start' },
  { href: '#/commands', label: 'Command reference', hash: '#/commands' },
];

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const [hash, setHash] = useState(() => window.location.hash || '#/');

  useEffect(() => {
    const handleHashChange = () => {
      setHash(window.location.hash || '#/');
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <GlassPanel
        initial={false}
        animate={false}
        className="sticky top-0 z-50 mx-auto mt-4 w-full max-w-6xl px-6 py-4"
      >
        <div className="flex items-center justify-between">
          <a href="#/" className="flex items-center gap-2 font-display text-lg font-semibold text-foreground transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md px-2 py-1">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 20L20 4M12 4H20V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Chisel
          </a>
          <nav className="hidden items-center gap-1 md:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={cn(
                  'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  hash === link.hash
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                {link.label}
              </a>
            ))}
          </nav>
          <a
            href="https://github.com/chisel-cli/chisel"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.02] active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
          >
            <Star className="size-4" aria-hidden="true" />
            Star on GitHub
          </a>
        </div>
      </GlassPanel>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        <p>Chisel is open source, licensed under MIT.</p>
      </footer>
    </div>
  );
}
