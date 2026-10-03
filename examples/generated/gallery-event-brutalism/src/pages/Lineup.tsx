import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const vendors = [
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
  {
    name: 'Ashen Bowl',
    cuisine: 'Wood-fired noodles',
    station: 'Station 05',
    description: 'Hand-pulled noodles tossed in a wok over an open flame with charred scallion oil.',
  },
  {
    name: 'Ember & Rye',
    cuisine: 'Smoked sandwiches',
    station: 'Station 06',
    description: 'Pastrami and turkey breast smoked on rye with a black pepper mustard.',
  },
  {
    name: 'Coal Roast',
    cuisine: 'Rotisserie and roots',
    station: 'Station 07',
    description: 'Spit-roasted chicken and beets cooked in the coals, served with herb salts.',
  },
  {
    name: 'The Soot Can',
    cuisine: 'Canned fish and fire',
    station: 'Station 08',
    description: 'Tinned seafood warmed over embers, with grilled bread and lemon.',
  },
  {
    name: 'Flame & Ferment',
    cuisine: 'Kimchi and grilled meat',
    station: 'Station 09',
    description: 'Gochujang-marinated short ribs and house kimchi, charred at the edges.',
  },
  {
    name: 'Burnt Sugar',
    cuisine: 'Caramel and smoke',
    station: 'Station 10',
    description: 'Burnt sugar ice cream with smoked honeycomb and a torched meringue.',
  },
  {
    name: 'The Iron Kettle',
    cuisine: 'Stews and braises',
    station: 'Station 11',
    description: 'Beef cheek stew and bone broth simmered in cast iron over a low fire.',
  },
  {
    name: 'Ash & Ale',
    cuisine: 'Beverages',
    station: 'Station 12',
    description: 'Smoked porter, charred lemonade, and cold brew with a pinch of activated charcoal.',
  },
];

export default function Lineup() {
  const navigate = useNavigate();

  return (
    <div>
      <section className="border-2 border-foreground bg-secondary p-6 md:p-12 shadow-hard">
        <p className="font-mono text-sm uppercase tracking-widest">30+ fire-driven vendors</p>
        <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl uppercase leading-none mt-2">
          The lineup
        </h1>
        <p className="mt-4 text-lg font-medium max-w-2xl">
          Twelve stations of smoke, char, and flame. Each vendor cooks over live fire, no gas, no shortcuts.
        </p>
      </section>

      <section className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-label="Vendor list">
        {vendors.map((vendor, index) => (
          <article
            key={vendor.name}
            className={`border-2 border-foreground p-4 shadow-hard ${
              index % 3 === 0
                ? 'bg-primary text-primary-foreground'
                : index % 3 === 1
                ? 'bg-secondary'
                : 'bg-background'
            }`}
          >
            <p className="font-mono text-xs uppercase opacity-70">{vendor.station}</p>
            <h2 className="font-display text-2xl uppercase mt-1">{vendor.name}</h2>
            <p className="font-bold text-sm mt-1">{vendor.cuisine}</p>
            <p className="text-sm mt-2">{vendor.description}</p>
          </article>
        ))}
      </section>

      <div className="mt-8 flex justify-center">
        <Button size="lg" variant="outline" onClick={() => navigate('/')}>
          Back to home
        </Button>
      </div>
    </div>
  );
}
