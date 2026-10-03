import { motion } from 'motion/react';
import { fade, viewport } from '@/lib/motion';
import SectionHeading from '@/components/SectionHeading';

const vendors = [
  {
    name: 'Smoke & Thyme',
    description: 'Live fire lamb, charred eggplant, and herb salad',
  },
  {
    name: 'The Dumpling Cart',
    description: 'Hand-folded pork and chive dumplings with black vinegar',
  },
  {
    name: 'Arepa Linda',
    description: 'Griddled corn arepas with slow-cooked beef and queso fresco',
  },
  {
    name: 'Second Breakfast',
    description: 'Wood-fired sourdough, cultured butter, and seasonal preserves',
  },
  {
    name: 'Nightshade',
    description: 'Charred tomato and pepper stew with smoked paprika',
  },
  {
    name: 'The Oyster Shed',
    description: 'Raw and grilled oysters with mignonette and brown butter',
  },
  {
    name: 'Field & Fire',
    description: 'Whole roasted vegetables, whipped ricotta, and salsa verde',
  },
  {
    name: 'Little Fox Bakery',
    description: 'Canelés, financiers, and a rotating fruit tart',
  },
];

export default function Lineup() {
  return (
    <motion.section
      id="lineup"
      className="py-16 md:py-24"
      variants={fade}
      initial="hidden"
      whileInView="show"
      viewport={viewport}
    >
      <div className="mx-auto max-w-[1200px] px-6 md:px-12">
        <SectionHeading
          kicker="The cooks"
          heading="Lineup"
          intro="Sample dishes from thirty independent cooks and small-batch producers across five regions."
        />
        <div className="grid md:grid-cols-2 md:gap-x-12">
          {vendors.map((vendor) => (
            <div
              key={vendor.name}
              className="border-b border-border py-4"
            >
              <h3 className="text-h3 font-display font-medium text-foreground">
                {vendor.name}
              </h3>
              <p className="mt-1 text-body text-muted-foreground">
                {vendor.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </motion.section>
  );
}
