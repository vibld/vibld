import { PageHeader } from '@/components/PageHeader';

interface EventItem {
  time: string;
  title: string;
  location: string;
  person: string;
}

const fridayEvents: EventItem[] = [
  { time: '8:00 AM', title: 'Morning pastries and coffee', location: 'The Meadow', person: 'Sophie Liu' },
  { time: '10:00 AM', title: 'Fermentation 101: Get your jars bubbling', location: 'The Barn', person: 'Lena Ortiz' },
  { time: '12:00 PM', title: 'Wood-fire lunch: whole salmon and vegetables', location: 'Fire Pit', person: 'Ana Reyes' },
  { time: '2:00 PM', title: 'Talk: The secrets of oak and cherry', location: 'The Barn', person: 'Jonah Vale' },
  { time: '4:00 PM', title: 'Demo: Whole-animal barbecue', location: 'Fire Pit', person: 'The Beekman Family' },
  { time: '6:00 PM', title: 'Dinner: A long table under the oaks', location: 'The Meadow', person: 'Rotating chefs' },
  { time: '9:00 PM', title: 'Late-night dessert and cordials', location: 'The Orchard', person: 'Marcus Chen' },
];

const saturdayEvents: EventItem[] = [
  { time: '8:00 AM', title: 'Morning pastries and coffee', location: 'The Meadow', person: 'Marcus Chen' },
  { time: '10:00 AM', title: 'Demo: Pastry with stone-ground flour', location: 'The Barn', person: 'Marcus Chen' },
  { time: '12:00 PM', title: 'Lunch: Whole-animal barbecue', location: 'Fire Pit', person: 'The Beekman Family' },
  { time: '2:00 PM', title: 'Talk: Ferments and preserves', location: 'The Barn', person: 'Lena Ortiz' },
  { time: '4:00 PM', title: 'Demo: Open-fire vegetables', location: 'Fire Pit', person: 'Marta Kowalski' },
  { time: '6:00 PM', title: 'Dinner: The big roast', location: 'Fire Pit', person: 'Rotating chefs' },
  { time: '9:00 PM', title: 'Late-night snacks and natural wines', location: 'The Orchard', person: 'Naomi Harper' },
];

export default function Schedule() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
      <PageHeader
        kicker="Schedule"
        title="Three days, from morning fire to late-night snacks"
        lead="All demos and talks are included with a weekend pass unless noted."
      />
      <div className="grid grid-cols-1 gap-12 md:grid-cols-2 md:gap-16">
        <section aria-labelledby="friday-heading">
          <h2 id="friday-heading" className="font-display text-2xl tracking-tight md:text-3xl">Friday, August 15</h2>
          <ul className="mt-6 divide-y divide-border">
            {fridayEvents.map((event) => (
              <li key={event.time + event.title} className="py-5">
                <p className="text-sm font-medium uppercase tracking-[0.15em] text-muted-foreground">{event.time}</p>
                <h3 className="mt-1 font-medium text-lg leading-snug">{event.title}</h3>
                <p className="mt-1 text-muted-foreground">{event.location} • {event.person}</p>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="saturday-heading">
          <h2 id="saturday-heading" className="font-display text-2xl tracking-tight md:text-3xl">Saturday, August 16</h2>
          <ul className="mt-6 divide-y divide-border">
            {saturdayEvents.map((event) => (
              <li key={event.time + event.title} className="py-5">
                <p className="text-sm font-medium uppercase tracking-[0.15em] text-muted-foreground">{event.time}</p>
                <h3 className="mt-1 font-medium text-lg leading-snug">{event.title}</h3>
                <p className="mt-1 text-muted-foreground">{event.location} • {event.person}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <p className="mt-12 text-muted-foreground">
        No registration required. Seating is first come, first served.
      </p>
    </div>
  );
}
