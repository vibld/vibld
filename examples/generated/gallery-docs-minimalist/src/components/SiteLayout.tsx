import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

const navLinkBase =
  'text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm';

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-navheight max-w-5xl items-center justify-between px-gutter">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              cn(
                'font-display text-lg font-semibold',
                isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm'
              )
            }
          >
            Basalt CLI
          </NavLink>
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                cn(navLinkBase, isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground')
              }
            >
              Home
            </NavLink>
            <NavLink
              to="/installation"
              className={({ isActive }) =>
                cn(navLinkBase, isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground')
              }
            >
              Installation
            </NavLink>
            <NavLink
              to="/quick-start"
              className={({ isActive }) =>
                cn(navLinkBase, isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground')
              }
            >
              Quick start
            </NavLink>
            <NavLink
              to="/commands"
              className={({ isActive }) =>
                cn(navLinkBase, isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground')
              }
            >
              Command reference
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-gutter">{children}</main>
      <footer className="border-t border-border py-6 text-center text-small text-muted-foreground">
        Basalt CLI is open source. MIT licensed.
      </footer>
    </div>
  );
}
