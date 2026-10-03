import { Menu } from 'lucide-react';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';

const navLinks = [
  { href: '#installation', label: 'Installation' },
  { href: '#quick-start', label: 'Quick start' },
  { href: '#command-reference', label: 'Command reference' },
];

export default function SiteHeader() {
  return (
    <header className='sticky top-0 z-40 w-full border-b-2 border-border bg-background'>
      <a
        href='#main'
        className='sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground'
      >
        Skip to content
      </a>
      <div className='flex h-16 items-center justify-between px-[var(--space-gutter)] max-w-[1200px] mx-auto'>
        <a href='#hero' className='font-display text-2xl leading-none tracking-tight text-foreground'>
          rig
        </a>
        <nav className='hidden md:flex items-center gap-8' aria-label='Main navigation'>
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className='text-sm font-bold uppercase tracking-wider text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
            >
              {link.label}
            </a>
          ))}
        </nav>
        <Sheet>
          <SheetTrigger asChild>
            <button
              className='md:hidden inline-flex items-center justify-center size-11 border-2 border-border bg-card hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
              aria-label='Open navigation menu'
            >
              <Menu className='size-5' />
            </button>
          </SheetTrigger>
          <SheetContent side='right' className='w-80'>
            <SheetHeader>
              <SheetTitle className='font-display text-2xl'>rig</SheetTitle>
              <SheetDescription className='sr-only'>Navigation links</SheetDescription>
            </SheetHeader>
            <nav className='flex flex-col gap-6 mt-8' aria-label='Mobile navigation'>
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className='text-lg font-bold text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                >
                  {link.label}
                </a>
              ))}
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
