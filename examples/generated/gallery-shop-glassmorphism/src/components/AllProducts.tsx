import ProductCard from './ProductCard';
import type { Product } from '@/lib/types';

interface AllProductsProps {
  products: Product[];
}

export default function AllProducts({ products }: AllProductsProps) {
  return (
    <section id="all-products" className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
      <h2 className="font-display text-[clamp(2.5rem,6vw,3.5rem)] leading-[1.1] tracking-[-0.02em] text-foreground">
        All candles
      </h2>
      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {products.map(product => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}
