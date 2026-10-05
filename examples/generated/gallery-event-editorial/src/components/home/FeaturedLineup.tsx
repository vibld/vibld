import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { fadeScale } from '@/lib/motion';
import { ArrowRight } from 'lucide-react';

const featured = [
  {
    name: 'Ana Reyes',
    role: 'Wood-fire cooking',
    imageClass: 'bg-gradient-to-br from-orange-200 to-amber-300',
  },
  {
    name: 'Marcus Chen',
    role: 'Pastry',
    imageClass: 'bg-gradient-to-br from-rose-200 to-pink-300',
  },
  {
    name: 'The Beekman Family',
    role: 'Whole-animal barbecue',
    imageClass: 'bg-gradient-to-br from-lime-200 to-emerald-300',
  },
  {
    name: 'Lena Ortiz',
    role: 'Ferments and preserves',
    imageClass: 'bg-gradient-to-br from-sky-200 to-indigo-300',
  },
];

export function FeaturedLineup() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16">
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            The lineup
          </p>
          <h2 className="mt-4 font-display text-4xl tracking-tight md:text-5xl">
            Four people who will change how you cook
          </h2>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
            A preview of the forty cooks, bakers and makers joining us in August.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
          {featured.map((person) => (
            <div key={person.name} className="group">
              <motion.div
                variants={fadeScale}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.3 }}
                className={`aspect-[4/5] overflow-hidden rounded-sm ${person.imageClass}`}
              >
                <div className="h-full w-full" />
              </motion.div>
              <h3 className="mt-4 text-xl font-semibold">{person.name}</h3>
              <p className="text-muted-foreground">{person.role}</p>
            </div>
          ))}
        </div>
        <div className="mt-12">
          <Link
            to="/lineup"
            className="inline-flex items-center gap-2 text-primary underline-offset-4 hover:underline"
          >
            <span>View full lineup</span>
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
