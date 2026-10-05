import type { ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from '@/components/ui/sheet';

const navItems = [
  { label: 'Home', href: '#/' },
  { label: 'Services', href: '#/services' },
  { label: 'Case studies', href: '#/case-studies' },
  { label: 'Contact', href: '#/contact' },
];

export default function SiteLayout({ children }: { children: ReactNode }) {
  const currentYear = new Date().getFullYear();
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="#/" className="font-display text-xl font-semibold tracking-tight text-foreground">
            Ashford &amp; Reed
          </a>
          <nav className="hidden md:flex md:items-center md:gap-8" aria-label="Primary">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="md:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Open menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right">
                <SheetHeader>
                  <SheetTitle>Navigation</SheetTitle>
                  <SheetDescription>Find your way around the site.</SheetDescription>
                </SheetHeader>
                <nav className="mt-6 flex flex-col gap-4" aria-label="Mobile">
                  {navItems.map((item) => (
                    <SheetClose asChild key={item.href}>
                      <a
                        href={item.href}
                        className="rounded-md px-3 py-2 text-base font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        {item.label}
                      </a>
                    </SheetClose>
                  ))}
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border bg-background">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-display text-lg font-semibold text-foreground">Ashford &amp; Reed</p>
            <p className="text-sm text-muted-foreground">
              &copy; {currentYear} Ashford &amp; Reed. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
