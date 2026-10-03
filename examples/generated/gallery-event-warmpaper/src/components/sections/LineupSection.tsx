import { motion } from 'motion/react';
import { PageSection } from '@/components/PageSection';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { staggerContainer, fadeUp } from '@/lib/motion';

const vendors = [
  {
    name: "Mama Rosa's Arepas",
    cuisine: 'Colombian street food',
    dish: 'Arepas stuffed with slow-braised beef and queso fresco.',
  },
  {
    name: 'The Salted Pig',
    cuisine: 'Whole-animal butchery',
    dish: 'Porchetta with salsa verde and charred lemon.',
  },
  {
    name: 'Butter & Bloom Bakery',
    cuisine: 'Naturally leavened breads',
    dish: 'Sourdough with brown butter and wildflower honey.',
  },
  {
    name: "Uncle Bun's Dumplings",
    cuisine: 'Hand-pleated dumplings',
    dish: 'Pork and chive dumplings with black vinegar.',
  },
  {
    name: 'Fern & Ember',
    cuisine: 'Wood-fired vegetables',
    dish: 'Smoked carrots with tahini and dukkah.',
  },
  {
    name: 'Little River Oysters',
    cuisine: 'Tide-to-table shellfish',
    dish: 'Shucked oysters with cucumber mignonette.',
  },
];

export function LineupSection() {
  return (
    <PageSection
      id="lineup"
      heading="The lineup"
      intro="Chefs and makers from across the valley, each with one dish that tells a story."
    >
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.3 }}
        className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
      >
        {vendors.map((vendor) => (
          <motion.div key={vendor.name} variants={fadeUp}>
            <Card className="h-full">
              <CardHeader>
                <CardTitle>{vendor.name}</CardTitle>
                <CardDescription>{vendor.cuisine}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-base leading-relaxed text-card-foreground">{vendor.dish}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>
    </PageSection>
  );
}

export default LineupSection;
