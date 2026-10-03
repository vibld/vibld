import type { ReactNode } from 'react';

export function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a
            href="#top"
            className="inline-flex h-11 items-center text-sm font-medium tracking-tight text-foreground transition-colors hover:text-muted-foreground"
          >
            Alex Morgan
          </a>
          <nav className="flex items-center gap-1 sm:gap-2">
            <a
              href="#work"
              className="inline-flex h-11 items-center px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Work
            </a>
            <a
              href="#about"
              className="inline-flex h-11 items-center px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              About
            </a>
            <a
              href="#contact"
              className="inline-flex h-11 items-center px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Contact
            </a>
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer className="border-t border-border py-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Alex Morgan
          </p>
          <a
            href="mailto:hello@alexmorgan.photo"
            className="inline-flex h-11 items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            hello@alexmorgan.photo
          </a>
        </div>
      </footer>
    </div>
  );
}
