import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ShoppingCart } from 'lucide-react';
import { Sheet, SheetTrigger } from '@/components/ui/sheet';
import { buttonVariants } from '@/components/ui/button';
import { useCart } from '@/lib/cart';
import CartSheet from '@/components/CartSheet';
import { cn } from '@/lib/utils';

export default function SiteHeader() {
  const { totalCount } = useCart();

  return (
    <header className="fixed top-0 inset-x-0 z-40 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="font-display text-xl font-bold tracking-tight text-foreground">
          Acid Wick
        </Link>
        <Sheet>
          <SheetTrigger
            className={cn(buttonVariants({ variant: 'default', size: 'icon' }), 'relative')}
          >
            <ShoppingCart className="h-5 w-5" />
            <span className="sr-only">Open cart</span>
            {totalCount > 0 && (
              <motion.span
                key={totalCount}
                className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{
                  scale: [1, 1.15, 1],
                  opacity: 1,
                  boxShadow: [
                    '0 0 0px rgba(232,255,82,0)',
                    '0 0 12px rgba(232,255,82,0.35)',
                    '0 0 0px rgba(232,255,82,0)',
                  ],
                }}
                transition={{ duration: 0.15, times: [0, 0.5, 1], repeat: 1 }}
              >
                {totalCount}
              </motion.span>
            )}
          </SheetTrigger>
          <CartSheet />
        </Sheet>
      </div>
    </header>
  );
}
