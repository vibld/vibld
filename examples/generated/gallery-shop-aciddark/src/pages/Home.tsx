import { products } from '@/lib/products';
import ProductCard from '@/components/ProductCard';
import { buttonVariants } from '@/components/ui/button';

export default function HomePage() {
  return (
    <>
      <section className="mx-auto max-w-3xl px-6 py-16 text-center md:py-24">
        <h1 className="font-display text-[clamp(3rem,8vw,6rem)] font-bold leading-[0.95] tracking-[-0.04em] text-foreground">
          Candles for dark rooms.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-base leading-6 text-muted-foreground">
          Small-batch soy candles, poured in Berlin. The cart stays in your browser, so add freely. Nothing is charged.
        </p>
        <a
          href="#products"
          className={`${buttonVariants({ size: 'lg' })} mt-6`}
        >
          Shop candles
        </a>
        <p className="mt-4 text-sm text-muted-foreground">
          Demo cart, keeps items in your browser
        </p>
      </section>

      <section id="products" className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="font-display text-[clamp(1.5rem,3vw,2.25rem)] font-semibold leading-[1.1] tracking-[-0.02em] text-foreground">
          Current pour
        </h2>
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-16 text-left">
        <h2 className="font-display text-[clamp(1.5rem,3vw,2.25rem)] font-semibold leading-[1.1] tracking-[-0.02em] text-foreground">
          The cart is a simulation.
        </h2>
        <p className="mt-4 text-base leading-6 text-muted-foreground">
          This store has no checkout. Items stay in your browser's local storage and clear when you close the site. Nothing leaves your device.
        </p>
      </section>
    </>
  );
}
