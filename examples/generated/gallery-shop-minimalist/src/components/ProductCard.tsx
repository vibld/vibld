import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { fade } from '@/lib/motion';
import type { Product } from '@/lib/products';

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  return (
    <motion.div
      variants={fade}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.3 }}
    >
      <Link
        to={`/product/${product.id}`}
        className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Card className="h-full overflow-hidden rounded-sm border border-border bg-background transition-opacity duration-150 hover:opacity-90">
          <div
            className="aspect-square w-full"
            style={{ backgroundColor: product.imagePlaceholderColor }}
            aria-hidden="true"
          />
          <CardContent className="p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-display text-h3">{product.name}</h3>
              <p className="text-small text-muted-foreground">${product.price}</p>
            </div>
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}
