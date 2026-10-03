import type { ReactNode } from 'react';
import { Mail } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SiteLayoutProps {
  children: ReactNode;
}

export default function SiteLayout({ children }: SiteLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="max-w-[var(--page-max)] mx-auto px-[var(--gutter)] py-4 w-full flex items-center justify-between">
        <a
          href="#/"
          className={cn(
            'font-display text-xl font-medium tracking-tight text-foreground',
            'hover:text-primary transition-colors duration-150'
          )}
        >
          Mara Voss
        </a>
        <nav className="flex items-center gap-6">
          <a
            href="#/"
            className={cn(
              'text-sm font-medium text-foreground',
              'hover:text-primary transition-colors duration-150'
            )}
          >
            Home
          </a>
          <a
            href="#/contact"
            className={cn(
              'text-sm font-medium text-foreground',
              'hover:text-primary transition-colors duration-150'
            )}
          >
            Contact
          </a>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="max-w-[var(--page-max)] mx-auto px-[var(--gutter)] py-8 w-full flex items-center justify-between border-t border-border">
        <p className="text-sm text-muted-foreground">© 2024 Mara Voss</p>
        <a
          href="mailto:hello@example.com"
          className={cn(
            'flex items-center gap-2 text-sm text-muted-foreground',
            'hover:text-primary transition-colors duration-150'
          )}
        >
          <Mail className="size-4" aria-hidden="true" />
          hello@example.com
        </a>
      </footer>
    </div>
  );
}
