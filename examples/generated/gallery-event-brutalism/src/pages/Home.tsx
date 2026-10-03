import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const previewVendors = [
  {
    name: "Mama's Ember",
    cuisine: 'Southern barbecue',
    station: 'Station 01',
    description: 'Pulled pork and smoked chicken over oak, with a vinegar slaw that cuts the fat.',
  },
  {
    name: 'Hot Iron Tacos',
    cuisine: 'Mexican street food',
    station: 'Station 02',
    description: 'Corn tortillas pressed to order, fillings from a plancha over live coals.',
  },
  {
    name: 'Smoke & Slaw',
    cuisine: 'Carolina whole hog',
    station: 'Station 03',
    description: 'Whole hog cooked low and slow, served with mustard sauce and crackling.',
  },
  {
    name: 'The Charred Peach',
    cuisine: 'Dessert and fire fruit',
    station: 'Station 04',
    description: 'Grilled peaches with burrata, honey, and smoked salt.',
  },
];

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="space-y-12">
      {/* Hero */}
      <section className="border-2 border-foreground bg-secondary p-6 md:p-12 shadow-hard">
        <div className="grid md:grid-cols-2 gap-8 items-center">
          <div>
            <p className="font-mono text-sm uppercase tracking-widest mb-4">
              June 14-15, 2025 · Old Rail Yard
            </p>
            <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl uppercase leading-none tracking-tight">
              Cinder <span className="text-primary">&</span> Smoke
            </h1>
            <p className="mt-4 text-lg font-medium max-w-md">
              A weekend food festival with 30 fire-driven vendors, live music, and two days of smoke and heat.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Button size="lg" onClick={() => navigate('/tickets')}>
                Get tickets
              </Button>
              <Button size="lg" variant="outline" onClick={() => navigate('/lineup')}>
                See the lineup
              </Button>
            </div>
          </div>
          <div className="hidden md:block border-2 border-foreground bg-primary p-4 shadow-hard">
            <div className="bg-background p-4 border-2 border-foreground">
              <p className="font-mono text-xs uppercase">The heat is on</p>
              <p className="font-display text-4xl uppercase mt-2">30+ vendors</p>
              <p className="font-display text-4xl uppercase">2 days</p>
              <p className="font-display text-4xl uppercase">5 fire pits</p>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section aria-label="Festival facts" className="grid grid-cols-2 lg:grid-cols-4 gap-0 border-2 border-foreground shadow-hard">
        <div className="p-6 border-b-2 border-foreground lg:border-b-0 lg:border-r-2">
          <p className="font-display text-4xl">30+</p>
          <p className="font-mono text-sm uppercase mt-1">Food vendors</p>
        </div>
        <div className="p-6 border-b-2 border-foreground lg:border-b-0 lg:border-r-2">
          <p className="font-display text-4xl">2</p>
          <p className="font-mono text-sm uppercase mt-1">Days of fire</p>
        </div>
        <div className="p-6 border-b-2 border-foreground sm:border-b-0 sm:border-r-2">
          <p className="font-display text-4xl">5</p>
          <p className="font-mono text-sm uppercase mt-1">Live fire pits</p>
        </div>
        <div className="p-6">
          <p className="font-display text-4xl">Free</p>
          <p className="font-mono text-sm uppercase mt-1">Kids under 12</p>
        </div>
      </section>

      {/* Lineup preview */}
      <section>
        <div className="flex items-end justify-between mb-6">
          <h2 className="font-display text-3xl sm:text-4xl uppercase leading-none">
            The lineup
          </h2>
          <Button variant="link" onClick={() => navigate('/lineup')} className="text-lg font-bold uppercase">
            Full lineup
          </Button>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {previewVendors.map((vendor) => (
            <article key={vendor.name} className="border-2 border-foreground p-4 bg-background shadow-hard">
              <p className="font-mono text-xs uppercase text-muted-foreground">{vendor.station}</p>
              <h3 className="font-display text-xl uppercase mt-1">{vendor.name}</h3>
              <p className="text-sm font-bold mt-1">{vendor.cuisine}</p>
              <p className="text-sm mt-2">{vendor.description}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Schedule preview */}
      <section className="border-2 border-foreground bg-primary text-primary-foreground p-6 md:p-12 shadow-hard">
        <h2 className="font-display text-3xl sm:text-4xl uppercase leading-none">
          Two days of heat
        </h2>
        <div className="mt-8 grid md:grid-cols-2 gap-8">
          <div className="border-2 border-primary-foreground p-4">
            <p className="font-mono text-sm uppercase tracking-widest">Saturday, June 14</p>
            <p className="font-display text-2xl uppercase mt-2">11:00 AM - 10:00 PM</p>
            <p className="text-sm mt-2">
              Whole hog from Smoke & Slaw, tacos from Hot Iron, and the first of two night market sessions.
            </p>
          </div>
          <div className="border-2 border-primary-foreground p-4">
            <p className="font-mono text-sm uppercase tracking-widest">Sunday, June 15</p>
            <p className="font-display text-2xl uppercase mt-2">11:00 AM - 8:00 PM</p>
            <p className="text-sm mt-2">
              A slower pace with brunch over embers, the vendor awards, and a closing set from the fire stage.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="lg"
          className="mt-8 bg-primary-foreground text-primary"
          onClick={() => navigate('/schedule')}
        >
          View full schedule
        </Button>
      </section>

      {/* Tickets and directions split */}
      <section className="grid md:grid-cols-2 gap-8">
        <div className="border-2 border-foreground bg-secondary p-6 shadow-hard">
          <p className="font-mono text-xs uppercase tracking-widest">Tickets</p>
          <h2 className="font-display text-3xl uppercase mt-2">Get in</h2>
          <p className="mt-3 font-medium">
            Day passes $25. Weekend passes $45. VIP with pit access and a drink token $90.
          </p>
          <Button size="lg" className="mt-6" onClick={() => navigate('/tickets')}>
            Buy tickets
          </Button>
        </div>
        <div className="border-2 border-foreground bg-background p-6 shadow-hard">
          <p className="font-mono text-xs uppercase tracking-widest">Directions</p>
          <h2 className="font-display text-3xl uppercase mt-2">Find us</h2>
          <p className="mt-3 font-medium">
            Old Rail Yard, 418 Foundry Street. Metro Red Line to Foundry, then walk 5 minutes east.
          </p>
          <Button size="lg" variant="outline" className="mt-6" onClick={() => navigate('/directions')}>
            Get directions
          </Button>
        </div>
      </section>
    </div>
  );
}
