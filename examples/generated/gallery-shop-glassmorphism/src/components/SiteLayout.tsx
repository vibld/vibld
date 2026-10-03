import { ShoppingCart, Flame } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useCart } from '@/context/CartContext';
import type { ReactNode } from 'react';

interface SiteLayoutProps {
  currentPage: 'home' | 'cart';
  onNavigate: (page: 'home' | 'cart') => void;
  onShopClick?: () => void;
  children: ReactNode;
}

export function SiteLayout({ currentPage, onNavigate, onShopClick, children }: SiteLayoutProps) {
  const { totalItems } = useCart();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-[var(--glass)] backdrop-blur-lg">
        <div className="container mx-auto max-w-7xl px-6 flex h-16 items-center justify-between">
          <button
            onClick={() => onNavigate('home')}
            className="flex items-center gap-2 text-lg font-semibold text-foreground cursor-pointer hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md px-2 py-1"
            aria-label="Ember & Wick home"
          >
            <Flame className="h-6 w-6 text-primary" aria-hidden="true" />
            <span className="font-bold tracking-tight">Ember & Wick</span>
          </button>
          <nav className="hidden md:flex items-center gap-2">
            <Button
              variant={currentPage === 'home' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onNavigate('home')}
              className="h-11 px-4"
            >
              Home
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (onShopClick) {
                  onShopClick();
                } else {
                  onNavigate('home');
                }
              }}
              className="h-11 px-4"
            >
              Shop
            </Button>
          </nav>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onNavigate('cart')}
            className={cn(
              'relative h-11 w-11 rounded-full',
              currentPage === 'cart' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
            aria-label={`Cart with ${totalItems} items`}
          >
            <ShoppingCart className="h-5 w-5" aria-hidden="true" />
            {totalItems > 0 && (
              <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold px-1">
                {totalItems}
              </span>
            )}
          </Button>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border bg-[var(--glass)] backdrop-blur-lg">
        <div className="container mx-auto max-w-7xl px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Your cart is stored locally in your browser. No data leaves your device.
          </p>
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Ember & Wick. Hand-poured in small batches.
          </p>
        </div>
      </footer>
    </div>
  );
}
