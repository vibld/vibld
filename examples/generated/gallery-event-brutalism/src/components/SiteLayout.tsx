import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
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
  { to: '/lineup', label: 'Lineup' },
  { to: '/schedule', label: 'Schedule' },
  { to: '/tickets', label: 'Tickets' },
  { to: '/directions', label: 'Directions' },
];

export default function SiteLayout() {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b-2 border-foreground bg-background">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <Link
              to="/"
              className="font-display text-2xl font-black uppercase tracking-tight hover:text-primary"
            >
              <span className="text-primary">Cinder</span>
              <span className="text-yellow-500"> & </span>
              <span>Smoke</span>
            </Link>

            <nav className="hidden md:flex items-center gap-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `px-4 py-2 text-sm font-bold uppercase tracking-wider transition-none ${
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-secondary hover:text-foreground'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Open menu"
                  className="md:hidden"
                >
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-4/5 max-w-xs">
                <SheetHeader>
                  <SheetTitle className="font-display text-2xl uppercase">Menu</SheetTitle>
                  <SheetDescription>Navigate the festival</SheetDescription>
                </SheetHeader>
                <nav className="mt-6 flex flex-col gap-1">
                  {navItems.map((item) => (
                    <SheetClose key={item.to} asChild>
                      <NavLink
                        to={item.to}
                        className={({ isActive }) =>
                          `block px-4 py-3 text-lg font-bold uppercase tracking-wide border-2 border-transparent transition-none ${
                            isActive
                              ? 'bg-primary text-primary-foreground'
                              : 'hover:bg-secondary'
                          }`
                        }
                      >
                        {item.label}
                      </NavLink>
                    </SheetClose>
                  ))}
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      <footer className="border-t-2 border-foreground bg-foreground text-background">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <p className="font-display text-xl uppercase">Cinder & Smoke</p>
            <p className="mt-2 text-sm">A weekend food festival at the old rail yard.</p>
          </div>
          <div>
            <p className="font-bold uppercase">Quick links</p>
            <nav className="mt-2 flex flex-col gap-1">
              {navItems.map((item) => (
                <Link key={item.to} to={item.to} className="text-sm hover:text-primary">
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div>
            <p className="font-bold uppercase">Contact</p>
            <p className="mt-2 text-sm">info@cinderandsmoke.com</p>
            <p className="text-sm">(555) 123-4567</p>
          </div>
        </div>
        <div className="border-t border-white/20 py-4 text-center text-xs">
          © {new Date().getFullYear()} Cinder & Smoke Food Festival
        </div>
      </footer>
    </div>
  );
}
