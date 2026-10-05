import { motion } from 'motion/react';
import { StoreHeader } from '@/components/StoreHeader';
import { ProductCard } from '@/components/ProductCard';
import { CartSheet } from '@/components/CartSheet';
import { products } from '@/lib/products';
import { staggerContainer, fadeUp } from '@/lib/motion';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

export default function Storefront() {
  const scrollToProducts = () => {
    document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <StoreHeader />
      <main>
        <section className="mx-auto max-w-6xl px-4 pt-16 pb-20 sm:px-6 sm:pt-20 lg:pt-24">
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="mx-auto max-w-3xl"
          >
            <motion.p variants={fadeUp} className="mb-4 text-sm font-medium uppercase tracking-widest text-primary">
              Hand-poured in small batches
            </motion.p>
            <motion.h1
              variants={fadeUp}
              className="font-serif text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl"
            >
              Candles for slow evenings
            </motion.h1>
            <motion.p variants={fadeUp} className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Six scents, each blended and poured by hand in our workshop. We make a few dozen at a time, and when a batch is gone, the next one takes its place.
            </motion.p>
            <motion.div variants={fadeUp} className="mt-8 flex flex-wrap gap-4">
              <Button onClick={scrollToProducts} size="lg" className="group">
                Browse the collection
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Button>
              <Button variant="outline" size="lg" onClick={() => document.getElementById('process')?.scrollIntoView({ behavior: 'smooth' })}>
                Our process
              </Button>
            </motion.div>
          </motion.div>
        </section>

        <section id="products" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
            className="mb-10"
          >
            <h2 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">The collection</h2>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Each candle burns for roughly 50 hours. The wax is a blend of soy and coconut, the wick is cotton, and the vessel is glass you can reuse.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>

        <section id="process" className="border-t border-border bg-secondary/30">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <motion.div
              variants={fadeUp}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              className="grid gap-8 md:grid-cols-2 md:items-start"
            >
              <div>
                <h2 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">How we make them</h2>
                <p className="mt-4 leading-relaxed text-muted-foreground">
                  We melt the wax slowly, stir in the fragrance at a low temperature, and let each candle cure for a week before it leaves the workshop. That wait is the part you can smell: a candle poured and shipped the same day burns hot and fast, with almost no scent.
                </p>
                <p className="mt-4 leading-relaxed text-muted-foreground">
                  We use cotton wicks trimmed to the right length. No dyes, no paraffin, no plastic packaging. The labels are printed on recycled paper with soy-based ink.
                </p>
              </div>
              <div className="flex flex-col gap-4">
                <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
                  <h3 className="font-serif text-xl font-semibold">Small batches</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    A batch is about 24 candles. When one sells out, we pour the next. The waitlist is the price of not mass producing.
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
                  <h3 className="font-serif text-xl font-semibold">Local materials</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    The wax comes from a supplier in Ohio, the vessels from a glasshouse in Pennsylvania, and the fragrances are mixed in small batches in Vermont.
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
                  <h3 className="font-serif text-xl font-semibold">A considered gift</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Every order ships in a plain kraft box with a handwritten note. We do not add plastic filler or gift wrap that goes straight to the bin.
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <p>© {new Date().getFullYear()} The Wicksmith. All rights reserved.</p>
          <p>This is a demonstration storefront. No payment is taken.</p>
        </div>
      </footer>

      <CartSheet />
    </div>
  );
}
