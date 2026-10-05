export type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  notes: string;
  accentClass: string;
};

export const products: Product[] = [
  {
    id: 'ember-oak',
    name: 'Ember & Oak',
    description: 'A fireside candle with a slow, smoky draw of charred oak and a soft glow of amber.',
    price: 32,
    notes: 'charred oak, smoke, amber',
    accentClass: 'bg-primary/10',
  },
  {
    id: 'fig-cassis',
    name: 'Fig & Cassis',
    description: 'Ripe black fig folded into tart cassis, with a green leaf edge that keeps it from going sweet.',
    price: 34,
    notes: 'black fig, cassis, green leaf',
    accentClass: 'bg-accent/10',
  },
  {
    id: 'sea-salt-driftwood',
    name: 'Sea Salt & Driftwood',
    description: 'Mineral salt air, sun-bleached wood, and a trace of cool ocean spray.',
    price: 30,
    notes: 'sea salt, driftwood, ozone',
    accentClass: 'bg-secondary',
  },
  {
    id: 'wild-verbena',
    name: 'Wild Verbena',
    description: 'A bright, lemony verbena lifted with crushed herbs and a base of clean white musk.',
    price: 28,
    notes: 'verbena, lemon zest, white musk',
    accentClass: 'bg-muted',
  },
  {
    id: 'tobacco-cedar',
    name: 'Tobacco & Cedar',
    description: 'Sweet pipe tobacco over warm cedar and a hint of clove, like a study in late autumn.',
    price: 36,
    notes: 'tobacco, cedar, clove',
    accentClass: 'bg-primary/20',
  },
  {
    id: 'smoked-vanilla',
    name: 'Smoked Vanilla',
    description: 'Madagascar vanilla deepened with toasted sugar and a thread of woodsmoke.',
    price: 38,
    notes: 'vanilla, toasted sugar, smoke',
    accentClass: 'bg-accent/20',
  },
];
