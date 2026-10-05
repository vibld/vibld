export interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
  notes: string[];
  image: string;
}

export const products: Product[] = [
  {
    id: 'ember-and-oak',
    name: 'Ember & Oak',
    price: 28,
    description: 'A warm, grounding scent built on cedar and smoked amber. The oak note is dry and steady, not sweet, with a soft clove at the back.',
    notes: ['Cedarwood', 'Smoked amber', 'Clove'],
    image: 'https://images.unsplash.com/photo-1602874801006-23c3f3e62c9e?w=800&auto=format&fit=crop&q=80',
  },
  {
    id: 'wild-fig',
    name: 'Wild Fig',
    price: 30,
    description: 'Green fig and black currant over a base of vetiver. The fig is ripe but not jammy, with a slightly earthy finish.',
    notes: ['Fig', 'Black currant', 'Vetiver'],
    image: 'https://images.unsplash.com/photo-1603006905003-be475563bc59?w=800&auto=format&fit=crop&q=80',
  },
  {
    id: 'sea-salt-and-driftwood',
    name: 'Sea Salt & Driftwood',
    price: 26,
    description: 'Mineral sea salt and sun-bleached driftwood on a sandalwood base. It smells like a cold beach, not a tropical one.',
    notes: ['Sea salt', 'Sandalwood', 'Driftwood'],
    image: 'https://images.unsplash.com/photo-1605000797499-95a51c5269ae?w=800&auto=format&fit=crop&q=80',
  },
  {
    id: 'midnight-garden',
    name: 'Midnight Garden',
    price: 32,
    description: 'Night-blooming jasmine and tuberose with a patchouli base. Heavy and floral, it fills a room without being sharp.',
    notes: ['Jasmine', 'Tuberose', 'Patchouli'],
    image: 'https://images.unsplash.com/photo-1608571423902-eed4a5ad8108?w=800&auto=format&fit=crop&q=80',
  },
  {
    id: 'golden-hour',
    name: 'Golden Hour',
    price: 29,
    description: 'Bergamot and honey over vanilla. Bright at the top, then it settles into a soft golden amber that lingers.',
    notes: ['Bergamot', 'Honey', 'Vanilla'],
    image: 'https://images.unsplash.com/photo-1596433809252-2f7c44b4d8b6?w=800&auto=format&fit=crop&q=80',
  },
  {
    id: 'fireside',
    name: 'Fireside',
    price: 27,
    description: 'Leather and tobacco leaf on a smoldering firewood base. It is smoky and rough, the kind of scent that clings to a wool sweater.',
    notes: ['Leather', 'Tobacco', 'Firewood'],
    image: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=800&auto=format&fit=crop&q=80',
  },
];
