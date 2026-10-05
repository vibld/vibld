import type { ReactNode } from 'react';
import { Flame } from 'lucide-react';
import { CartSheet } from '@/components/CartSheet';
import { useCart } from '@/context/CartContext';

interface SiteLayoutProps {
  children: ReactNode;
}

export function SiteLayout({ children }: SiteLayoutProps) {
  const { itemCount } = useCart();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a
            href="#/"
            className="flex items-center gap-2 text-lg font-semibold tracking-tight"
          >
            <Flame className="h-5 w-5 text-primary" aria-hidden="true" />
            <span>Wick and Wax</span>
          </a>

          <nav className="flex items-center gap-6 text-sm">
            <a
              href="#/"
              className="text-foreground/70 transition-colors hover:text-foreground"
            >
              Home
            </a>
            <a
              href="#/products"
              className="text-foreground/70 transition-colors hover:text-foreground"
            >
              All candles
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {itemCount} item{itemCount === 1 ? '' : 's'}
            </span>
            <CartSheet />
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="border-t py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-4 sm:flex-row sm:items-center sm:px-6 lg:px-8">
          <p className="text-sm text-muted-foreground">
            Wick and Wax, small-batch candles poured by hand.
          </p>
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
