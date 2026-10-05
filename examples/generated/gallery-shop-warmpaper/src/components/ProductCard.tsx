import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { useCart } from '@/lib/cart';
import { fadeUp } from '@/lib/motion';
import type { Product } from '@/lib/products';

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  const { addItem } = useCart();

  return (
    <motion.article
      variants={fadeUp}
      whileInView="show"
      initial="hidden"
      viewport={{ once: true, amount: 0.3 }}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.97 }}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-shadow duration-300 hover:shadow-md"
    >
      <div className={`flex h-40 items-center justify-center ${product.accentClass}`}>
        <p className="px-6 text-center text-xs uppercase tracking-widest text-foreground/70">
          {product.notes}
        </p>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-serif text-lg font-semibold leading-snug">{product.name}</h3>
          <span className="whitespace-nowrap font-medium text-foreground">${product.price}</span>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{product.description}</p>
        <div className="mt-auto pt-2">
          <Button onClick={() => addItem(product.id)} className="w-full cursor-pointer">
            Add to cart
          </Button>
        </div>
      </div>
    </motion.article>
  );
}
