import { GlassPanel } from "@/components/GlassPanel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Vendor = {
  name: string;
  cuisine: string;
  description: string;
};

const vendors: Vendor[] = [
  {
    name: "Smoke & Ember BBQ",
    cuisine: "Barbecue",
    description: "Slow-smoked brisket and maple bourbon glaze.",
  },
  {
    name: "Curry Up Now",
    cuisine: "Indian street food",
    description: "Indian street food with a Pacific Northwest twist.",
  },
  {
    name: "Sweet & Glazed",
    cuisine: "Doughnuts",
    description: "Handcrafted doughnuts and seasonal fruit fillings.",
  },
  {
    name: "El Camino Tacos",
    cuisine: "Mexican",
    description: "Charred corn tortillas, birria, and a roasted salsa bar.",
  },
  {
    name: "Pho Sho",
    cuisine: "Vietnamese",
    description: "12-hour beef broth, fresh rice noodles, and local herbs.",
  },
  {
    name: "The Grilled Cheese Guild",
    cuisine: "Comfort food",
    description: "Sourdough, aged cheddar, and a rotating soup pairing.",
  },
  {
    name: "Bangkok Basil",
    cuisine: "Thai",
    description: "Wok-fired noodles, green papaya salad, and coconut curry.",
  },
  {
    name: "Mama Rosa's Arancini",
    cuisine: "Sicilian",
    description: "Crispy saffron rice balls filled with mozzarella and ragù.",
  },
  {
    name: "Driftwood Oysters",
    cuisine: "Seafood",
    description: "Chilled Pacific oysters with mignonette and charred lemon.",
  },
  {
    name: "Churro Kings",
    cuisine: "Dessert",
    description: "Cinnamon sugar churros with dark chocolate and dulce de leche.",
  },
  {
    name: "Kyoto Katsu",
    cuisine: "Japanese",
    description: "Panko-crusted chicken katsu with curry and pickled cabbage.",
  },
  {
    name: "Velvet Spoon Gelato",
    cuisine: "Gelato",
    description: "Small-batch gelato in seasonal Northwest fruit flavors.",
  },
];

export default function Lineup() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-[clamp(3rem,8vw,6rem)] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="font-display text-4xl text-foreground md:text-5xl">The lineup</h1>
        <p className="mt-4 text-lg text-muted-foreground">Over 40 vendors serving street food, craft drinks, and dessert.</p>
      </div>
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {vendors.map((vendor) => (
          <GlassPanel key={vendor.name} className="p-6">
            <Card className="border-0 bg-transparent">
              <CardHeader className="p-0">
                <span className="text-xs font-bold uppercase tracking-wide text-primary">{vendor.cuisine}</span>
                <CardTitle className="mt-2 text-xl text-foreground">{vendor.name}</CardTitle>
                <CardDescription className="mt-2 text-muted-foreground">{vendor.description}</CardDescription>
              </CardHeader>
              <CardContent className="p-0 pt-4">
                <span className="text-sm text-muted-foreground/70">Confirmed for both days.</span>
              </CardContent>
            </Card>
          </GlassPanel>
        ))}
      </div>
    </section>
  );
}
