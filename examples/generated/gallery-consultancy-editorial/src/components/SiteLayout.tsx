import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Menu, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { fadeIn } from '@/lib/motion';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', label: 'Home' },
  { to: '/services', label: 'Services' },
  { to: '/case-studies', label: 'Case studies' },
  { to: '/contact', label: 'Contact' },
];

export default function SiteLayout({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className='flex min-h-screen flex-col bg-background'>
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className='sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur'
      >
        <div className='mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8'>
          <Link to='/' className='font-display text-2xl font-bold tracking-tight text-primary'>
            Aldermere
          </Link>
          <nav className='hidden items-center gap-8 md:flex' aria-label='Primary'>
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'text-sm font-medium transition-colors hover:text-foreground',
                    isActive ? 'text-primary font-semibold' : 'text-muted-foreground'
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className='flex items-center gap-2'>
            <Button asChild variant='default' size='sm' className='hidden md:inline-flex'>
              <Link to='/contact'>Contact us</Link>
            </Button>
            <Button
              variant='ghost'
              size='icon'
              className='md:hidden'
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X size={20} aria-hidden='true' /> : <Menu size={20} aria-hidden='true' />}
            </Button>
          </div>
        </div>
        <AnimatePresence>
          {menuOpen && (
            <motion.nav
              initial='hidden'
              animate='show'
              exit='hidden'
              variants={fadeIn}
              className='border-t border-border bg-background px-4 pb-4 pt-2 md:hidden'
              aria-label='Mobile'
            >
              <div className='flex flex-col items-start gap-2'>
                {navItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        'rounded-md px-3 py-2 text-base font-medium transition-colors hover:bg-muted hover:text-foreground',
                        isActive ? 'bg-muted text-primary font-semibold' : 'text-muted-foreground'
                      )
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
                <Button asChild variant='default' size='sm' className='mt-2 w-full'>
                  <Link to='/contact' onClick={() => setMenuOpen(false)}>
                    Contact us
                  </Link>
                </Button>
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </motion.header>
      <main className='flex-1'>{children}</main>
      <footer className='border-t border-border bg-muted'>
        <div className='mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8'>
          <div>
            <p className='font-display text-xl font-bold text-primary'>Aldermere Consulting</p>
            <p className='mt-1 text-sm text-muted-foreground'>Clear thinking for complex organizations.</p>
          </div>
          <div className='flex flex-col gap-2 text-sm text-muted-foreground md:items-end'>
            <a href='mailto:hello@aldermereconsulting.com' className='hover:text-foreground'>
              hello@aldermereconsulting.com
            </a>
            <p>We respond within two business days.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
