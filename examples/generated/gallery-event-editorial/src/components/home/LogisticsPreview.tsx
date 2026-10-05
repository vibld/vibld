import { Link } from 'react-router-dom';
import { Clock, Ticket, MapPin, ArrowRight } from 'lucide-react';

const items = [
  {
    icon: Clock,
    title: 'Schedule',
    description: 'Demos, talks and dinners from noon to late.',
    linkText: 'See the schedule',
    to: '/schedule',
  },
  {
    icon: Ticket,
    title: 'Tickets',
    description: 'Weekend passes, single-day and VIP.',
    linkText: 'Get tickets',
    to: '/tickets',
  },
  {
    icon: MapPin,
    title: 'Directions',
    description: 'Ridgewood Park, with transit, parking and accessibility.',
    linkText: 'Find your way',
    to: '/directions',
  },
];

export function LogisticsPreview() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 className="font-display text-4xl tracking-tight md:text-5xl">
          Plan your weekend
        </h2>
        <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-3">
          {items.map((item) => (
            <div key={item.title} className="rounded-lg border bg-background p-6">
              <item.icon className="size-6 text-primary" />
              <h3 className="mt-4 text-xl font-semibold">{item.title}</h3>
              <p className="mt-2 text-muted-foreground">{item.description}</p>
              <Link
                to={item.to}
                className="mt-4 inline-flex items-center gap-2 text-primary underline-offset-4 hover:underline"
              >
                <span>{item.linkText}</span>
                <ArrowRight className="size-4" />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
