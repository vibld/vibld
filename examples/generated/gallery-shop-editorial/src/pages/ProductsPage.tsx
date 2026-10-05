import { SiteLayout } from '@/components/layout/SiteLayout';
import { ProductCard } from '@/components/ProductCard';
import { products } from '@/lib/products';

export function ProductsPage() {
  return (
    <SiteLayout>
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <header className="mb-12">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">All candles</h1>
          <p className="mt-4 max-w-prose text-lg text-muted-foreground">
            Six scents, each one small-batch and hand-poured. If you need help choosing, the notes are on every product page.
          </p>
        </header>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </SiteLayout>
  );
}
