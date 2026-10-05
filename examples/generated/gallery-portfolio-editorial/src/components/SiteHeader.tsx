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

export function SiteHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
        <a
          href="#top"
          className="text-lg font-medium tracking-tight text-foreground transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Lena Voss
        </a>

        <nav
          className="hidden items-center gap-8 md:flex"
          aria-label="Main navigation"
        >
          <a
            href="#work"
            className="text-sm font-medium text-foreground transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Work
          </a>
          <a
            href="#about"
            className="text-sm font-medium text-foreground transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            About
          </a>
          <a
            href="#contact"
            className="text-sm font-medium text-foreground transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Contact
          </a>
        </nav>

        <div className="md:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[280px]">
              <SheetHeader>
                <SheetTitle className="text-left">Lena Voss</SheetTitle>
                <SheetDescription className="text-left">
                  Photography portfolio
                </SheetDescription>
              </SheetHeader>
              <nav
                className="mt-6 flex flex-col gap-4"
                aria-label="Mobile navigation"
              >
                <SheetClose asChild>
                  <a
                    href="#work"
                    className="text-base font-medium text-foreground transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    Work
                  </a>
                </SheetClose>
                <SheetClose asChild>
                  <a
                    href="#about"
                    className="text-base font-medium text-foreground transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    About
                  </a>
                </SheetClose>
                <SheetClose asChild>
                  <a
                    href="#contact"
                    className="text-base font-medium text-foreground transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    Contact
                  </a>
                </SheetClose>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
