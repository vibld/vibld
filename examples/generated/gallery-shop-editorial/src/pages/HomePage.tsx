import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { SiteLayout } from '@/components/layout/SiteLayout';
import { ProductCard } from '@/components/ProductCard';
import { Button } from '@/components/ui/button';
import { products } from '@/lib/products';
import { fadeInScale, clipWipe, staggerContainer } from '@/lib/motion';

export function HomePage() {
  const featured = products.slice(0, 3);

  return (
    <SiteLayout>
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="grid gap-12 lg:grid-cols-2 lg:items-center"
          >
            <div>
              <motion.h1
                variants={fadeInScale}
                className="text-5xl font-bold tracking-tight text-foreground sm:text-6xl lg:text-7xl"
              >
                Candles with a slower burn.
              </motion.h1>
              <motion.p
                variants={fadeInScale}
                className="mt-6 max-w-prose text-lg leading-relaxed text-muted-foreground"
              >
                Six small-batch scents, poured by hand in our studio. Each one is made with coconut wax, a cotton wick, and no shortcuts.
              </motion.p>
              <motion.div variants={fadeInScale} className="mt-8 flex gap-4">
                <Button asChild size="lg" className="cursor-pointer">
                  <a href="#/products">
                    Shop all candles
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </a>
                </Button>
                <Button asChild variant="ghost" size="lg" className="cursor-pointer">
                  <a href="#/cart">View cart</a>
                </Button>
              </motion.div>
            </div>
            <motion.div variants={clipWipe} className="overflow-hidden rounded-lg">
              <img
                src="https://images.unsplash.com/photo-1602874801006-23c3f3e62c9e?w=1600&auto=format&fit=crop&q=80"
                alt="A lit candle on a wooden table"
                className="aspect-[4/5] h-full w-full object-cover lg:aspect-[3/4]"
              />
            </motion.div>
          </motion.div>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Featured candles</h2>
            <a href="#/products" className="text-sm font-medium text-primary hover:underline">
              View all
            </a>
          </div>
          <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </div>
      </section>

      <section className="bg-muted/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <motion.div
              variants={fadeInScale}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              className="overflow-hidden rounded-lg"
            >
              <img
                src="https://images.unsplash.com/photo-1596433809252-2f7c44b4d8b6?w=1600&auto=format&fit=crop&q=80"
                alt="A candle with a wooden wick being poured"
                className="aspect-[4/3] h-full w-full object-cover lg:aspect-[1/1]"
              />
            </motion.div>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">The studio</h2>
              <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
                We started in a garage with a double boiler and a case of jars. Two years later, we still pour every batch by hand and trim every wick before it leaves.
              </p>
              <blockquote className="mt-10 border-l-2 border-primary pl-6 text-xl italic text-foreground">
                A candle is the slowest way to change a room.
              </blockquote>
              <p className="mt-4 text-sm text-muted-foreground">
                That line is taped above our pouring bench. It keeps us honest.
              </p>
            </div>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
