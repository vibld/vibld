export interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
  scentNotes: string[];
  imagePlaceholderColor: string;
}

export const products: Product[] = [
  {
    id: 'cedar-sage',
    name: 'Cedar & Sage',
    price: 28,
    description: 'A grounding blend of cedarwood and clary sage, with a clean, woody finish that settles a room without filling it.',
    scentNotes: ['Cedarwood', 'Clary sage', 'Vetiver'],
    imagePlaceholderColor: '#EBE9E7',
  },
  {
    id: 'amber-dusk',
    name: 'Amber Dusk',
    price: 32,
    description: 'Warm amber and vanilla with a whisper of sandalwood. Soft enough for evening, present enough for a long dinner.',
    scentNotes: ['Amber', 'Vanilla', 'Sandalwood'],
    imagePlaceholderColor: '#E7E2DC',
  },
  {
    id: 'lavender-field',
    name: 'Lavender Field',
    price: 30,
    description: 'True lavender, not sweetened. A dry, herbaceous scent that clears the air and slows the breath.',
    scentNotes: ['Lavender', 'Rosemary', 'Bergamot'],
    imagePlaceholderColor: '#E3E1E9',
  },
  {
    id: 'sea-salt',
    name: 'Sea Salt',
    price: 34,
    description: 'Mineral and bright, like the air off a cold shoreline. Ozone, salt, and a trace of driftwood.',
    scentNotes: ['Sea salt', 'Ozone', 'Driftwood'],
    imagePlaceholderColor: '#E2E8EC',
  },
  {
    id: 'vanilla-oak',
    name: 'Vanilla Oak',
    price: 26,
    description: 'A quiet vanilla over aged oak. Not bakery sweet; more like the inside of an old apothecary cabinet.',
    scentNotes: ['Vanilla', 'Oak', 'Tonka bean'],
    imagePlaceholderColor: '#EBE6DE',
  },
  {
    id: 'citrus-grove',
    name: 'Citrus Grove',
    price: 29,
    description: 'Grapefruit and bitter orange peel with a green leaf underneath. Sharp at first, then soft and warm.',
    scentNotes: ['Grapefruit', 'Bitter orange', 'Fig leaf'],
    imagePlaceholderColor: '#E7E9DC',
  },
];
