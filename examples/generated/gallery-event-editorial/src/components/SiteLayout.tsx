import { Link, Outlet } from 'react-router-dom';
import { Menu, Globe, Mail, AtSign } from 'lucide-react';
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

const navLinks = [
  { href: '/lineup', label: 'Lineup' },
  { href: '/schedule', label: 'Schedule' },
  { href: '/tickets', label: 'Tickets' },
  { href: '/directions', label: 'Directions' },
];

export function SiteLayout() {
  return (
    <div className='flex min-h-screen flex-col'>
      <header className='sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur'>
        <div className='mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8'>
          <Link to='/' className='font-display text-xl tracking-tight text-foreground'>
            Savor Weekend
          </Link>
          <nav className='hidden items-center gap-8 md:flex'>
            {navLinks.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                className='text-sm font-medium text-muted-foreground transition-colors hover:text-foreground'
              >
                {link.label}
              </Link>
            ))}
            <Button asChild size='sm'>
              <Link to='/tickets'>Get tickets</Link>
            </Button>
          </nav>
          <div className='md:hidden'>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant='ghost' size='icon' aria-label='Open menu' className='h-11 w-11'>
                  <Menu className='size-5' />
                </Button>
              </SheetTrigger>
              <SheetContent side='left' className='flex w-72 flex-col'>
                <SheetHeader className='text-left'>
                  <SheetTitle className='font-display text-lg'>Savor Weekend</SheetTitle>
                  <SheetDescription>Navigate the festival</SheetDescription>
                </SheetHeader>
                <nav className='mt-6 flex flex-col gap-2'>
                  {navLinks.map((link) => (
                    <SheetClose asChild key={link.href}>
                      <Link
                        to={link.href}
                        className='rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground'
                      >
                        {link.label}
                      </Link>
                    </SheetClose>
                  ))}
                </nav>
                <div className='mt-auto pt-6'>
                  <SheetClose asChild>
                    <Button asChild className='w-full'>
                      <Link to='/tickets'>Get tickets</Link>
                    </Button>
                  </SheetClose>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>
      <main className='flex-1'>
        <Outlet />
      </main>
      <footer className='border-t bg-muted/30'>
        <div className='mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-3 lg:px-8'>
          <div>
            <p className='font-display text-lg'>Savor Weekend</p>
            <p className='mt-2 text-sm text-muted-foreground'>August 15-17, 2026</p>
          </div>
          <div>
            <h2 className='text-sm font-semibold text-foreground'>Location</h2>
            <p className='mt-3 text-sm leading-relaxed text-muted-foreground'>
              4100 NE Ridgewood Ave
              <br />
              Portland, OR 97211
            </p>
          </div>
          <div>
            <h2 className='text-sm font-semibold text-foreground'>Follow</h2>
            <div className='mt-3 flex items-center gap-3'>
              <a
                href='#'
                aria-label='Visit our website'
                className='flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground'
              >
                <Globe className='size-5' />
              </a>
              <a
                href='#'
                aria-label='Email us'
                className='flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground'
              >
                <Mail className='size-5' />
              </a>
              <a
                href='#'
                aria-label='Follow on social media'
                className='flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground'
              >
                <AtSign className='size-5' />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
