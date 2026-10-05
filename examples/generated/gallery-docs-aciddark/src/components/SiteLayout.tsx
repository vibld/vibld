import type { ReactNode } from 'react';
import { Menu, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

const navItems = [
  { href: '/', label: 'Home' },
  { href: '/installation', label: 'Installation' },
  { href: '/quick-start', label: 'Quick start' },
  { href: '/reference', label: 'Reference' },
];

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname.startsWith(href);
}

export function SiteLayout({ children }: { children: ReactNode }) {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  const showSidebar = pathname !== '/';

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="/" className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-primary" aria-hidden="true" />
            <span className="font-display text-lg font-semibold tracking-tight">Ion CLI</span>
          </a>

          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={`px-3 py-2 rounded-md text-sm transition-colors duration-150 ${
                  isActive(pathname, item.href)
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                }`}
              >
                {item.label}
              </a>
            ))}
            <Button asChild size="sm" className="ml-2">
              <a href="/quick-start">Get started</a>
            </Button>
          </nav>

          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72">
              <SheetHeader>
                <SheetTitle>Navigation</SheetTitle>
                <SheetDescription>Ion CLI documentation</SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-1 p-4">
                {navItems.map((item) => (
                  <SheetClose key={item.href} asChild>
                    <a
                      href={item.href}
                      className={`px-3 py-2 rounded-md text-sm ${
                        isActive(pathname, item.href)
                          ? 'bg-muted text-foreground'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                      }`}
                    >
                      {item.label}
                    </a>
                  </SheetClose>
                ))}
                <SheetClose asChild>
                  <Button asChild className="mt-2">
                    <a href="/quick-start">Get started</a>
                  </Button>
                </SheetClose>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      {showSidebar ? (
        <div className="mx-auto flex max-w-7xl">
          <aside className="hidden lg:block w-64 shrink-0 border-r border-border py-8 pr-4 sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto">
            <nav className="flex flex-col gap-1">
              {navItems.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-2 rounded-md text-sm ${
                    isActive(pathname, item.href)
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                  }`}
                >
                  {item.label}
                </a>
              ))}
            </nav>
          </aside>
          <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-10">
            {children}
          </main>
        </div>
      ) : (
        <main>{children}</main>
      )}
    </div>
  );
}
